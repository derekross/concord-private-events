/**
 * useChannelCalendar — NIP-52 calendar events + RSVPs in a Concord V2 channel.
 *
 * Reads kind-1059 wraps for the channel, folds kind 31922/31923 event rumors
 * (addressable per kind:author:d, newest wins) and kind 31925 RSVPs (latest
 * per pubkey wins). Provides save/delete/RSVP mutations, all optimistic with
 * the same refetch-proof pending-ops discipline as useChannelChat.
 */

import { useNostr } from "@nostrify/react";
import { useCommunityRelays } from "@/contexts/CommunityRelaysContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { KIND_DELETE } from "@/concord-v2/lib/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
  type StreamSigner,
} from "@/concord-v2/lib/stream";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import { fetchChannelActive } from "@/lib/concordHelpers";
import {
  buildCalendarTags,
  foldCalendarRumors,
  parseCalendarRumor,
  parseRsvpRumor,
  tallyRsvps,
  type CalendarEvent,
  type CalendarEventInput,
  type RsvpStatus,
  type RsvpTally,
  type RsvpVote,
  KIND_CALENDAR_DATE,
  KIND_CALENDAR_TIME,
  KIND_CALENDAR_RSVP,
} from "@/lib/calendar";

/** How long an unconfirmed optimistic op survives refetches (ms). RSVPs get
 *  a wider window than messages: there's no "Sending…" affordance on the
 *  chips, so a slow signer/relay vanishing after 60s reads as data loss. */
const PENDING_TTL = 3 * 60_000;

interface CalendarData {
  events: CalendarEvent[];
  votesByEvent: Record<string, RsvpVote[]>;
}

