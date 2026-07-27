/**
 * useSignUpBoard — manage sign-up items in a Concord V2 channel.
 *
 * Items are kind 31800 rumors. The content is JSON with
 * { category, name, claimedBy, claimedAt, notes }.
 * Claims and content changes are kind 3302 edits targeting the item rumor.
 *
 * Latency strategy mirrors useChannelChat: every mutation is optimistic with
 * the REAL rumor id, and the query function re-applies unconfirmed local ops
 * (adds / claim overrides / delete tombstones) on top of relay data so a
 * refetch that beats relay propagation never rolls the UI backwards.
 */

import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { KIND_WRAP, KIND_EDIT, KIND_DELETE } from "@/concord-v2/lib/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
  type StreamSigner,
} from "@/concord-v2/lib/stream";
import type { NostrEvent } from "nostr-tools/pure";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import { openChannelWraps } from "@/lib/concordHelpers";
import { filterDeleted } from "@/lib/deleteUtils";
import {
  KIND_SIGNUP_ITEM,
  parseSignUpItem,
  serializeSignUpItem,
  type SignUpItem,
} from "@/lib/signUpModel";

/** How long an unconfirmed local op survives refetches (ms). */
const LOCAL_OP_TTL = 60_000;

interface ClaimOverride {
  claimedBy?: string;
  claimedAt?: number;
  expires: number;
}

/** Local, not-yet-relay-confirmed operations to re-apply over relay data. */
interface LocalOps {
  /** Newly added items, keyed by their real rumor id. */
  adds: Map<string, { item: SignUpItem; expires: number }>;
  /** Claim/unclaim overrides, keyed by target item rumor id. */
  claims: Map<string, ClaimOverride>;
  /** Locally deleted item rumor ids → expiry timestamp. */
  tombstones: Map<string, number>;
}

function emptyOps(): LocalOps {
  return { adds: new Map(), claims: new Map(), tombstones: new Map() };
}

/** Drop expired entries, in place. */
function pruneOps(ops: LocalOps, now: number) {
  for (const [id, op] of ops.adds) if (op.expires <= now) ops.adds.delete(id);
  for (const [id, op] of ops.claims) if (op.expires <= now) ops.claims.delete(id);
  for (const [id, expires] of ops.tombstones) if (expires <= now) ops.tombstones.delete(id);
}

