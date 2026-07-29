/**
 * NIP-52 calendar events over Concord V2 sealed rumors (CORD.md "Calendar
 * Events") — ported from Armada's calendar port so both clients fold
 * bit-for-bit identically.
 *
 * Events are kind 31922 (date-based, `YYYY-MM-DD`) or 31923 (time-based, unix
 * seconds) rumors inside channel wraps. Addressable identity is (author, `d`)
 * within the channel — republishing with the same `d` edits the event. RSVPs
 * are kind 31925 side events referencing the event's rumor id via an `e` tag,
 * tallied latest-per-pubkey.
 */

import {
  KIND_CALENDAR_DATE,
  KIND_CALENDAR_TIME,
} from "@/concord-v2/lib/kinds";
import type { OpenedEvent } from "@/concord-v2/lib/stream";

export { KIND_CALENDAR_DATE, KIND_CALENDAR_TIME, KIND_CALENDAR_RSVP } from "@/concord-v2/lib/kinds";

// ── Types ────────────────────────────────────────────────────────────────────

/** RSVP status (NIP-52). */
export type RsvpStatus = "accepted" | "declined" | "tentative";

/** A participant referenced by a calendar event's `p` tag. */
export interface CalendarParticipant {
  pubkey: string;
  relay?: string;
  role?: string;
}

/** A parsed NIP-52 calendar event folded from a sealed rumor. */
export interface CalendarEvent {
  /** The event's rumor id — what RSVPs and deletes reference. */
  rumorId: string;
  author: string;
  createdAt: number;
  /** Addressable `d` identifier (edits republish with the same `d`). */
  identifier: string;
  kind: typeof KIND_CALENDAR_DATE | typeof KIND_CALENDAR_TIME;
  title: string;
  /** Freeform description (rumor content). */
  description: string;
  summary?: string;
  image?: string;
  location?: string;
  /** 31922: `YYYY-MM-DD`. 31923: unix seconds (as a string). */
  start: string;
  end?: string;
  startTzid?: string;
  hashtags: string[];
  references: string[];
  participants: CalendarParticipant[];
  /** Contribution extension: one suggested amount + payment handles. */
  amount?: string;
  cashapp?: string;
  venmo?: string;
  lightning?: string;
}

/** Input for building a calendar-event rumor. */
export interface CalendarEventInput {
  identifier: string;
  kind: typeof KIND_CALENDAR_DATE | typeof KIND_CALENDAR_TIME;
  title: string;
  description?: string;
  summary?: string;
  image?: string;
  location?: string;
  start: string;
  end?: string;
  startTzid?: string;
  hashtags?: string[];
  references?: string[];
  participants?: CalendarParticipant[];
  /**
   * Contribution extension (custom tags, ignored by other NIP-52 clients):
   * one suggested amount plus the host's payment handles.
   */
  amount?: string;
  cashapp?: string;
  venmo?: string;
  lightning?: string;
}

/** A single member's RSVP (latest per pubkey wins). */
export interface RsvpVote {
  pubkey: string;
  status: RsvpStatus;
  /** Ordering timestamp in epoch milliseconds. */
  ms: number;
}