export function useChannelCalendar(
  channel: ChannelV2 | undefined,
  viewerPubkey?: string,
  banned?: Set<string>,
) {
  const { nostr } = useNostr();
  const relays = useCommunityRelays();
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

  // Event rumor ids deleted locally → expiry.
  const tombstonesRef = useRef(new Map<string, number>());
  // The viewer's unconfirmed RSVPs: targetId → vote + expiry.
  const pendingRsvpsRef = useRef(new Map<string, { vote: RsvpVote; expires: number }>());

  const channelId = channel?.idHex;
  const queryKey = useMemo(() => ["channel-calendar", channelId] as const, [channelId]);

  const { data, isLoading } = useQuery<CalendarData>({
    queryKey,
    queryFn: async ({ signal }) => {
      const ch = channelRef.current;
      if (!ch) return { events: [], votesByEvent: {} };

      // Shared deduped wrap fetch (one relay round-trip across all hooks
      // on this channel, invalidated by the live subscription).
      const { active } = await fetchChannelActive(nostr, queryClient, ch, signal, bannedRef.current, relays);

      const now = Date.now();
      for (const [id, expires] of tombstonesRef.current) {
        if (expires <= now) tombstonesRef.current.delete(id);
      }
      for (const [target, op] of pendingRsvpsRef.current) {
        if (op.expires <= now) pendingRsvpsRef.current.delete(target);
      }

      const events = foldCalendarRumors(active).filter((e) => !tombstonesRef.current.has(e.rumorId));

      // RSVPs reference an event's rumor id, but edits mint a NEW rumor id —
      // so votes aimed at a superseded version would orphan. Map every
      // calendar rumor id → its addressable coordinate, and re-point votes
      // at the current holder of that coordinate.
      const coordByRumorId = new Map<string, string>();
      for (const ev of active) {
        if (ev.kind !== KIND_CALENDAR_DATE && ev.kind !== KIND_CALENDAR_TIME) continue;
        const parsed = parseCalendarRumor(ev);
        if (parsed) {
          coordByRumorId.set(parsed.rumorId, `${parsed.kind}:${parsed.author}:${parsed.identifier}`);
        }
      }
      const currentByCoord = new Map<string, string>();
      for (const e of events) {
        currentByCoord.set(`${e.kind}:${e.author}:${e.identifier}`, e.rumorId);
      }

      const votesByEvent: Record<string, RsvpVote[]> = {};
      for (const ev of active) {
        if (ev.kind !== KIND_CALENDAR_RSVP) continue;
        const parsed = parseRsvpRumor(ev);
        if (!parsed) continue;
        const coord = coordByRumorId.get(parsed.target);
        const target = coord ? (currentByCoord.get(coord) ?? parsed.target) : parsed.target;
        (votesByEvent[target] ??= []).push(parsed.vote);
      }

      // Re-apply the viewer's unconfirmed RSVPs. Drop the pending op once
      // ANY vote from the viewer exists on relays for that target — the
      // tally takes the latest by ms anyway, and rumor timestamps are
      // tweaked (±2h), so an ms comparison here is unreliable.
      const viewer = viewerRef.current;
      if (viewer) {
        for (const [target, op] of pendingRsvpsRef.current) {
          const relayVotes = votesByEvent[target] ?? [];
          if (relayVotes.some((v) => v.pubkey === viewer)) {
            pendingRsvpsRef.current.delete(target);
            continue;
          }
          votesByEvent[target] = [...relayVotes.filter((v) => v.pubkey !== viewer), op.vote];
        }
      }

      return { events, votesByEvent };
    },
    enabled: !!channel,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 15_000,
  });

  const events = data?.events ?? [];

  /** RSVP tally for one event (latest per pubkey; viewer's status surfaced). */
  const rsvpsFor = useCallback(
    (event: CalendarEvent): RsvpTally =>
      tallyRsvps(data?.votesByEvent[event.rumorId] ?? [], viewerPubkey),
    [data, viewerPubkey]
  );

  /** Publish a wrapped rumor to the channel; throws on relay failure. */
  const publish = useCallback(
    async (
      ch: ChannelV2,
      rumor: ReturnType<typeof buildRumor>,
      signer: StreamSigner,
    ) => {
      const seal = await sealRumor(rumor, 20013, ch.current.group, signer);
      const wrap = wrapSeal(seal, ch.current.group);
      await nostr.event(wrap, { relays });
    },
    [nostr, relays]
  );

  /** Create or update (same `d`) a calendar event. */
  const saveEvent = useCallback(
    async (
      input: CalendarEventInput,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch || !input.title.trim()) return;

      const now = Date.now();
      const rumor = buildRumor({
        kind: input.kind,
        content: input.description ?? "",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ...buildCalendarTags(input),
        ],
        pubkey: senderPubkey,
        ms: now,
      });

      // Optimistic upsert (replace same coordinate, else append).
      const optimistic: CalendarEvent = {
        rumorId: rumor.id,
        author: senderPubkey,
        createdAt: rumor.created_at,
        identifier: input.identifier,
        kind: input.kind,
        title: input.title,
        description: input.description ?? "",
        summary: input.summary,
        image: input.image,
        location: input.location,
        start: input.start,
        end: input.end,
        startTzid: input.startTzid,
        hashtags: input.hashtags ?? [],
        references: input.references ?? [],
        participants: input.participants ?? [],
      };
      queryClient.setQueryData<CalendarData>(queryKey, (old) => {
        const prev = old ?? { events: [], votesByEvent: {} };
        const coord = (e: CalendarEvent) => `${e.kind}:${e.author}:${e.identifier}`;
        const rest = prev.events.filter((e) => coord(e) !== coord(optimistic));
        return {
          ...prev,
          events: [...rest, optimistic].sort(
            (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0)
          ),
        };
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }

      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 1000);
    },
    [publish, queryClient, queryKey]
  );

  /** Delete a calendar event (kind 5 `e`-tagging its rumor id). */
  const deleteEvent = useCallback(
    async (
      event: CalendarEvent,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch) return;

      tombstonesRef.current.set(event.rumorId, Date.now() + PENDING_TTL);
      queryClient.setQueryData<CalendarData>(queryKey, (old) =>
        old
          ? { ...old, events: old.events.filter((e) => e.rumorId !== event.rumorId) }
          : old
      );

      const rumor = buildRumor({
        kind: KIND_DELETE,
        content: "deleted",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", event.rumorId],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        tombstonesRef.current.delete(event.rumorId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }
    },
    [publish, queryClient, queryKey]
  );

  /** RSVP to an event (kind 31925, latest per pubkey wins). */
  const setRsvp = useCallback(
    async (
      event: CalendarEvent,
      status: RsvpStatus,
      signer: StreamSigner,
      senderPubkey: string,
    ) => {
      const ch = channelRef.current;
      if (!ch) return;

      const vote: RsvpVote = { pubkey: senderPubkey, status, ms: Date.now() };
      pendingRsvpsRef.current.set(event.rumorId, {
        vote,
        expires: Date.now() + PENDING_TTL,
      });
      queryClient.setQueryData<CalendarData>(queryKey, (old) => {
        const prev = old ?? { events: [], votesByEvent: {} };
        const others = (prev.votesByEvent[event.rumorId] ?? []).filter(
          (v) => v.pubkey !== senderPubkey
        );
        return {
          ...prev,
          votesByEvent: { ...prev.votesByEvent, [event.rumorId]: [...others, vote] },
        };
      });

      const rumor = buildRumor({
        kind: KIND_CALENDAR_RSVP,
        content: "",
        tags: [
          ...channelBindingTags(ch.idHex, ch.current.epoch),
          ["e", event.rumorId],
          ["status", status],
          ["k", String(event.kind)],
          ["p", event.author],
        ],
        pubkey: senderPubkey,
        ms: Date.now(),
      });

      try {
        await publish(ch, rumor, signer);
      } catch (err) {
        pendingRsvpsRef.current.delete(event.rumorId);
        queryClient.invalidateQueries({ queryKey });
        throw err;
      }

      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 1000);
    },
    [publish, queryClient, queryKey]
  );

  return { events, isLoading, rsvpsFor, saveEvent, deleteEvent, setRsvp };
}
