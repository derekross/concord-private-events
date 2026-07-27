/**
 * useChannelChat — subscribe to and publish chat messages in a Concord V2 channel.
 *
 * Reads kind-1059 wraps addressed to the channel's stream key(s), decrypts
 * them, and folds them into a timeline. Provides a send function that
 * builds, seals, and wraps a kind-9 message rumor.
 *
 * Latency strategy (the "no 3-second wait" rules):
 *  - Sends are optimistic with the REAL rumor id, so when the relay copy
 *    arrives (poll or live subscription) it dedupes against the pending
 *    copy instead of replacing it.
 *  - Refetches merge unconfirmed pending messages back in, so a refetch that
 *    beats relay propagation never makes a sent message vanish.
 *  - Deletes keep a short-lived local tombstone so a fast refetch can't
 *    resurrect a deleted message before the delete wrap propagates.
 */

import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { KIND_MESSAGE, KIND_WRAP, KIND_DELETE, KIND_EDIT } from "@/concord-v2/lib/kinds";
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

export interface ChatMessage {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** NIP-92 imeta tags for attached images/media */
  imeta: string[][];
  /** Image URLs extracted from imeta */
  images: string[];
  /** True if this message is pending confirmation on relays */
  pending?: boolean;
  /** True if the author edited this message after posting (kind 3302). */
  edited?: boolean;
}

/** How long an unconfirmed optimistic message survives refetches (ms). */
const PENDING_TTL = 60_000;
/** How long a local delete tombstone survives refetches (ms). */
const TOMBSTONE_TTL = 60_000;

/** Extract image URLs from NIP-92 imeta tags. */
export function imagesFromImeta(imeta: string[][]): string[] {
  const images: string[] = [];
  for (const tag of imeta) {
    const entry = tag.find((v) => v.startsWith("url "));
    const url = entry?.slice(4);
    if (url) images.push(url);
  }
  return images;
}

