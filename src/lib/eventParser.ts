/**
 * Parse structured event details from channel messages.
 *
 * Line-based: every line of every message is matched against the known
 * patterns (date, time, location, payment methods). A single message can
 * carry the whole event sheet, and any line that matches nothing becomes a
 * note. First match per field wins (oldest posts take precedence; owners
 * update in place via kind-3302 edits).
 */

export interface ParsedPayment {
  method: "cashapp" | "venmo" | "lightning";
  /** Display id as entered ($cashtag / @user / lightning address). */
  id: string;
  /** Optional free-form amount string ("$25", "25 USD", "21k sats"). */
  amount?: string;
  /** Deep/universal link to pay. */
  url: string;
}

export interface ParsedEventDetails {
  date?: string;
  time?: string;
  location?: string;
  /** Single suggested amount for all payment methods ("$25", "25 USD"). */
  amount?: string;
  payments: ParsedPayment[];
  notes: string[];
}

// Patterns for extracting structured data from freeform text
const DATE_PATTERNS = [
  /\b(?:date|when)\s*[:-]\s*(.+)/i,
  /\b(?:📅)\s*(.+)/i,
];

const TIME_PATTERNS = [
  /\b(?:time)\s*[:-]\s*(.+)/i,
  /\b(?:🕐|⏰|🕒)\s*(.+)/i,
];

const LOCATION_PATTERNS = [
  /\b(?:location|where|address|venue|place|at)\s*[:-]\s*(.+)/i,
  /\b(?:📍|🗺️|🏠)\s*(.+)/i,
];

// Payment methods: `Label: <id> [amount…]` — id is the first token, the
// rest of the line is a free-form amount shown verbatim. A standalone
// `Amount: X` line sets ONE suggested amount for every method (preferred —
// per-method amounts only exist for back-compat with hand-posted lines).
const AMOUNT_PATTERN = /\b(?:amount|price|cost|suggested)\s*[:-]\s*(.+)/i;
const CASHAPP_PATTERN = /\b(?:cash\s?app|cashtag)\s*[:-]\s*(\$\S+)(?:\s+(.+))?/i;
const VENMO_PATTERN = /\bvenmo\s*[:-]\s*(@?\S+)(?:\s+(.+))?/i;
const LIGHTNING_PATTERN = /\b(?:lightning|lud16|ln|zap)\s*[:-]\s*(\S+)(?:\s+(.+))?/i;

// Full date+time combos like "July 27 at 3 PM" or "Aug 3, 2026 5:00pm"
const DATETIME_COMBINED = [
  /\b(?:date|when|event)\s*[:-]\s*(.+)/i,
];

function tryMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

/** First plain number inside an amount string ("$25" / "25 USD" → "25"). */
export function numericAmount(amount: string | undefined): string | undefined {
  if (!amount) return undefined;
  const m = amount.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m?.[1];
}

/** Cash App universal link; carries the amount when one is set. */
export function cashAppUrl(id: string, amount?: string): string {
  const tag = id.replace(/^\$+/, "");
  const n = numericAmount(amount);
  return `https://cash.app/$${tag}${n ? `/${n}` : ""}`;
}

/** Venmo universal link; with an amount, goes straight to the pay sheet. */
export function venmoUrl(id: string, amount?: string): string {
  const user = id.replace(/^@+/, "");
  const n = numericAmount(amount);
  return n
    ? `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(user)}&amount=${encodeURIComponent(n)}`
    : `https://venmo.com/u/${encodeURIComponent(user)}`;
}

/** Lightning address / LNURL — the `lightning:` scheme opens wallet apps. */
export function lightningUrl(id: string): string {
  return `lightning:${id}`;
}

