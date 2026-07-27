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
import { KIND_MESSAGE, KIND_WRAP } from "@/concord-v2/lib/kinds";
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

export interface ChatMessage {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
}

export function useChannelChat(channel: ChannelV2 | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const queryKey = ["channel-chat", channel?.idHex];

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
      const chatEvents = opened.filter((e) => e.kind === KIND_MESSAGE);

      return chatEvents
        .map((e): ChatMessage => ({
          id: e.rumorId,
          pubkey: e.author,
          content: e.content,
          createdAt: e.createdAt,
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
    },
    enabled: !!channel,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const sendMessage = useCallback(
    async (text: string, signer: StreamSigner) => {
      const ch = channelRef.current;
      if (!ch || !text.trim()) return;

      const now = Date.now();
      const pubkey = await getSignerPubkey(signer);

      const rumor = buildRumor({
        kind: KIND_MESSAGE,
        content: text.trim(),
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
        ],
        pubkey,
        ms: now,
      });

      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);

      await nostr.event(wrap);
      queryClient.invalidateQueries({ queryKey });
    },
    [nostr, queryClient]
  );

  return { messages: messages ?? [], sendMessage };
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
