/**
 * useLiveChannelEvents — streaming subscription for instant channel updates.
 *
 * The 15s polling in useChannelChat / useSignUpBoard is only a reconciliation
 * net; this hook is what makes the app feel live. It opens one streaming REQ
 * for every channel stream the member can read, and as new wraps arrive:
 *
 *  - kind-9 chat messages are decrypted and appended to the chat query cache
 *    immediately (sub-second delivery, no relay round-trip wait);
 *  - edits / deletes / sign-up items invalidate the affected query, triggering
 *    a background refold (cheap thanks to the opened-wrap memo cache).
 */

import { useNostr } from "@nostrify/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { KIND_DELETE, KIND_EDIT, KIND_MESSAGE, KIND_REACTION, KIND_WRAP } from "@/concord-v2/lib/kinds";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "nostr-tools/pure";
import { openChannelWraps } from "@/lib/concordHelpers";
import { KIND_SIGNUP_ITEM } from "@/lib/signUpModel";
import { imagesFromImeta, type ChatMessage } from "@/hooks/useChannelChat";

export function useLiveChannelEvents(channels: ChannelV2[]) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  // Ref so the effect reads the latest channel objects without resubscribing
  // on every control-plane refold (which mints new object identities).
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // Stable signature of the stream pubkey set — the effect resubscribes only
  // when the actual streams change (epoch rotation, channel add/remove).
  const streamSig = useMemo(
    () =>
      channels
        .flatMap((ch) => ch.streams.map((s) => s.group.pk))
        .sort()
        .join(","),
    [channels]
  );

  useEffect(() => {
    if (!streamSig) return;
    const pks = streamSig.split(",");

    const controller = new AbortController();
    // Small overlap for clock skew between us and the publishing client.
    const since = Math.floor(Date.now() / 1000) - 5;

    // Stream pubkey → owning channel, built once per subscription (a changed
    // stream set changes streamSig, which resubscribes and rebuilds this).
    const byPk = new Map<string, ChannelV2>();
    for (const ch of channelsRef.current) {
      for (const s of ch.streams) byPk.set(s.group.pk, ch);
    }

    (async () => {
      try {
        for await (const msg of nostr.req(
          [{ kinds: [KIND_WRAP], authors: pks, since }],
          { signal: controller.signal }
        )) {
          if (msg[0] !== "EVENT") continue;
          const wrap = msg[2] as NostrEvent;

          const ch = byPk.get(wrap.pubkey);
          if (!ch) continue;

          const opened = openChannelWraps([wrap], ch);
          for (const ev of opened) {
            const chatKey = ["channel-chat", ch.idHex] as const;
            const boardKey = ["sign-up-board", ch.idHex] as const;

            if (ev.kind === KIND_MESSAGE) {
              const imeta = ev.tags?.filter((t: string[]) => t[0] === "imeta") ?? [];
              queryClient.setQueryData<ChatMessage[]>(chatKey, (old = []) => {
                // Resolve the quote-reply snippet against cached messages so
                // the confirmed flip keeps the quote the optimistic copy had.
                const qId = ev.tags.find((t) => t[0] === "q")?.[1];
                const replyTarget = qId ? old.find((m) => m.id === qId) : undefined;
                const confirmed: ChatMessage = {
                  id: ev.rumorId,
                  pubkey: ev.author,
                  content: ev.content,
                  createdAt: ev.createdAt,
                  imeta,
                  images: imagesFromImeta(imeta),
                  replyTo: replyTarget
                    ? { id: replyTarget.id, pubkey: replyTarget.pubkey, content: replyTarget.content.slice(0, 120) }
                    : undefined,
                };
                if (old.some((m) => m.id === ev.rumorId)) {
                  // Our own optimistic send — flip it to confirmed in place,
                  // keeping any reactions already gathered.
                  return old.map((m) =>
                    m.id === ev.rumorId ? { ...confirmed, reactions: m.reactions } : m
                  );
                }
                return [...old, confirmed].sort((a, b) => a.createdAt - b.createdAt);
              });
            } else if (ev.kind === KIND_DELETE || ev.kind === KIND_EDIT || ev.kind === KIND_REACTION) {
              // Refold both views of the channel — edits, deletes, and
              // reactions can target chat messages or sign-up items alike.
              queryClient.invalidateQueries({ queryKey: chatKey });
              queryClient.invalidateQueries({ queryKey: boardKey });
            } else if (ev.kind === KIND_SIGNUP_ITEM) {
              queryClient.invalidateQueries({ queryKey: boardKey });
            }
          }
        }
      } catch {
        // Aborted (unmount/resubscribe) or the relay dropped — the
        // reconciliation polls cover any gap until the next subscribe.
      }
    })();

    return () => controller.abort();
  }, [nostr, queryClient, streamSig]);
}