export function parseEventDetails(messages: { content: string; createdAt: number }[]): ParsedEventDetails {
  const details: ParsedEventDetails = { payments: [], notes: [] };
  const seenMethods = new Set<string>();

  for (const msg of messages) {
    for (const rawLine of msg.content.split("\n")) {
      const text = rawLine.trim();
      if (!text) continue;

      // Combined date+time first ("Date: July 27 at 3 PM")
      if (!details.date && !details.time) {
        const combined = tryMatch(text, DATETIME_COMBINED);
        if (combined) {
          const timeMatch = combined.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/);
          const dateMatch = combined.replace(timeMatch?.[0] ?? "", "").replace(/[,@]+/g, "").trim();
          if (timeMatch) {
            details.time = timeMatch[0].trim();
            details.date = dateMatch || undefined;
          } else {
            details.date = combined;
          }
          continue;
        }
      }

      if (!details.date) {
        const date = tryMatch(text, DATE_PATTERNS);
        if (date) {
          details.date = date;
          continue;
        }
      }

      if (!details.time) {
        const time = tryMatch(text, TIME_PATTERNS);
        if (time) {
          details.time = time;
          continue;
        }
      }

      if (!details.location) {
        const location = tryMatch(text, LOCATION_PATTERNS);
        if (location) {
          details.location = location;
          continue;
        }
      }

      // Single suggested amount for all methods
      if (!details.amount) {
        const amount = tryMatch(text, [AMOUNT_PATTERN]);
        if (amount) {
          details.amount = amount;
          continue;
        }
      }

      // Payment methods (first per method wins)
      if (!seenMethods.has("cashapp")) {
        const m = text.match(CASHAPP_PATTERN);
        if (m) {
          seenMethods.add("cashapp");
          const amount = m[2]?.trim() || undefined;
          details.payments.push({ method: "cashapp", id: m[1], amount, url: cashAppUrl(m[1], amount) });
          continue;
        }
      }
      if (!seenMethods.has("venmo")) {
        const m = text.match(VENMO_PATTERN);
        if (m) {
          seenMethods.add("venmo");
          const amount = m[2]?.trim() || undefined;
          details.payments.push({ method: "venmo", id: m[1], amount, url: venmoUrl(m[1], amount) });
          continue;
        }
      }
      if (!seenMethods.has("lightning")) {
        const m = text.match(LIGHTNING_PATTERN);
        if (m) {
          seenMethods.add("lightning");
          const amount = m[2]?.trim() || undefined;
          details.payments.push({ method: "lightning", id: m[1], amount, url: lightningUrl(m[1]) });
          continue;
        }
      }

      // Nothing matched → it's a note
      details.notes.push(text);
    }
  }

  // One amount to rule them all: a standalone `Amount:` line applies to
  // every method that doesn't carry its own (and prefills their pay links).
  for (const p of details.payments) {
    const effective = p.amount ?? details.amount;
    if (effective && effective !== p.amount) {
      p.amount = effective;
      if (p.method === "cashapp") p.url = cashAppUrl(p.id, effective);
      else if (p.method === "venmo") p.url = venmoUrl(p.id, effective);
    }
  }

  return details;
}

/**
 * Generate a Google Calendar "add event" URL from parsed details.
 * (Opens the Google Calendar app when installed, web otherwise.)
 */
export function googleCalendarUrl(details: ParsedEventDetails, title: string): string | null {
  if (!details.date) return null;

  const dateStr = details.date;
  const timeStr = details.time ?? "";

  const parsed = new Date(`${dateStr} ${timeStr}`.trim());
  const now = new Date();
  const isValid = !isNaN(parsed.getTime()) && parsed.getTime() > now.getTime() - 365 * 24 * 60 * 60 * 1000;

  const params = new URLSearchParams();
  params.set("text", title);

  if (isValid) {
    const start = formatGoogleDate(parsed);
    const end = formatGoogleDate(new Date(parsed.getTime() + 3 * 60 * 60 * 1000)); // 3 hour default
    params.set("dates", `${start}/${end}`);
  } else {
    params.set("details", `${dateStr}${timeStr ? " " + timeStr : ""}`);
  }

  if (details.location) {
    params.set("location", details.location);
  }

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&${params.toString()}`;
}

function formatGoogleDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  );
}

/** Google Maps search URL (opens the app when installed, web otherwise). */
export function googleMapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/** Apple Maps URL — opens the Maps app on iOS/macOS. */
export function appleMapsUrl(location: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(location)}`;
}

/**
 * Raw .ics file content for the event (Apple Calendar / Outlook / any
 * calendar app). Serve as a blob download — data: URLs are unreliable in
 * iOS Safari.
 */
export function icsContent(details: ParsedEventDetails, title: string): string | null {
  if (!details.date) return null;

  const dateStr = details.date;
  const timeStr = details.time ?? "";
  const parsed = new Date(`${dateStr} ${timeStr}`.trim());

  if (isNaN(parsed.getTime())) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const dt = `${parsed.getFullYear()}${pad(parsed.getMonth() + 1)}${pad(parsed.getDate())}T${pad(parsed.getHours())}${pad(parsed.getMinutes())}00`;
  const dtEnd = (() => {
    const end = new Date(parsed.getTime() + 3 * 60 * 60 * 1000);
    return `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  })();

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ross Seafood Boil//EN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@seafood-boil`,
    `DTSTAMP:${dt}`,
    `DTSTART:${dt}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    details.location ? `LOCATION:${details.location}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\n");
}