export interface RsvpTally {
  accepted: string[];
  declined: string[];
  tentative: string[];
  mine?: RsvpStatus;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;

function tag(event: { tags: string[][] }, name: string): string[] | undefined {
  return event.tags.find((t) => t[0] === name);
}

/** A short random identifier suitable for a NIP-52 `d` tag. */
export function randomCalendarId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Build the NIP-52 tags for a calendar rumor (channel binding added by the caller). */
export function buildCalendarTags(input: CalendarEventInput): string[][] {
  const tags: string[][] = [
    ["d", input.identifier],
    ["title", input.title],
    ["start", input.start],
  ];
  if (input.end) tags.push(["end", input.end]);
  if (input.kind === KIND_CALENDAR_TIME && input.startTzid) tags.push(["start_tzid", input.startTzid]);
  if (input.summary) tags.push(["summary", input.summary]);
  if (input.image) tags.push(["image", input.image]);
  if (input.location) tags.push(["location", input.location]);
  // Contribution extension (custom tags; plain NIP-52 clients ignore them).
  if (input.amount) tags.push(["amount", input.amount]);
  if (input.cashapp) tags.push(["cashapp", input.cashapp]);
  if (input.venmo) tags.push(["venmo", input.venmo]);
  if (input.lightning) tags.push(["lightning", input.lightning]);
  for (const t of input.hashtags ?? []) if (t.trim()) tags.push(["t", t.trim()]);
  for (const r of input.references ?? []) if (r.trim()) tags.push(["r", r.trim()]);
  for (const p of input.participants ?? []) {
    if (!HEX64.test(p.pubkey)) continue;
    const t = ["p", p.pubkey, p.relay ?? ""];
    if (p.role) t.push(p.role);
    tags.push(t);
  }
  return tags;
}

/** Parse a kind 31922/31923 rumor into a CalendarEvent (undefined when invalid). */
export function parseCalendarRumor(ev: OpenedEvent): CalendarEvent | undefined {
  if (ev.kind !== KIND_CALENDAR_DATE && ev.kind !== KIND_CALENDAR_TIME) return undefined;
  const identifier = tag(ev, "d")?.[1];
  const title = tag(ev, "title")?.[1];
  const start = tag(ev, "start")?.[1];
  if (!identifier || !title || !start) return undefined;
  if (ev.kind === KIND_CALENDAR_DATE && !DATE_RE.test(start)) return undefined;
  if (ev.kind === KIND_CALENDAR_TIME && !TS_RE.test(start)) return undefined;

  const hashtags: string[] = [];
  const references: string[] = [];
  const participants: CalendarParticipant[] = [];
  for (const [n, v, slot2, slot3] of ev.tags) {
    if (n === "t" && v) hashtags.push(v);
    else if (n === "r" && v) references.push(v);
    else if (n === "p" && HEX64.test(v ?? "")) {
      participants.push({ pubkey: v, relay: slot2 || undefined, role: slot3 || undefined });
    }
  }

  return {
    rumorId: ev.rumorId,
    author: ev.author,
    createdAt: ev.createdAt,
    identifier,
    kind: ev.kind,
    title,
    description: ev.content ?? "",
    summary: tag(ev, "summary")?.[1],
    image: tag(ev, "image")?.[1],
    location: tag(ev, "location")?.[1],
    start,
    end: tag(ev, "end")?.[1] || undefined,
    startTzid: tag(ev, "start_tzid")?.[1],
    hashtags,
    references,
    participants,
    amount: tag(ev, "amount")?.[1],
    cashapp: tag(ev, "cashapp")?.[1],
    venmo: tag(ev, "venmo")?.[1],
    lightning: tag(ev, "lightning")?.[1],
  };
}

/** Sort key for a calendar event: its start as an epoch second. */
export function startEpoch(e: CalendarEvent): number {
  if (e.kind === KIND_CALENDAR_TIME) return Number(e.start) || 0;
  const ms = Date.parse(`${e.start}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/** End of an event in epoch seconds, falling back to its start. */
export function endEpoch(e: CalendarEvent): number {
  if (!e.end) return startEpoch(e);
  if (e.kind === KIND_CALENDAR_TIME) return Number(e.end) || startEpoch(e);
  const ms = Date.parse(`${e.end}T00:00:00Z`);
  return Number.isNaN(ms) ? startEpoch(e) : Math.floor(ms / 1000);
}

/** True if the event has not yet ended (upcoming or in progress). */
export function isUpcoming(e: CalendarEvent, now = Math.floor(Date.now() / 1000)): boolean {
  return endEpoch(e) >= now;
}

/**
 * Fold a batch of calendar rumors: keep the newest per addressable coordinate
 * (kind:author:d), drop malformed ones, sort soonest-first.
 */
export function foldCalendarRumors(opened: OpenedEvent[]): CalendarEvent[] {
  const newest = new Map<string, CalendarEvent>();
  for (const ev of opened) {
    const parsed = parseCalendarRumor(ev);
    if (!parsed) continue;
    const coord = `${parsed.kind}:${parsed.author}:${parsed.identifier}`;
    const existing = newest.get(coord);
    if (!existing || existing.createdAt < parsed.createdAt) newest.set(coord, parsed);
  }
  return [...newest.values()].sort((a, b) => startEpoch(a) - startEpoch(b));
}

/** Parse a kind 31925 RSVP rumor into a vote (undefined when invalid). */
export function parseRsvpRumor(ev: OpenedEvent): { target: string; vote: RsvpVote } | undefined {
  const target = tag(ev, "e")?.[1];
  const status = tag(ev, "status")?.[1];
  if (!target) return undefined;
  if (status !== "accepted" && status !== "declined" && status !== "tentative") return undefined;
  return { target, vote: { pubkey: ev.author, status, ms: ev.ms } };
}

/** Tally RSVPs for one event: latest per pubkey wins, viewer's status surfaced. */
export function tallyRsvps(votes: RsvpVote[], selfPubkey: string | undefined): RsvpTally {
  const latest = new Map<string, RsvpVote>();
  for (const vote of votes) {
    const existing = latest.get(vote.pubkey);
    if (!existing || vote.ms > existing.ms) latest.set(vote.pubkey, vote);
  }
  const tally: RsvpTally = { accepted: [], declined: [], tentative: [] };
  for (const vote of latest.values()) {
    tally[vote.status].push(vote.pubkey);
    if (selfPubkey && vote.pubkey === selfPubkey) tally.mine = vote.status;
  }
  return tally;
}

/** Format a calendar event's date/time range for display. */
export function formatCalendarEventWhen(event: CalendarEvent): string {
  if (event.kind === KIND_CALENDAR_TIME) {
    const start = new Date(Number(event.start) * 1000);
    const end = event.end ? new Date(Number(event.end) * 1000) : undefined;
    const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    const startStr = `${start.toLocaleDateString(undefined, dateFmt)}, ${start.toLocaleTimeString(undefined, timeFmt)}`;
    if (!end) return startStr;
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) return `${startStr} – ${end.toLocaleTimeString(undefined, timeFmt)}`;
    return `${startStr} – ${end.toLocaleDateString(undefined, dateFmt)}, ${end.toLocaleTimeString(undefined, timeFmt)}`;
  }
  // Date-based: YYYY-MM-DD (– YYYY-MM-DD), noon-anchored against TZ day-shift.
  const start = new Date(`${event.start}T12:00:00`);
  const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (!event.end) return start.toLocaleDateString(undefined, dateFmt);
  const end = new Date(`${event.end}T12:00:00`);
  return `${start.toLocaleDateString(undefined, dateFmt)} – ${end.toLocaleDateString(undefined, dateFmt)}`;
}
