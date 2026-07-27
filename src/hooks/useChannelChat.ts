/**
 * useChannelChat — subscribe to and publish chat messages in a Concord V2 channel.
 *
 * Reads kind-1059 wraps addressed to the channel's stream key(s), decrypts
 * them, and folds them into a timeline. Provides a send function that
 * builds, seals, and wraps a kind-9 message rumor.
 */

import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { KIND_MESSAGE, KIND_WRAP, KIND_DELETE } from "@/concord-v2/lib/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
  type OpenedEvent,
  type StreamSigner,
} from "@/concord-v2/lib/stream";
import type { NostrEvent, EventTemplate } from "nostr-tools/pure";
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
}

export function useChannelChat(channel: ChannelV2 | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const queryKey = ["channel-chat", channel?.idHex] as const;

  const { data: messages } = useQuery<ChatMessage[]>({
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

      return chatEvents
        .map((e): ChatMessage => {
          const imeta = e.tags?.filter((t: string[]) => t[0] === "imeta") ?? [];
          const images: string[] = [];
          for (const tag of imeta) {
            const urlIdx = tag.findIndex((v: string) => v.startsWith("url "));
            if (urlIdx >= 0) {
              const url = tag[urlIdx].slice(4);
              if (url) images.push(url);
            }
          }
          return {
            id: e.rumorId,
            pubkey: e.author,
            content: e.content,
            createdAt: e.createdAt,
            imeta,
            images,
          };
        })
        .sort((a, b) => a.createdAt - b.createdAt);
    },
    enabled: !!channel,
    // Keep cached data showing while background refetching happens.
    // This makes tab switches instant — no loading spinner on revisit.
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 10_000,
  });

  const sendMessage = useCallback(
    async (
      text: string,
      signer: StreamSigner,
      attachmentTags?: string[][],
    ) => {
      const ch = channelRef.current;
      if (!ch || (!text.trim() && !attachmentTags?.length)) return;

      const now = Date.now();
      const pubkey = await getSignerPubkey(signer);

      // Optimistic insert: add message to cache immediately
      const tempId = `pending-${now}`;
      const optimisticMsg: ChatMessage = {
        id: tempId,
        pubkey,
        content: text.trim(),
        createdAt: Math.floor(now / 1000),
        imeta: [],
        images: [],
        pending: true,
      };

      // Extract images from attachment tags for optimistic display
      if (attachmentTags) {
        for (const tag of attachmentTags) {
          if (tag[0] === "imeta") {
            optimisticMsg.imeta.push(tag);
            const urlIdx = tag.findIndex((v) => v.startsWith("url "));
            if (urlIdx >= 0) {
              const url = tag[urlIdx].slice(4);
              if (url) optimisticMsg.images.push(url);
            }
          }
        }
      }

      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) => {
        // Avoid duplicates
        if (old.some((m) => m.id === tempId)) return old;
        return [...old, optimisticMsg];
      });

      // Build and publish the actual rumor
      const rumor = buildRumor({
        kind: KIND_MESSAGE,
        content: text.trim(),
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ...(attachmentTags ?? []),
        ],
        pubkey,
        ms: now,
      });

      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);

      await nostr.event(wrap);

      // Refetch in background to replace optimistic message with real one
      // (small delay so the relay has time to store it)
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
      }, 500);
    },
    [nostr, queryClient, queryKey]
  );

  const deleteMessage = useCallback(
    async (
      rumorId: string,
      signer: StreamSigner,
    ) => {
      const ch = channelRef.current;
      if (!ch || !rumorId) return;

      // Optimistic: remove message from cache immediately
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old = []) =>
        old.filter((m) => m.id !== rumorId)
      );

      const pubkey = await getSignerPubkey(signer);

      const rumor = buildRumor({
        kind: KIND_DELETE,
        content: "deleted",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", rumorId],
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

  return { messages: messages ?? [], sendMessage, deleteMessage };
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
