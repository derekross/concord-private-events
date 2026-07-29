/**
 * useChannelChat — subscribe to and publish chat messages in a Concord V2 channel.
 *
 * Reads kind-1059 wraps addressed to the channel's stream key(s), decrypts
 * them, and folds them into a timeline: kind-9 messages (with `q` quote-
 * replies), kind-3302 edits, kind-5 deletes, and kind-7 reactions.
 *
 * Latency strategy (the "no 3-second wait" rules):
 *  - Mutations are optimistic with the REAL rumor id, so relay copies dedupe
 *    against pending entries instead of replacing them.
 *  - Refetches merge unconfirmed pending ops back in (messages, reactions),
 *    so a refetch that beats relay propagation never rolls the UI backwards.
 *  - Deletes keep short-lived local tombstones so a fast refetch can't
 *    resurrect an entry before its delete wrap propagates.
 */

import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { KIND_MESSAGE, KIND_DELETE, KIND_EDIT, KIND_REACTION } from "@/concord-v2/lib/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
  type StreamSigner,
} from "@/concord-v2/lib/stream";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import { fetchChannelActive } from "@/lib/concordHelpers";

/** Aggregated reactions for one emoji on a message. */
export interface ReactionSummary {
  emoji: string;
  count: number;
  /** The viewer's own reaction rumor id, when they reacted with this emoji
   *  (tap again to remove). */
  myRumorId?: string;
}

/** Snippet of the message a quote-reply points at. */
export interface ReplySnippet {
  id: string;
  pubkey: string;
  content: string;
}

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
  /** Quote-reply target (NIP-C7 `q` tag), resolved against the timeline. */
  replyTo?: ReplySnippet;
  /** Aggregated kind-7 reactions. */
  reactions?: ReactionSummary[];
}

/** How long an unconfirmed optimistic op survives refetches (ms). */
const PENDING_TTL = 60_000;

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

/** Local, not-yet-relay-confirmed reaction ops to re-apply over relay data. */
interface ReactionOps {
  /** key `${targetId}:${emoji}` → viewer's pending reaction rumor id + expiry. */
  adds: Map<string, { rumorId: string; expires: number }>;
  /** Reaction rumor ids removed locally → expiry. */
  removals: Map<string, number>;
}

