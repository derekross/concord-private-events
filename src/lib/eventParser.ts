/**
 * Parse structured event details from channel messages.
 *
 * Looks for common patterns like "Date: July 27", "Time: 3:00 PM",
 * "Location: 123 Main St", "Where: ...", "When: ..." in messages
 * posted to the event-info channel.
 *
 * Falls back to showing raw messages if no structured data is found.
 */

export interface ParsedEventDetails {
  date?: string;
  time?: string;
  location?: string;
  notes: string[];
}

// Patterns for extracting structured data from freeform text
const DATE_PATTERNS = [
  /\b(?:date|when)\s*[:-]\s*(.+)/i,
  /\b(?:📅)\s*(.+)/i,
];

const TIME_PATTERNS = [
  /\b(?:time|when)\s*[:-]\s*(.+)/i,
  /\b(?:🕐|⏰|🕒)\s*(.+)/i,
];

const LOCATION_PATTERNS = [
  /\b(?:location|where|address|venue|place|at)\s*[:-]\s*(.+)/i,
  /\b(?:📍|🗺️|🏠)\s*(.+)/i,
];

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

export function parseEventDetails(messages: { content: string; createdAt: number }[]): ParsedEventDetails {
  const details: ParsedEventDetails = { notes: [] };

  // Combine all message content, but also check each individually
  for (const msg of messages) {
    const text = msg.content;

    // Try combined date+time first
    if (!details.date && !details.time) {
      const combined = tryMatch(text, DATETIME_COMBINED);
      if (combined) {
        // Try to split into date and time
        const timeMatch = combined.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/);
        const dateMatch = combined.replace(timeMatch?.[0] ?? "", "").replace(/[,@]+/g, "").trim();
        if (timeMatch) {
          details.time = timeMatch[0].trim();
          details.date = dateMatch || undefined;
        } else {
          details.date = combined;
        }
      }
    }

    if (!details.date) {
      details.date = tryMatch(text, DATE_PATTERNS);
    }

    if (!details.time) {
      details.time = tryMatch(text, TIME_PATTERNS);
    }

    if (!details.location) {
      details.location = tryMatch(text, LOCATION_PATTERNS);
    }

    // If this message didn't contribute structured data, keep it as a note
    const contributed = DATE_PATTERNS.some((p) => p.test(text)) ||
      TIME_PATTERNS.some((p) => p.test(text)) ||
      LOCATION_PATTERNS.some((p) => p.test(text));

    if (!contributed && text.trim().length > 0) {
      details.notes.push(text.trim());
    }
  }

  return details;
}

/**
 * Generate a Google Calendar "add event" URL from parsed details.
 */
export function googleCalendarUrl(details: ParsedEventDetails, title: string): string | null {
  if (!details.date) return null;

  // Try to parse the date/time into something Google Calendar understands
  const dateStr = details.date;
  const timeStr = details.time ?? "";

  const parsed = new Date(`${dateStr} ${timeStr}`.trim());
  const now = new Date();
  const isValid = !isNaN(parsed.getTime()) && parsed.getTime() > now.getTime() - 365 * 24 * 60 * 60 * 1000;

  const params = new URLSearchParams();
  params.set("text", title);

  if (isValid) {
    // Format as YYYYMMDDTHHMMSS (Google Calendar format)
    const start = formatGoogleDate(parsed);
    const end = formatGoogleDate(new Date(parsed.getTime() + 3 * 60 * 60 * 1000)); // 3 hour default
    params.set("dates", `${start}/${end}`);
  } else {
    // Can't parse date — just include it in details
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

/**
 * Generate a Google Maps search URL for a location string.
 */
export function googleMapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * Generate an Apple Calendar (.ics) data URL as a fallback.
 */
export function icsDataUrl(details: ParsedEventDetails, title: string): string | null {
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

  const ics = [
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

  return `data:text/calendar;charset=utf8,${encodeURIComponent(ics)}`;
}