export function useChannelChat(channel: ChannelV2 | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const channelRef = useRef(channel);
  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  // Rumor ids deleted locally, with the timestamp the tombstone expires.
  // Bridges the gap between "delete wrap published" and "delete wrap visible
  // on relays" so refetches don't briefly resurrect the message.
  const tombstonesRef = useRef(new Map<string, number>());

  const channelId = channel?.idHex;
  const queryKey = useMemo(() => ["channel-chat", channelId] as const, [channelId]);

  const { data: messages, isLoading } = useQuery<ChatMessage[]>({
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
      const { active } = filterDeleted(opened);
      const chatEvents = active.filter((e) => e.kind === KIND_MESSAGE);

      // Collect kind-3302 edits per target. Only the original author may
      // edit; their latest edit (by ms) wins (matches Armada's fold).
      const editsByTarget = new Map<string, { author: string; content: string; ms: number }[]>();
      for (const e of active) {
        if (e.kind !== KIND_EDIT) continue;
        const target = e.tags.find((t) => t[0] === "e")?.[1];
        if (!target) continue;
        let list = editsByTarget.get(target);
        if (!list) editsByTarget.set(target, (list = []));
        list.push({ author: e.author, content: e.content, ms: e.ms });
      }

      const fresh = chatEvents
        .map((e): ChatMessage => {
          const imeta = e.tags?.filter((t: string[]) => t[0] === "imeta") ?? [];
          let content = e.content;
          let edited = false;
          const edits = editsByTarget.get(e.rumorId);
          if (edits) {
            let best: { content: string; ms: number } | undefined;
            for (const edit of edits) {
              if (edit.author !== e.author) continue;
              if (!best || edit.ms > best.ms) best = edit;
            }
            if (best) {
              content = best.content;
              edited = true;
            }
          }
          return {
            id: e.rumorId,
            pubkey: e.author,
            content,
            createdAt: e.createdAt,
            imeta,
            images: imagesFromImeta(imeta),
            edited,
          };
        });

      const freshIds = new Set(fresh.map((m) => m.id));

      // Drop expired tombstones, then hide anything the relay set still
      // carries but we already deleted locally.
      const now = Date.now();
      for (const [id, expires] of tombstonesRef.current) {
        if (expires <= now) tombstonesRef.current.delete(id);
      }
      const visible = fresh.filter((m) => !tombstonesRef.current.has(m.id));

      // Re-attach still-unconfirmed optimistic messages so a refetch that
      // beats relay propagation doesn't make them vanish.
      const prev = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];
      const unconfirmed = prev.filter(
        (m) => m.pending && !freshIds.has(m.id) && now - m.createdAt * 1000 < PENDING_TTL
      );

      return [...visible, ...unconfirmed].sort((a, b) => a.createdAt - b.createdAt);
    },
    enabled: !!channel,
    // Keep cached data showing while background refetching happens.
    // This makes tab switches instant — no loading spinner on revisit.
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    // Reconciliation poll. New messages arrive instantly via the live
    // subscription in useLiveChannelEvents; this only catches what the
    // subscription missed (reconnects, slow relays).
    refetchInterval: 15_000,
  });

  const sendMessage = useCallback(
    async (
      text: string,
      signer: StreamSigner,
      senderPubkey: string,
      attachmentTags?: string[][],
    ) => {
      const ch = channelRef.current;
      if (!ch || (!text.trim() && !attachmentTags?.length)) return;

      const now = Date.now();

      // Build the rumor first (synchronous) so the optimistic message carries
      // the REAL rumor id — the relay copy dedupes against it on arrival.
      const rumor = buildRumor({
        kind: KIND_MESSAGE,
        content: text.trim(),
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ...(attachmentTags ?? []),
        ],
        pubkey: senderPubkey,
        ms: now,
      });

      const imeta = (attachmentTags ?? []).filter((t) => t[0] === "imeta");
      const optimisticMsg: ChatMessage = {
        id: rumor.id,
        pubkey: senderPubkey,
        content: text.trim(),
        createdAt: rumor.created_at,
        imeta,
        images: imagesFromImeta(imeta),
        pending: true,
      };

      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) => {
        if (old.some((m) => m.id === rumor.id)) return old;
        return [...old, optimisticMsg];
      });

      try {
        const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
        const wrap = wrapSeal(seal, ch.current.group);
        await nostr.event(wrap);
      } catch (err) {
        // Publish failed — roll back the optimistic message.
        queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) =>
          old.filter((m) => m.id !== rumor.id)
        );
        throw err;
      }

      // Reconcile in the background to flip the message from pending to
      // confirmed (small delay so the relay has time to store it).
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
      }, 1000);
    },
    [nostr, queryClient, queryKey]
  );

  const deleteMessage = useCallback(
    async (
      rumorId: string,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !rumorId) return;

      // Optimistic: remove from cache and tombstone it so the next refetch
      // can't resurrect it before the delete wrap propagates.
      tombstonesRef.current.set(rumorId, Date.now() + TOMBSTONE_TTL);
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) =>
        old.filter((m) => m.id !== rumorId)
      );

      const rumor = buildRumor({
        kind: KIND_DELETE,
        content: "deleted",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", rumorId],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
        const wrap = wrapSeal(seal, ch.current.group);
        await nostr.event(wrap);
      } catch (err) {
        // Publish failed — lift the tombstone and restore via refetch.
        tombstonesRef.current.delete(rumorId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }
    },
    [nostr, queryClient, queryKey]
  );

  /**
   * Edit one of the user's own messages (kind 3302, author-only latest-wins).
   * Optimistically rewrites the cached content; the live subscription and
   * reconciliation poll settle the final state.
   */
  const editMessage = useCallback(
    async (
      rumorId: string,
      newContent: string,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !rumorId || !newContent.trim()) return;

      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) =>
        old.map((m) =>
          m.id === rumorId ? { ...m, content: newContent.trim(), edited: true } : m
        )
      );

      const rumor = buildRumor({
        kind: KIND_EDIT,
        content: newContent.trim(),
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", rumorId],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
        const wrap = wrapSeal(seal, ch.current.group);
        await nostr.event(wrap);
      } catch (err) {
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
      }, 1000);
    },
    [nostr, queryClient, queryKey]
  );

  return { messages: messages ?? [], isLoading, sendMessage, deleteMessage, editMessage };
}