export function useChannelChat(
  channel: ChannelV2 | undefined,
  viewerPubkey?: string,
  banned?: Set<string>,
) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const channelRef = useRef(channel);
  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  const viewerRef = useRef(viewerPubkey);
  useEffect(() => {
    viewerRef.current = viewerPubkey;
  }, [viewerPubkey]);

  const bannedRef = useRef(banned);
  useEffect(() => {
    bannedRef.current = banned;
  }, [banned]);

  // Message rumor ids deleted locally → tombstone expiry (bridges the gap
  // between "delete wrap published" and "delete wrap visible on relays").
  const tombstonesRef = useRef(new Map<string, number>());
  const reactionOpsRef = useRef<ReactionOps>({ adds: new Map(), removals: new Map() });

  const channelId = channel?.idHex;
  const queryKey = useMemo(() => ["channel-chat", channelId] as const, [channelId]);

  const { data: messages, isLoading } = useQuery<ChatMessage[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const ch = channelRef.current;
      if (!ch) return [];

      // Shared deduped wrap fetch (one relay round-trip across all hooks
      // on this channel, invalidated by the live subscription).
      const { active } = await fetchChannelActive(nostr, queryClient, ch, signal, bannedRef.current);
      const chatEvents = active.filter((e) => e.kind === KIND_MESSAGE);

      // ── Edits (kind 3302): author-only, latest by ms wins ──────────────
      const editsByTarget = new Map<string, { author: string; content: string; ms: number }[]>();
      // ── Reactions (kind 7): target → raw reactions ─────────────────────
      const reactionsByTarget = new Map<string, { emoji: string; author: string; rumorId: string; ms: number }[]>();

      for (const e of active) {
        if (e.kind === KIND_EDIT) {
          const target = e.tags.find((t) => t[0] === "e")?.[1];
          if (!target) continue;
          let list = editsByTarget.get(target);
          if (!list) editsByTarget.set(target, (list = []));
          list.push({ author: e.author, content: e.content, ms: e.ms });
        } else if (e.kind === KIND_REACTION) {
          const emoji = e.content.trim();
          if (!emoji) continue;
          const target = e.tags.find((t) => t[0] === "e")?.[1];
          if (!target) continue;
          let list = reactionsByTarget.get(target);
          if (!list) reactionsByTarget.set(target, (list = []));
          list.push({ emoji, author: e.author, rumorId: e.rumorId, ms: e.ms });
        }
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
            replyTo: e.tags.find((t) => t[0] === "q")?.[1]
              ? { id: e.tags.find((t) => t[0] === "q")![1], pubkey: "", content: "" }
              : undefined,
          };
        });

      const freshIds = new Set(fresh.map((m) => m.id));

      // Prune expired local ops.
      const now = Date.now();
      for (const [id, expires] of tombstonesRef.current) {
        if (expires <= now) tombstonesRef.current.delete(id);
      }
      const ops = reactionOpsRef.current;
      for (const [key, op] of ops.adds) if (op.expires <= now) ops.adds.delete(key);
      for (const [id, expires] of ops.removals) if (expires <= now) ops.removals.delete(id);

      const visible = fresh.filter((m) => !tombstonesRef.current.has(m.id));

      // Resolve quote-reply snippets against the timeline.
      const byId = new Map(visible.map((m) => [m.id, m]));
      for (const m of visible) {
        if (m.replyTo && m.replyTo.id !== m.id) {
          const target = byId.get(m.replyTo.id);
          m.replyTo = target
            ? { id: target.id, pubkey: target.pubkey, content: target.content.slice(0, 120) }
            : undefined;
        } else {
          m.replyTo = undefined;
        }
      }

      // Attach reaction summaries (one reaction per emoji per author,
      // latest wins; local removals hide, local adds re-apply).
      const viewer = viewerRef.current;
      for (const m of visible) {
        const raw = (reactionsByTarget.get(m.id) ?? []).filter((r) => !ops.removals.has(r.rumorId));
        const perAuthor = new Map<string, (typeof raw)[number]>();
        for (const r of raw) {
          const k = `${r.author}:${r.emoji}`;
          const prev = perAuthor.get(k);
          if (!prev || r.ms > prev.ms) perAuthor.set(k, r);
        }

        const summaries = new Map<string, ReactionSummary>();
        let confirmedViewerEmojis: Set<string> | undefined;
        for (const r of perAuthor.values()) {
          const entry = summaries.get(r.emoji) ?? { emoji: r.emoji, count: 0 };
          entry.count++;
          if (viewer && r.author === viewer) {
            entry.myRumorId = r.rumorId;
            (confirmedViewerEmojis ??= new Set()).add(r.emoji);
          }
          summaries.set(r.emoji, entry);
        }
        // Re-apply the viewer's unconfirmed reactions.
        if (viewer) {
          for (const [key, op] of ops.adds) {
            const [targetId, emoji] = key.split("\n");
            if (targetId !== m.id) continue;
            if (confirmedViewerEmojis?.has(emoji)) {
              ops.adds.delete(key); // relay copy arrived — confirmed
              continue;
            }
            const entry = summaries.get(emoji) ?? { emoji, count: 0 };
            entry.count++;
            entry.myRumorId = op.rumorId;
            summaries.set(emoji, entry);
          }
        }
        m.reactions = summaries.size > 0 ? [...summaries.values()] : undefined;
      }

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

  const sendMessage = useCallback(
    async (
      text: string,
      signer: StreamSigner,
      senderPubkey: string,
      attachmentTags?: string[][],
      replyTo?: ChatMessage,
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
          ...(replyTo ? [["q", replyTo.id, "", replyTo.pubkey]] : []),
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
        replyTo: replyTo
          ? { id: replyTo.id, pubkey: replyTo.pubkey, content: replyTo.content.slice(0, 120) }
          : undefined,
      };

      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) => {
        if (old.some((m) => m.id === rumor.id)) return old;
        return [...old, optimisticMsg];
      });

      try {
        await publish(ch, rumor, signer);
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
    [publish, queryClient, queryKey]
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
      tombstonesRef.current.set(rumorId, Date.now() + PENDING_TTL);
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
        await publish(ch, rumor, signer);
      } catch (err) {
        // Publish failed — lift the tombstone and restore via refetch.
        tombstonesRef.current.delete(rumorId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }
    },
    [publish, queryClient, queryKey]
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
        await publish(ch, rumor, signer);
      } catch (err) {
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
      }, 1000);
    },
    [publish, queryClient, queryKey]
  );

  /** React to a message with an emoji (kind 7, NIP-25 inside the rumor). */
  const sendReaction = useCallback(
    async (
      target: ChatMessage,
      emoji: string,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !emoji.trim()) return;

      const opsKey = `${target.id}\n${emoji}`;
      const tempId = `pending-reaction-${Date.now()}`;
      reactionOpsRef.current.adds.set(opsKey, { rumorId: tempId, expires: Date.now() + PENDING_TTL });
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) =>
        old.map((m) => {
          if (m.id !== target.id) return m;
          const reactions = [...(m.reactions ?? [])];
          const idx = reactions.findIndex((r) => r.emoji === emoji);
          if (idx >= 0) {
            reactions[idx] = { ...reactions[idx], count: reactions[idx].count + 1, myRumorId: tempId };
          } else {
            reactions.push({ emoji, count: 1, myRumorId: tempId });
          }
          return { ...m, reactions };
        })
      );

      const rumor = buildRumor({
        kind: KIND_REACTION,
        content: emoji,
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", target.id],
          ["p", target.pubkey],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        reactionOpsRef.current.adds.delete(opsKey);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
      }, 1000);
    },
    [publish, queryClient, queryKey]
  );

  /** Remove the viewer's own reaction (kind 5 targeting the reaction rumor). */
  const removeReaction = useCallback(
    async (
      reactionRumorId: string,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !reactionRumorId) return;

      // If the reaction is still pending (never reached a relay), just drop
      // the pending add — there's nothing to delete on the wire.
      for (const [key, op] of reactionOpsRef.current.adds) {
        if (op.rumorId === reactionRumorId) reactionOpsRef.current.adds.delete(key);
      }

      reactionOpsRef.current.removals.set(reactionRumorId, Date.now() + PENDING_TTL);
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) =>
        old.map((m) => {
          if (!m.reactions?.some((r) => r.myRumorId === reactionRumorId)) return m;
          const reactions = m.reactions
            .map((r) =>
              r.myRumorId === reactionRumorId
                ? { ...r, count: r.count - 1, myRumorId: undefined }
                : r
            )
            .filter((r) => r.count > 0);
          return { ...m, reactions: reactions.length > 0 ? reactions : undefined };
        })
      );

      const rumor = buildRumor({
        kind: KIND_DELETE,
        content: "deleted",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", reactionRumorId],
          ["k", String(KIND_REACTION)],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        reactionOpsRef.current.removals.delete(reactionRumorId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }
    },
    [publish, queryClient, queryKey]
  );

  return {
    messages: messages ?? [],
    isLoading,
    sendMessage,
    deleteMessage,
    editMessage,
    sendReaction,
    removeReaction,
  };
}