export function useSignUpBoard(channel: ChannelV2 | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const channelRef = useRef(channel);
  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);
  const opsRef = useRef<LocalOps>(emptyOps());

  const channelId = channel?.idHex;
  const queryKey = useMemo(() => ["sign-up-board", channelId] as const, [channelId]);

  const { data: items, isLoading } = useQuery<SignUpItem[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const ch = channelRef.current;
      if (!ch) return [];

      const authors = ch.streams.map((s) => s.group.pk);
      const wraps = await nostr.query(
        [{ kinds: [KIND_WRAP], authors, limit: 500 }],
        { signal }
      );

      const opened = openChannelWraps(wraps as NostrEvent[], ch);
      const { active, deletedIds } = filterDeleted(opened);

      // Collect items and edits (excluding deleted)
      const itemMap = new Map<string, SignUpItem>();
      const editsByTarget = new Map<string, { content: string; ms: number; author: string }[]>();

      for (const ev of active) {
        if (ev.kind === KIND_SIGNUP_ITEM) {
          const item = parseSignUpItem(ev.content, ev.rumorId, ev.author, ev.createdAt);
          if (item) itemMap.set(ev.rumorId, item);
        } else if (ev.kind === KIND_EDIT) {
          const target = ev.tags.find((t) => t[0] === "e")?.[1];
          if (target) {
            if (!editsByTarget.has(target)) editsByTarget.set(target, []);
            editsByTarget.get(target)!.push({
              content: ev.content,
              ms: ev.ms,
              author: ev.author,
            });
          }
        }
      }

      // Remove items that have been deleted via kind-5
      for (const id of deletedIds) {
        itemMap.delete(id);
      }

      // Apply edits, newest first. Field-level merge: the newest edit by the
      // item's creator sets the name/category (rename support); the newest
      // edit by the creator or current claimer sets claim fields. Edits
      // targeting deleted items are ignored.
      for (const [targetId, edits] of editsByTarget) {
        if (deletedIds.has(targetId)) continue;
        const item = itemMap.get(targetId);
        if (!item) continue;
        const originalClaimer = item.claimedBy;
        const sortedEdits = edits.sort((a, b) => b.ms - a.ms);
        let claimApplied = false;
        let contentApplied = false;
        for (const edit of sortedEdits) {
          if (claimApplied && contentApplied) break;
          const isCreator = edit.author === item.createdBy;
          const isClaimer = Boolean(originalClaimer) && edit.author === originalClaimer;
          if (!isCreator && !isClaimer) continue;
          let updated: { name?: unknown; category?: unknown; claimedBy?: string; claimedAt?: number; notes?: string };
          try {
            updated = JSON.parse(edit.content);
          } catch {
            continue; // ignore malformed
          }
          if (!claimApplied) {
            item.claimedBy = updated.claimedBy || undefined;
            item.claimedAt = updated.claimedAt || undefined;
            item.notes = updated.notes || undefined;
            claimApplied = true;
          }
          if (!contentApplied && isCreator) {
            // Claim-style edits serialize an empty name; only a real rename
            // (non-empty name from the creator) rewrites content fields.
            if (typeof updated.name === "string" && updated.name) {
              item.name = updated.name;
              if (typeof updated.category === "string" && updated.category) {
                item.category = updated.category as SignUpItem["category"];
              }
              contentApplied = true;
            }
          }
        }
      }

      // Re-apply unconfirmed local ops so refetches don't roll back the UI.
      const ops = opsRef.current;
      const now = Date.now();
      pruneOps(ops, now);

      for (const [id, override] of ops.claims) {
        const item = itemMap.get(id);
        if (!item) continue;
        // If the relay state already reflects this op, drop it.
        if (item.claimedBy === override.claimedBy) {
          ops.claims.delete(id);
          continue;
        }
        item.claimedBy = override.claimedBy;
        item.claimedAt = override.claimedAt;
      }

      const result = [...itemMap.values()].filter((item) => !ops.tombstones.has(item.id));

      const resultIds = new Set(result.map((i) => i.id));
      for (const [id, op] of ops.adds) {
        if (resultIds.has(id)) {
          // Relay copy arrived — the op is confirmed.
          ops.adds.delete(id);
          continue;
        }
        result.push(op.item);
      }

      return result.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!channel,
    // Keep cached data showing while background refetching happens.
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    // Reconciliation poll; the live subscription delivers changes instantly.
    refetchInterval: 15_000,
  });

  /** Publish a wrapped rumor to the channel; throws on relay failure. */
  const publish = useCallback(
    async (
      ch: ChannelV2,
      rumor: ReturnType<typeof buildRumor>,
      signer: StreamSigner,
    ) => {
      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);
      await nostr.event(wrap);
    },
    [nostr]
  );

  const addItem = useCallback(
    async (
      category: string,
      name: string,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !name.trim()) return;

      const content = serializeSignUpItem({
        category: category as SignUpItem["category"],
        name: name.trim(),
        claimedBy: "",
        claimedAt: 0,
        notes: "",
      });

      // Build the rumor first (synchronous) so the optimistic item carries
      // the real rumor id and dedupes against the relay copy on arrival.
      const rumor = buildRumor({
        kind: KIND_SIGNUP_ITEM,
        content,
        tags: [...channelBindingTags(ch.idHex, ch.current.epoch)],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      const optimisticItem: SignUpItem = {
        id: rumor.id,
        category: category as SignUpItem["category"],
        name: name.trim(),
        createdBy: senderPubkey,
        createdAt: rumor.created_at,
      };

      opsRef.current.adds.set(rumor.id, { item: optimisticItem, expires: Date.now() + LOCAL_OP_TTL });
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
        [...old, optimisticItem].sort((a, b) => {
          if (a.category !== b.category) return a.category.localeCompare(b.category);
          return a.name.localeCompare(b.name);
        })
      );

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        opsRef.current.adds.delete(rumor.id);
        queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
          old.filter((i) => i.id !== rumor.id)
        );
        throw err;
      }

      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 1000);
    },
    [publish, queryClient, queryKey]
  );

  /** Apply a claim-state edit (claim or unclaim) with local-op tracking. */
  const applyClaimEdit = useCallback(
    async (
      itemId: string,
      claimedBy: string | undefined,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch) return;

      const override: ClaimOverride = {
        claimedBy,
        claimedAt: claimedBy ? Date.now() : undefined,
        expires: Date.now() + LOCAL_OP_TTL,
      };
      opsRef.current.claims.set(itemId, override);
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
        old.map((item) =>
          item.id === itemId
            ? { ...item, claimedBy: override.claimedBy, claimedAt: override.claimedAt }
            : item
        )
      );

      const content = serializeSignUpItem({
        category: "seafood",
        name: "",
        claimedBy: claimedBy ?? "",
        claimedAt: override.claimedAt ?? 0,
        notes: "",
      });

      const rumor = buildRumor({
        kind: KIND_EDIT,
        content,
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", itemId],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        opsRef.current.claims.delete(itemId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }

      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 1000);
    },
    [publish, queryClient, queryKey]
  );

  const claimItem = useCallback(
    (itemId: string, signer: StreamSigner, senderPubkey: string) =>
      applyClaimEdit(itemId, senderPubkey, signer, senderPubkey),
    [applyClaimEdit]
  );

  const unclaimItem = useCallback(
    (itemId: string, signer: StreamSigner, senderPubkey: string) =>
      applyClaimEdit(itemId, undefined, signer, senderPubkey),
    [applyClaimEdit]
  );

  const deleteItem = useCallback(
    async (
      itemId: string,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !itemId) return;

      // Optimistic: tombstone + remove from cache so refetches can't
      // resurrect the item before the delete wrap propagates.
      opsRef.current.tombstones.set(itemId, Date.now() + LOCAL_OP_TTL);
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
        old.filter((item) => item.id !== itemId)
      );

      const rumor = buildRumor({
        kind: KIND_DELETE,
        content: "deleted",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", itemId],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        opsRef.current.tombstones.delete(itemId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }
    },
    [publish, queryClient, queryKey]
  );

  return {
    items: items ?? [],
    isLoading,
    addItem,
    claimItem,
    unclaimItem,
    deleteItem,
  };
}
