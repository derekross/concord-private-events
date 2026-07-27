/**
 * useSignUpBoard — manage sign-up items in a Concord V2 channel.
 *
 * Items are kind 31800 rumors. The content is JSON with
 * { category, name, claimedBy, claimedAt, notes }.
 * Claiming is done via kind 3302 edits.
 */

import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { KIND_WRAP, KIND_EDIT, KIND_DELETE } from "@/concord-v2/lib/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
  type StreamSigner,
} from "@/concord-v2/lib/stream";
import type { NostrEvent, EventTemplate } from "nostr-tools/pure";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import { openChannelWraps } from "@/lib/concordHelpers";
import { filterDeleted } from "@/lib/deleteUtils";
import {
  KIND_SIGNUP_ITEM,
  parseSignUpItem,
  serializeSignUpItem,
  type SignUpItem,
} from "@/lib/signUpModel";

export function useSignUpBoard(channel: ChannelV2 | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const queryKey = ["sign-up-board", channel?.idHex] as const;

  const { data: items } = useQuery<SignUpItem[]>({
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

      // Apply edits (latest wins, original author or item creator only)
      // Skip edits targeting deleted items
      for (const [targetId, edits] of editsByTarget) {
        if (deletedIds.has(targetId)) continue;
        const item = itemMap.get(targetId);
        if (!item) continue;
        const sortedEdits = edits.sort((a, b) => b.ms - a.ms);
        for (const edit of sortedEdits) {
          if (edit.author === item.createdBy || edit.author === item.claimedBy) {
            try {
              const updated = JSON.parse(edit.content);
              item.claimedBy = updated.claimedBy || undefined;
              item.claimedAt = updated.claimedAt || undefined;
              item.notes = updated.notes || undefined;
            } catch {
              // ignore malformed
            }
            break;
          }
        }
      }

      return [...itemMap.values()].sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!channel,
    // Keep cached data showing while background refetching happens.
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 10_000,
  });

  const addItem = useCallback(
    async (
      category: string,
      name: string,
      signer: StreamSigner
    ) => {
      const ch = channelRef.current;
      if (!ch || !name.trim()) return;

      const pubkey = await getSignerPubkey(signer);

      // Optimistic insert
      const tempId = `pending-${Date.now()}`;
      const optimisticItem: SignUpItem = {
        id: tempId,
        category: category as SignUpItem["category"],
        name: name.trim(),
        createdBy: pubkey,
        claimedBy: undefined,
        claimedAt: undefined,
        notes: undefined,
      };
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) => [...old, optimisticItem]);

      const content = serializeSignUpItem({
        category: category as SignUpItem["category"],
        name: name.trim(),
        claimedBy: "",
        claimedAt: 0,
        notes: "",
      });

      const rumor = buildRumor({
        kind: KIND_SIGNUP_ITEM,
        content,
        tags: [...channelBindingTags(ch.idHex, ch.current.epoch)],
        pubkey,
        ms: Date.now(),
      });

      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);

      await nostr.event(wrap);
      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 500);
    },
    [nostr, queryClient, queryKey]
  );

  const claimItem = useCallback(
    async (
      itemId: string,
      itemCreator: string,
      signer: StreamSigner
    ) => {
      const ch = channelRef.current;
      if (!ch) return;

      const pubkey = await getSignerPubkey(signer);

      // Optimistic claim
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
        old.map((item) =>
          item.id === itemId
            ? { ...item, claimedBy: pubkey, claimedAt: Date.now() }
            : item
        )
      );

      const content = serializeSignUpItem({
        category: "seafood",
        name: "",
        claimedBy: pubkey,
        claimedAt: Date.now(),
        notes: "",
      });

      const rumor = buildRumor({
        kind: KIND_EDIT,
        content,
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", itemId],
        ],
        pubkey,
        ms: Date.now(),
      });

      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);

      await nostr.event(wrap);
      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 500);
    },
    [nostr, queryClient, queryKey]
  );

  const unclaimItem = useCallback(
    async (
      itemId: string,
      signer: StreamSigner
    ) => {
      const ch = channelRef.current;
      if (!ch) return;

      // Optimistic unclaim
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
        old.map((item) =>
          item.id === itemId
            ? { ...item, claimedBy: undefined, claimedAt: undefined }
            : item
        )
      );

      const pubkey = await getSignerPubkey(signer);
      const content = serializeSignUpItem({
        category: "seafood",
        name: "",
        claimedBy: "",
        claimedAt: 0,
        notes: "",
      });

      const rumor = buildRumor({
        kind: KIND_EDIT,
        content,
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", itemId],
        ],
        pubkey,
        ms: Date.now(),
      });

      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);

      await nostr.event(wrap);
      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 500);
    },
    [nostr, queryClient, queryKey]
  );

  const deleteItem = useCallback(
    async (
      itemId: string,
      signer: StreamSigner
    ) => {
      const ch = channelRef.current;
      if (!ch || !itemId) return;

      // Optimistic delete
      queryClient.setQueryData<SignUpItem[]>(queryKey, (old = []) =>
        old.filter((item) => item.id !== itemId)
      );

      const pubkey = await getSignerPubkey(signer);

      const rumor = buildRumor({
        kind: KIND_DELETE,
        content: "deleted",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", itemId],
        ],
        pubkey,
        ms: Date.now(),
      });

      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);

      await nostr.event(wrap);
      // Background refetch will confirm
    },
    [nostr, queryClient, queryKey]
  );

  return {
    items: items ?? [],
    addItem,
    claimItem,
    unclaimItem,
    deleteItem,
  };
}

async function getSignerPubkey(signer: StreamSigner): Promise<string> {
  const template: EventTemplate = {
    kind: 0,
    content: "",
    tags: [],
    created_at: 0,
  };
  const signed = await signer.signEvent(template);
  return signed.pubkey;
}
