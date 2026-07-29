import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMembership } from "@/hooks/useCommunityMembership";
import { useCommunityData } from "@/hooks/useCommunityData";
import { useControlPlane } from "@/hooks/useControlPlane";
import { useChannels } from "@/hooks/useChannels";
import { EVENT_CONFIG, SIGN_UP_CATEGORIES } from "@/lib/eventConfig";
import { useCustomCategories, categoryLabel, categoryEmoji, EMOJI_CHOICES } from "@/lib/customCategories";
import {
  parseEventDetails,
  googleCalendarUrl,
  googleMapsUrl,
  appleMapsUrl,
  icsContent,
  numericAmount,
  cashAppUrl,
  venmoUrl,
  lightningUrl,
  friendlyDateToIso,
  friendlyTimeToIso,
  type ParsedEventDetails,
  type ParsedPayment,
} from "@/lib/eventParser";
import { isAppleDevice } from "@/lib/device";
import { resolveLightningInvoiceUri, useBtcUsdRate } from "@/lib/lightning";
import { useChannelCalendar } from "@/hooks/useChannelCalendar";
import {
  formatCalendarEventWhen,
  isUpcoming,
  randomCalendarId,
  KIND_CALENDAR_TIME,
  type CalendarEvent,
  type RsvpStatus,
} from "@/lib/calendar";
import { LoginArea } from "@/components/auth/LoginArea";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignUpBoard } from "@/hooks/useSignUpBoard";
import { useChannelChat, type ChatMessage } from "@/hooks/useChannelChat";
import { useLiveChannelEvents } from "@/hooks/useLiveChannelEvents";
import { useDecryptedImage } from "@/hooks/useDecryptedImage";
import { useUploadFile } from "@/hooks/useUploadFile";
import { useAuthor, getDisplayName } from "@/hooks/useAuthor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRef, useEffect, useMemo } from "react";
import { Loader2, ImageIcon, X, Trash2, ChevronDown, MapPin, Clock, CalendarDays, Pencil } from "lucide-react";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { useSeoMeta } from "@unhead/react";
import type { CommunityMetadata } from "@/concord-v2/lib/types";
import type { ChannelV2 } from "@/concord-v2/lib/types";

type Tab = "details" | "signup" | "chat";

const TAB_ITEMS: { value: Tab; emoji: string; label: string }[] = [
  { value: "details", emoji: "📋", label: "Details" },
  { value: "signup", emoji: "📝", label: "Sign-Up" },
  { value: "chat", emoji: "💬", label: "Chat" },
];

export default function AppPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  // Load the community from the user's Community List
  const { community, isLoading: communityLoading } = useCommunityData();

  // Fetch and fold the control plane to discover channels
  const { folded, isLoading: controlLoading } = useControlPlane(community);

  // Derive channel objects with their stream keys
  const { channels, eventInfoChannel, signUpChannel, chatChannel } = useChannels(community, folded);

  // Check membership (depends on community data loading)
  const { data: isMember, isLoading: membershipLoading } = useCommunityMembership(user?.pubkey);

  const [tab, setTab] = useState<Tab>("details");

  // The app is named after its community, not hardcoded branding.
  const communityName = folded?.metadata?.name ?? EVENT_CONFIG.name;
  useSeoMeta({ title: communityName });

  // Live subscription: new chat messages land in the query cache the moment
  // they hit a relay; edits/deletes/sign-up changes trigger instant refolds.
  useLiveChannelEvents(channels);

  // Redirects live in effects — never navigate during render.
  useEffect(() => {
    if (!user) navigate("/");
  }, [user, navigate]);

  useEffect(() => {
    if (!membershipLoading && !isMember && EVENT_CONFIG.communityId) navigate("/");
  }, [membershipLoading, isMember, navigate]);

  if (!user) return null;

  // Still loading community data → show loading
  if (membershipLoading || communityLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
        <div className="text-center space-y-3">
          <div className="text-4xl animate-bounce">{EVENT_CONFIG.emoji}</div>
          <p className="text-sm text-gray-600">Loading community...</p>
        </div>
      </div>
    );
  }

  // Control plane still loading → show app shell with subtle indicator
  if (controlLoading && !folded) {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
        <AppHeader name={communityName} />
        <div className="px-2 py-6 space-y-4">
          <Skeleton className="h-36 w-full" />
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 pt-4">
            <Loader2 size={16} className="animate-spin" />
            Loading channels...
          </div>
        </div>
      </div>
    );
  }

  // Not a member → landing (effect above performs the navigation)
  if (!isMember && EVENT_CONFIG.communityId) return null;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      {/* Fixed top block: app header + community banner. The tab content
          scrolls underneath it (offsets below match these heights). */}
      <div className="fixed inset-x-0 top-0 z-30">
        <AppHeader name={communityName} metadata={folded?.metadata} />
        <CommunityHero metadata={folded?.metadata} />
      </div>

      {/* Main Content — full bleed; top padding clears the fixed block
          (56px header + 144/176px hero + 16px gap), bottom padding clears
          the mobile nav bar. */}
      <main className="px-2 pb-28 sm:pb-6 pt-[calc(216px+env(safe-area-inset-top))] sm:pt-[calc(248px+env(safe-area-inset-top))]">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          {/* Desktop tabs (mobile gets the bottom nav bar) */}
          <TabsList className="grid w-full grid-cols-3 mb-4 max-sm:hidden">
            {TAB_ITEMS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.emoji} {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* forceMount keeps every tab's query alive from first render:
              data loads in the background and tab switches are instant. */}
          <TabsContent value="details" forceMount className="data-[state=inactive]:hidden">
            <EventDetailsTab channel={eventInfoChannel} banned={folded?.banned} />
          </TabsContent>

          <TabsContent value="signup" forceMount className="data-[state=inactive]:hidden">
            <SignUpTab channel={signUpChannel} banned={folded?.banned} />
          </TabsContent>

          <TabsContent value="chat" forceMount className="data-[state=inactive]:hidden">
            <ChatTab channel={chatChannel} active={tab === "chat"} banned={folded?.banned} />
          </TabsContent>
        </Tabs>
      </main>

      <MobileTabBar tab={tab} onChange={setTab} />
    </div>
  );
}

// ── App Header ───────────────────────────────────────────────────────────────

function AppHeader({ name, metadata }: { name: string; metadata?: CommunityMetadata }) {
  const icon = useDecryptedImage(metadata?.icon);

  return (
    <header className="bg-white/80 backdrop-blur-sm border-b border-orange-200 px-3 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon ? (
            <img src={icon} alt="" className="size-8 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <span className="text-2xl flex-shrink-0">{EVENT_CONFIG.emoji}</span>
          )}
          <h1 className="text-lg font-bold text-red-800 truncate">{name}</h1>
        </div>
        <LoginArea />
      </div>
    </header>
  );
}

// ── Mobile Bottom Nav ────────────────────────────────────────────────────────

function MobileTabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 sm:hidden" aria-label="Sections">
      <div className="rounded-t-3xl bg-gradient-to-r from-red-600 via-red-500 to-orange-500 shadow-[0_-6px_24px_rgba(190,18,60,0.35)] pt-1.5 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-3">
          {TAB_ITEMS.map((item) => {
            const active = tab === item.value;
            return (
              <button
                key={item.value}
                onClick={() => onChange(item.value)}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className="flex items-center justify-center py-2"
              >
                <span
                  className={`flex size-11 items-center justify-center rounded-full text-2xl transition-all duration-200 ${
                    active
                      ? "bg-white shadow-lg motion-safe:scale-110 motion-safe:-translate-y-0.5"
                      : "bg-white/15"
                  }`}
                >
                  {item.emoji}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

// ── Community Hero (banner / description) ────────────────────────────────────

function CommunityHero({ metadata }: { metadata?: CommunityMetadata }) {
  const banner = useDecryptedImage(metadata?.banner);
  const [expanded, setExpanded] = useState(false);

  const description = metadata?.description ?? EVENT_CONFIG.subtitle;
  // Offer expand/collapse only for genuinely long descriptions.
  const isLong = (description?.length ?? 0) > 140;

  return (
    <div className="bg-gray-900 shadow-md">
      <div className="relative h-36 sm:h-44">
        {banner ? (
          <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-red-600 via-orange-500 to-amber-400" />
        )}
        {description && (
          <div className="absolute inset-x-2 bottom-2 rounded-xl bg-black/50 backdrop-blur-sm px-3.5 py-2.5 shadow-lg">
            {isLong ? (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="block w-full text-left"
                aria-expanded={expanded}
              >
                <p className={`text-sm leading-snug text-white ${expanded ? "" : "line-clamp-2"}`}>
                  {description}
                </p>
                <span className="text-[11px] font-semibold text-orange-200 mt-0.5 inline-block">
                  {expanded ? "Show less ▴" : "More ▾"}
                </span>
              </button>
            ) : (
              <p className="text-sm leading-snug text-white line-clamp-2">{description}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Calendar / Maps pickers (device-aware) ───────────────────────────────────

function CalendarMenu({ details }: { details: ParsedEventDetails }) {
  const gcalUrl = googleCalendarUrl(details, EVENT_CONFIG.name);
  const ics = icsContent(details, EVENT_CONFIG.name);

  // Blob URL for the .ics — data: URLs are unreliable in iOS Safari.
  const icsUrl = useMemo(
    () => (ics ? URL.createObjectURL(new Blob([ics], { type: "text/calendar" })) : null),
    [ics]
  );
  useEffect(() => {
    return () => {
      if (icsUrl) URL.revokeObjectURL(icsUrl);
    };
  }, [icsUrl]);

  if (!gcalUrl && !icsUrl) return null;

  const chip =
    "inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors px-4 py-2 text-sm font-medium text-white";

  const appleItem = icsUrl && (
    <DropdownMenuItem asChild>
      <a href={icsUrl} download="event.ics" className="cursor-pointer">
        🍎 Apple Calendar (.ics)
      </a>
    </DropdownMenuItem>
  );
  const googleItem = gcalUrl && (
    <DropdownMenuItem asChild>
      <a href={gcalUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
        📅 Google Calendar
      </a>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={chip}>
          <CalendarDays size={15} />
          Add to Calendar
          <ChevronDown size={14} className="opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {isAppleDevice() ? (
          <>
            {appleItem}
            {googleItem}
          </>
        ) : (
          <>
            {googleItem}
            {appleItem}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MapMenu({ location }: { location: string }) {
  const gmapsUrl = googleMapsUrl(location);
  const appleUrl = appleMapsUrl(location);

  const chip =
    "inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors px-4 py-2 text-sm font-medium text-white";

  // Non-Apple devices: Google Maps is the only useful option — direct link.
  if (!isAppleDevice()) {
    return (
      <a href={gmapsUrl} target="_blank" rel="noopener noreferrer" className={chip}>
        <MapPin size={15} />
        Open in Maps
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={chip}>
          <MapPin size={15} />
          Open in Maps
          <ChevronDown size={14} className="opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild>
          <a href={appleUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
            🍎 Apple Maps
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={gmapsUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
            🗺️ Google Maps
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Event Details Tab ────────────────────────────────────────────────────────

/** Matches lines the parser consumes (mirrors eventParser patterns). */
const STRUCTURED_LINE = /^\s*(?:date|when|event|time|location|where|address|venue|place|at|amount|price|cost|suggested|cash\s?app|cashtag|venmo|lightning|lud16|ln|zap|📅|🕐|⏰|🕒|📍|🗺️|🏠)\s*[:-]/i;

// ── Map preview (client-composed from OSM tiles — no API key, no static-map
// service dependency) ─────────────────────────────────────────────────────────

const MAP_W = 600;
const MAP_H = 256;
const MAP_ZOOM = 15;
const TILE = 256;

/** Slippy-map tile coords (fractional) for a lon/lat at a zoom level. */
function lonLatToTile(lon: number, lat: number, zoom: number) {
  const n = 2 ** zoom;
  const xt = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xt, yt };
}

function loadTile(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // OSM tiles send ACAO:* — canvas stays clean
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("tile load failed"));
    img.src = src;
  });
}

/** Draw a red teardrop pin with a soft shadow at (cx, cy = pin tip). */
function drawPin(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx - 14, cy - 22, cx - 14, cy - 30);
  ctx.arc(cx, cy - 30, 14, Math.PI, 0);
  ctx.quadraticCurveTo(cx + 14, cy - 22, cx, cy);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy - 30, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Compose a 600×256 map image centered on (lat, lon) from OSM tiles, with a
 * pin. Returns a data URL. Throws when tiles can't be loaded (offline etc.).
 */
async function composeMapImage(lat: number, lon: number): Promise<string> {
  const { xt, yt } = lonLatToTile(lon, lat, MAP_ZOOM);
  const centerPx = { x: xt * TILE, y: yt * TILE };
  const startX = Math.floor(centerPx.x - MAP_W / 2);
  const startY = Math.floor(centerPx.y - MAP_H / 2);
  const x0 = Math.floor(startX / TILE);
  const y0 = Math.floor(startY / TILE);
  const x1 = Math.floor((startX + MAP_W) / TILE);
  const y1 = Math.floor((startY + MAP_H) / TILE);
  const n = 2 ** MAP_ZOOM;

  const jobs: Promise<{ img: HTMLImageElement; px: number; py: number }>[] = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue; // no vertical wrap
      const wrapped = ((tx % n) + n) % n; // horizontal wrap
      jobs.push(
        loadTile(`https://tile.openstreetmap.org/${MAP_ZOOM}/${wrapped}/${ty}.png`).then((img) => ({
          img,
          px: tx * TILE - startX,
          py: ty * TILE - startY,
        }))
      );
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  for (const { img, px, py } of await Promise.all(jobs)) {
    ctx.drawImage(img, px, py);
  }
  drawPin(ctx, MAP_W / 2, MAP_H / 2 + 22);

  return canvas.toDataURL("image/png");
}

/** Geocode a location string and compose a static map preview image. */
function useMapPreview(location: string | undefined) {
  return useQuery<string | null>({
    queryKey: ["map-preview", location],
    enabled: Boolean(location),
    // Addresses barely change; cache aggressively.
    staleTime: 24 * 60 * 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location!)}`,
        { signal, headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`geocode failed: HTTP ${res.status}`);
      const [hit] = (await res.json()) as { lat: string; lon: string }[];
      if (!hit) return null;
      return composeMapImage(Number(hit.lat), Number(hit.lon));
    },
  });
}

/** Where card — sky gradient with a live static-map preview. */
function WhereCard({ location }: { location: string }) {
  const { data: mapUrl } = useMapPreview(location);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 to-cyan-500 text-white p-5 shadow-md">
      {/* Faint background: the real map when we have one, map motif otherwise */}
      {mapUrl && !imgFailed ? (
        <img
          src={mapUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover opacity-20 blur-[2px] pointer-events-none select-none"
        />
      ) : (
        <img
          src="/patterns/map.png"
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover opacity-15 pointer-events-none select-none"
        />
      )}
      <div className="relative flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-xl bg-white/15 flex-shrink-0">
          <MapPin size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-widest text-white/70 font-semibold">Where</p>
          <p className="text-2xl font-bold break-words leading-snug">{location}</p>
        </div>
      </div>
      {mapUrl && !imgFailed && (
        <img
          src={mapUrl}
          alt={`Map of ${location}`}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="relative mt-3 h-32 w-full rounded-xl object-cover border border-white/25"
        />
      )}
      <div className="relative mt-4">
        <MapMenu location={location} />
      </div>
    </div>
  );
}

/** Chip In card — one suggested amount, however many ways to pay it. */
function ChipInCard({ details }: { details: ParsedEventDetails }) {
  const { data: rate } = useBtcUsdRate();
  const [paying, setPaying] = useState(false);

  // The host's single USD amount, converted to sats in the background.
  const usdAmount = numericAmount(details.amount);
  const sats = usdAmount && rate ? Math.round((Number(usdAmount) / rate) * 1e8) : undefined;

  /** Tap → resolve LNURL-pay into a ready-made BOLT-11 invoice, then pay. */
  const payLightning = async (id: string) => {
    setPaying(true);
    try {
      let uri = `lightning:${id}`;
      if (sats) {
        try {
          uri = await resolveLightningInvoiceUri(id, sats, AbortSignal.timeout(10_000));
        } catch {
          // Receiver unreachable / amount out of bounds — pay open-amount.
        }
      }
      window.location.href = uri;
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 to-emerald-500 text-white p-5 shadow-md">
      <img
        src="/patterns/money.png"
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover opacity-15 pointer-events-none select-none"
      />
      <div className="relative flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-xl bg-white/15 flex-shrink-0 text-3xl">
          💸
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-widest text-white/70 font-semibold">Chip In</p>
          <p className="text-2xl font-bold leading-snug">Send the host money</p>
          {details.amount ? (
            <p className="text-lg text-white/90">
              {details.amount} suggested
              {sats !== undefined && (
                <span className="text-white/70 text-sm"> · ≈ {sats.toLocaleString()} sats</span>
              )}
            </p>
          ) : (
            <p className="text-lg text-white/90">Donate any amount 💛</p>
          )}
        </div>
      </div>
      <div className="relative mt-4 space-y-2">
        {details.payments.map((p) => {
          const rowInner = (
            <>
              <span className="flex items-center gap-3 min-w-0">
                <span className="text-2xl flex-shrink-0">
                  {p.method === "cashapp" ? "💵" : p.method === "venmo" ? "📲" : "⚡"}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">
                    {p.method === "cashapp" ? "Cash App" : p.method === "venmo" ? "Venmo" : "Bitcoin Lightning"}
                  </span>
                  <span className="block text-xs text-white/70 truncate">{p.id}</span>
                </span>
              </span>
              <span className="text-white/80 flex-shrink-0">
                {p.method === "lightning" && paying ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "→"
                )}
              </span>
            </>
          );
          const rowClass =
            "flex w-full items-center justify-between gap-3 rounded-xl bg-white/15 hover:bg-white/25 active:bg-white/30 px-4 py-3 transition-colors text-left";

          // Lightning rows resolve an invoice in the background on tap.
          if (p.method === "lightning") {
            return (
              <button key={p.method} onClick={() => payLightning(p.id)} disabled={paying} className={rowClass}>
                {rowInner}
              </button>
            );
          }
          return (
            <a key={p.method} href={p.url} target="_blank" rel="noopener noreferrer" className={rowClass}>
              {rowInner}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** Adapt a CalendarEvent to ParsedEventDetails for the calendar/maps links. */
function eventToDetails(event: CalendarEvent): ParsedEventDetails {
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (event.kind === KIND_CALENDAR_TIME) {
    const d = new Date(Number(event.start) * 1000);
    return {
      date: fmtDate(d),
      time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      location: event.location,
      payments: [],
      notes: [],
    };
  }
  return {
    date: fmtDate(new Date(`${event.start}T12:00:00`)),
    location: event.location,
    payments: [],
    notes: [],
  };
}

/** ISO date/time parts for prefilling the composer pickers from an event. */
function eventStartIso(event: CalendarEvent): { date: string; time: string } {
  if (event.kind === KIND_CALENDAR_TIME) {
    const d = new Date(Number(event.start) * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }
  return { date: event.start, time: "" };
}

/** ISO time part of an event's end, for prefilling the composer ("" if none). */
function eventEndTimeIso(event: CalendarEvent): string {
  if (event.kind !== KIND_CALENDAR_TIME || !event.end) return "";
  const d = new Date(Number(event.end) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const RSVP_OPTIONS: { status: RsvpStatus; emoji: string; label: string }[] = [
  { status: "accepted", emoji: "✅", label: "Going" },
  { status: "tentative", emoji: "🤔", label: "Maybe" },
  { status: "declined", emoji: "✕", label: "Can't go" },
];

function EventDetailsTab({ channel, banned }: { channel: ChannelV2 | undefined; banned?: Set<string> }) {
  const { messages, isLoading } = useChannelChat(channel, undefined, banned);
  const { user } = useCurrentUser();
  const {
    events,
    isLoading: calendarLoading,
    rsvpsFor,
    saveEvent,
    deleteEvent,
    setRsvp,
  } = useChannelCalendar(channel, user?.pubkey, banned);
  const [composerOpen, setComposerOpen] = useState(false);

  const isOwner = Boolean(
    user?.pubkey && EVENT_CONFIG.communityOwner &&
    user.pubkey.toLowerCase() === EVENT_CONFIG.communityOwner.toLowerCase()
  );

  // Text-based event info is host-only. In a shared channel this keeps
  // regular chat out of Additional Info — and stops any member hijacking
  // the When/Chip In cards by posting "Date:"/"CashApp:" lines.
  const ownerPubkey = EVENT_CONFIG.communityOwner?.toLowerCase();
  const infoMessages = useMemo(
    () =>
      ownerPubkey
        ? messages.filter((m) => m.pubkey.toLowerCase() === ownerPubkey)
        : messages,
    [messages, ownerPubkey]
  );
  const details = parseEventDetails(infoMessages);

  // NIP-52 events (Armada-compatible) take precedence; the free-form text
  // parsing stays as the fallback for legacy posts. The host's own events
  // win the featured slot; member-created events list under "Also coming up".
  const upcoming = useMemo(() => {
    const up = events.filter((e) => isUpcoming(e));
    if (ownerPubkey) {
      up.sort((a, b) => {
        const aOwner = a.author.toLowerCase() === ownerPubkey ? 0 : 1;
        const bOwner = b.author.toLowerCase() === ownerPubkey ? 0 : 1;
        return aOwner - bOwner;
      });
    }
    return up;
  }, [events, ownerPubkey]);
  const featured = upcoming[0];
  const alsoComing = upcoming.slice(1, 4);
  // The event the HOST edits — addressable identity is (author, d), so the
  // composer must target the owner's own event, never a member's.
  const ownerEvent = useMemo(
    () =>
      ownerPubkey
        ? upcoming.find((e) => e.author.toLowerCase() === ownerPubkey)
        : upcoming[0],
    [upcoming, ownerPubkey]
  );

  // The event's description is parsed for legacy payment lines + notes in
  // the same line format as legacy text posts.
  const eventDetails = useMemo(
    () =>
      featured?.description
        ? parseEventDetails([{ content: featured.description, createdAt: featured.createdAt }])
        : undefined,
    [featured]
  );

  // Payments prefer the event's structured tags (amount/cashapp/venmo/
  // lightning), then description lines (older events), then legacy text.
  const tagPayments = useMemo<ParsedPayment[]>(() => {
    if (!featured) return [];
    const out: ParsedPayment[] = [];
    if (featured.cashapp) {
      out.push({ method: "cashapp", id: featured.cashapp, amount: featured.amount, url: cashAppUrl(featured.cashapp, featured.amount) });
    }
    if (featured.venmo) {
      out.push({ method: "venmo", id: featured.venmo, amount: featured.amount, url: venmoUrl(featured.venmo, featured.amount) });
    }
    if (featured.lightning) {
      out.push({ method: "lightning", id: featured.lightning, amount: featured.amount, url: lightningUrl(featured.lightning) });
    }
    return out;
  }, [featured]);

  const mergedPayments =
    tagPayments.length > 0
      ? tagPayments
      : featured && eventDetails && eventDetails.payments.length > 0
        ? eventDetails.payments
        : details.payments;
  const mergedAmount = featured?.amount ?? eventDetails?.amount ?? details.amount;
  const paymentDetails: ParsedEventDetails = { ...details, amount: mergedAmount, payments: mergedPayments };

  // Additional Info comes from the NIP-52 event description when an event
  // exists; legacy text notes only as the no-event fallback.
  const notesToShow = featured ? (eventDetails?.notes ?? []) : details.notes;

  const hasAnyDetails = Boolean(featured) || details.date || details.time || details.location;
  const locationToShow = featured?.location ?? (!featured ? details.location : undefined);

  // The message the owner edits for payment info: their oldest structured post.
  const ownerMessage = useMemo(() => {
    if (!user) return undefined;
    return messages
      .filter((m) => m.pubkey === user.pubkey && STRUCTURED_LINE.test(m.content))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }, [messages, user]);

  // True first load (no cached data yet) → skeletons, not a fake empty state.
  if ((isLoading || calendarLoading) && messages.length === 0 && events.length === 0) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!hasAnyDetails && details.payments.length === 0 && (
        <Card className="border-dashed border-orange-300">
          <CardContent className="py-10 px-4 text-center">
            <div className="text-5xl mb-3">{EVENT_CONFIG.emoji}</div>
            {isOwner ? (
              <>
                <p className="text-base font-medium text-gray-700 mb-1">You're the host — add the details!</p>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">
                  Use the editor below to post the date, time, location, and payment info.
                </p>
              </>
            ) : (
              <p className="text-base font-medium text-gray-700">
                No event details yet — the host hasn't posted them. Check back soon!
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Featured NIP-52 event (Armada-compatible) with RSVPs */}
      {featured && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-600 to-orange-500 text-white p-5 shadow-md">
          <img
            src="/patterns/calendar.png"
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover opacity-15 pointer-events-none select-none"
          />
          <div className="relative flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-xl bg-white/15 flex-shrink-0">
              <CalendarDays size={30} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-white/70 font-semibold">Upcoming Event</p>
              <p className="text-2xl font-bold leading-tight">{featured.title}</p>
              <p className="text-lg text-white/90 flex items-center gap-1.5">
                <Clock size={16} className="opacity-80" />
                {formatCalendarEventWhen(featured)}
              </p>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-2">
            <CalendarMenu details={eventToDetails(featured)} />
          </div>
          {user && (
            <div className="relative mt-3 flex flex-wrap gap-2 border-t border-white/20 pt-3">
              {RSVP_OPTIONS.map((opt) => {
                const tally = rsvpsFor(featured);
                const count = tally[opt.status].length;
                const active = tally.mine === opt.status;
                return (
                  <button
                    key={opt.status}
                    onClick={() =>
                      setRsvp(featured, opt.status, user.signer, user.pubkey).catch((e) =>
                        console.error("RSVP failed:", e)
                      )
                    }
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-white text-red-700 shadow-sm"
                        : "bg-white/15 text-white hover:bg-white/25 active:bg-white/30"
                    }`}
                  >
                    {opt.emoji} {opt.label}
                    {count > 0 && <span className={active ? "text-red-400" : "text-white/70"}>· {count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Legacy text When card — only when no NIP-52 event exists */}
      {!featured && (details.date || details.time) && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-600 to-orange-500 text-white p-5 shadow-md">
          <img
            src="/patterns/calendar.png"
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover opacity-15 pointer-events-none select-none"
          />
          <div className="relative flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-xl bg-white/15 flex-shrink-0">
              <CalendarDays size={30} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-white/70 font-semibold">When</p>
              {details.date && (
                <p className="text-2xl font-bold leading-tight">{details.date}</p>
              )}
              {details.time && (
                <p className="text-lg text-white/90 flex items-center gap-1.5">
                  <Clock size={16} className="opacity-80" />
                  {details.time}
                </p>
              )}
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-2">
            <CalendarMenu details={details} />
          </div>
        </div>
      )}

      {/* Where — sky gradient card with map preview */}
      {locationToShow && <WhereCard location={locationToShow} />}

      {/* More upcoming events */}
      {alsoComing.length > 0 && (
        <Card className="border-orange-200 py-4 gap-2">
          <CardHeader>
            <CardTitle className="text-red-800 text-base">🗓️ Also coming up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alsoComing.map((e) => (
              <div key={e.rumorId} className="flex items-center justify-between gap-2 rounded-lg bg-orange-50/60 px-3 py-2">
                <p className="text-sm font-medium text-gray-900 truncate">{e.title}</p>
                <p className="text-xs text-gray-500 flex-shrink-0">{formatCalendarEventWhen(e)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Chip In — payment methods for the host (green gradient) */}
      {mergedPayments.length > 0 && <ChipInCard details={paymentDetails} />}

      {/* Additional notes: event description + free-form messages */}
      {notesToShow.length > 0 && (
        <Card className="border-orange-200 py-4 gap-2">
          <CardHeader>
            <CardTitle className="text-red-800 text-base">📢 Additional Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {notesToShow.slice(-5).map((note, i) => (
              <div key={i} className="border-l-4 border-orange-300 bg-orange-50/60 rounded-r-lg px-3 py-2">
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{note}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Owner-only: post / update event details */}
      {isOwner && user && channel && (
        <div>
          {composerOpen ? (
            <EventDetailsComposer
              details={details}
              featured={ownerEvent}
              communityName={EVENT_CONFIG.name}
              ownerMessage={ownerMessage}
              onSave={async (f) => {
                // Everything lives on the NIP-52 event (what Armada
                // reads/writes): title/start/location as tags, payment info +
                // extra info as description lines (our parser's line format).
                const startIso = f.date
                  ? f.time
                    ? new Date(`${f.date}T${f.time}`)
                    : new Date(`${f.date}T12:00`)
                  : null;
                if (f.title.trim() && startIso && !isNaN(startIso.getTime())) {
                  const endIso = f.date && f.endTime ? new Date(`${f.date}T${f.endTime}`) : null;
                  const end =
                    endIso && !isNaN(endIso.getTime()) && endIso.getTime() > startIso.getTime()
                      ? String(Math.floor(endIso.getTime() / 1000))
                      : undefined;
                  await saveEvent(
                    {
                      identifier: ownerEvent?.identifier ?? randomCalendarId(),
                      kind: KIND_CALENDAR_TIME,
                      title: f.title.trim(),
                      start: String(Math.floor(startIso.getTime() / 1000)),
                      end,
                      startTzid: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      location: f.location.trim() || undefined,
                      // Payment info as structured tags (Armada ignores them);
                      // the description carries only the extra info.
                      amount: f.amountMode === "fixed" && f.amount.trim() ? f.amount.trim() : undefined,
                      cashapp: f.cashapp.trim() || undefined,
                      venmo: f.venmo.trim() || undefined,
                      lightning: f.lightning.trim() || undefined,
                      description: f.extra.trim() || undefined,
                    },
                    user.signer,
                    user.pubkey
                  );
                }
                setComposerOpen(false);
              }}
              onDeleteEvent={
                ownerEvent
                  ? async () => {
                      await deleteEvent(ownerEvent, user.signer, user.pubkey);
                      setComposerOpen(false);
                    }
                  : undefined
              }
              onCancel={() => setComposerOpen(false)}
            />
          ) : (
            <Button
              variant="outline"
              onClick={() => setComposerOpen(true)}
              className="w-full border-orange-300 text-red-700 hover:bg-orange-50 h-11"
            >
              <Pencil size={15} className="mr-1.5" />
              {hasAnyDetails || details.payments.length > 0 ? "Edit event details" : "Add event details"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Owner: event details composer ────────────────────────────────────────────

/** Everything the composer collects, handed to the parent's save handler. */
interface ComposerFields {
  title: string;
  date: string;
  time: string;
  endTime: string;
  location: string;
  extra: string;
  amountMode: "fixed" | "open";
  amount: string;
  cashapp: string;
  venmo: string;
  lightning: string;
}

function EventDetailsComposer({
  details,
  featured,
  communityName,
  ownerMessage,
  onSave,
  onDeleteEvent,
  onCancel,
}: {
  details: ParsedEventDetails;
  featured: CalendarEvent | undefined;
  communityName: string;
  ownerMessage: ChatMessage | undefined;
  onSave: (fields: ComposerFields) => Promise<void>;
  onDeleteEvent?: () => Promise<void>;
  onCancel: () => void;
}) {
  // Prefill from the NIP-52 event when there is one, else legacy text fields.
  const startIso = featured ? eventStartIso(featured) : undefined;
  const [title, setTitle] = useState(featured?.title ?? communityName);
  const [date, setDate] = useState(() => startIso?.date ?? friendlyDateToIso(details.date));
  const [time, setTime] = useState(() => startIso?.time ?? friendlyTimeToIso(details.time));
  const [endTime, setEndTime] = useState(() => (featured ? eventEndTimeIso(featured) : ""));
  const [location, setLocation] = useState(featured?.location ?? details.location ?? "");
  // ONE suggested amount, however many payment methods are offered — or
  // open donations, where guests choose what to give. Prefers the event's
  // structured payment tags, falling back to legacy text.
  const [amountMode, setAmountMode] = useState<"fixed" | "open">((featured?.amount ?? details.amount) ? "fixed" : "open");
  const [amount, setAmount] = useState(featured?.amount ?? details.amount ?? "");
  const [cashapp, setCashapp] = useState(featured?.cashapp ?? details.payments.find((p) => p.method === "cashapp")?.id ?? "");
  const [venmo, setVenmo] = useState(featured?.venmo ?? details.payments.find((p) => p.method === "venmo")?.id ?? "");
  const [lightning, setLightning] = useState(featured?.lightning ?? details.payments.find((p) => p.method === "lightning")?.id ?? "");
  // Description = the event's description, else the owner's legacy extra lines.
  const [extra, setExtra] = useState(() => {
    if (featured?.description) return featured.description;
    if (!ownerMessage) return "";
    return ownerMessage.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !STRUCTURED_LINE.test(l))
      .join("\n");
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ title, date, time, endTime, location, extra, amountMode, amount, cashapp, venmo, lightning });
    } catch (e) {
      console.error("Failed to save event details:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteEvent || !confirm("Delete this event? Guests will no longer see it.")) return;
    setDeleting(true);
    try {
      await onDeleteEvent();
    } catch (e) {
      console.error("Failed to delete event:", e);
    } finally {
      setDeleting(false);
    }
  };

  const field = "text-base sm:text-sm h-11";

  return (
    <Card className="border-orange-300 py-4 gap-3">
      <CardHeader>
        <CardTitle className="text-red-800 text-base">✏️ Edit Event Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Event title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer Cookout" className={field} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Start</label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">End (optional)</label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Location</label>
            <LocationAutocomplete value={location} onChange={setLocation} className={field} />
          </div>
        </div>

        <div className="border-t border-orange-100 pt-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">💸 Payment info (optional — how guests chip in)</p>
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Contribution</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setAmountMode("fixed")}
                  aria-pressed={amountMode === "fixed"}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    amountMode === "fixed"
                      ? "bg-red-600 text-white shadow-sm"
                      : "bg-white border border-orange-200 text-gray-700 hover:bg-orange-50"
                  }`}
                >
                  Fixed amount
                </button>
                <button
                  type="button"
                  onClick={() => setAmountMode("open")}
                  aria-pressed={amountMode === "open"}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    amountMode === "open"
                      ? "bg-red-600 text-white shadow-sm"
                      : "bg-white border border-orange-200 text-gray-700 hover:bg-orange-50"
                  }`}
                >
                  Open donations
                </button>
              </div>
            </div>
            {amountMode === "fixed" ? (
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$25 (one amount for all methods)" className={field} />
            ) : (
              <p className="text-xs text-gray-500 px-1">
                Guests choose how much to give — payment links won't prefill an amount.
              </p>
            )}
            <Input value={cashapp} onChange={(e) => setCashapp(e.target.value)} placeholder="Cash App $cashtag" className={field} />
            <Input value={venmo} onChange={(e) => setVenmo(e.target.value)} placeholder="Venmo @username" className={field} />
            <Input value={lightning} onChange={(e) => setLightning(e.target.value)} placeholder="Lightning address (you@wallet.com)" className={field} />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Description (optional)</label>
          <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Bring your own chairs!" className={field} />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving || deleting} className="bg-red-600 hover:bg-red-700 h-11 px-6">
            {saving ? <Loader2 size={16} className="animate-spin" /> : "Save"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving || deleting} className="h-11">
            Cancel
          </Button>
          {onDeleteEvent && (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={saving || deleting}
              className="h-11 ml-auto text-gray-400 hover:text-red-600"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} className="mr-1" />}
              Delete event
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sign-Up Board Tab ────────────────────────────────────────────────────────

/** Per-category gradient identities — echoes the details cards' color coding. */
const CATEGORY_GRADIENTS: Record<string, string> = {
  seafood: "from-rose-500 to-orange-400",
  drinks: "from-sky-500 to-cyan-400",
  sides: "from-emerald-500 to-green-400",
  supplies: "from-amber-500 to-orange-400",
  volunteer: "from-violet-500 to-purple-400",
};

/** Palette for custom categories (deterministic by name). */
const CUSTOM_GRADIENTS = [
  "from-pink-500 to-rose-400",
  "from-indigo-500 to-blue-400",
  "from-teal-500 to-emerald-400",
  "from-fuchsia-500 to-purple-400",
  "from-cyan-600 to-sky-400",
  "from-amber-600 to-yellow-400",
];

function categoryGradient(category: string): string {
  const builtIn = CATEGORY_GRADIENTS[category];
  if (builtIn) return builtIn;
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash + category.charCodeAt(i)) | 0;
  }
  return CUSTOM_GRADIENTS[Math.abs(hash) % CUSTOM_GRADIENTS.length];
}

/** Display name for a category key (built-in capitalized, or custom name). */
function categoryName(category: string, customs: { name: string; emoji: string }[]): string {
  const custom = customs.find((c) => c.name.toLowerCase() === category.toLowerCase());
  return custom?.name ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** Resolved display name for a claimer. */
function ClaimedBy({ pubkey }: { pubkey: string }) {
  const { data: profile } = useAuthor(pubkey);
  return (
    <p className="text-xs text-green-600 mt-1">
      ✓ Claimed by {getDisplayName(profile, pubkey)}
    </p>
  );
}

function SignUpTab({ channel, banned }: { channel: ChannelV2 | undefined; banned?: Set<string> }) {
  const { items, isLoading, addItem, claimItem, unclaimItem, deleteItem } = useSignUpBoard(channel, banned);
  const { user } = useCurrentUser();
  const { customs, addCustomCategory } = useCustomCategories();
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<string>("seafood");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customEmoji, setCustomEmoji] = useState(EMOJI_CHOICES[0]);

  const handleAdd = async () => {
    if (!newItemName.trim() || !user) return;
    try {
      await addItem(newItemCategory, newItemName, user.signer, user.pubkey);
      setNewItemName("");
    } catch (e) {
      console.error("Failed to add item:", e);
    }
  };

  const handleAddCategory = () => {
    if (addCustomCategory(customName, customEmoji)) {
      setNewItemCategory(customName.trim().toLowerCase());
      setCustomName("");
      setCustomOpen(false);
    }
  };

  const handleDelete = (itemId: string) => {
    if (!user || !confirm("Delete this item?")) return;
    deleteItem(itemId, user.signer, user.pubkey).catch((e) => console.error("Delete failed:", e));
  };

  // Category chips: built-ins + the user's custom categories.
  const chipCategories = useMemo(() => {
    const keys = [
      ...SIGN_UP_CATEGORIES,
      ...customs.map((c) => c.name.toLowerCase()),
    ];
    return [...new Set(keys)];
  }, [customs]);

  // Group items by category — built-ins, customs, and any category that
  // shows up in the data (e.g. created on another device).
  const itemsByCategory = useMemo(() => {
    const keys = [
      ...chipCategories,
      ...items.map((i) => i.category),
    ];
    return [...new Set(keys)].map((cat) => ({
      category: cat,
      items: items.filter((item) => item.category === cat),
    }));
  }, [chipCategories, items]);

  return (
    <div className="space-y-6">
      {/* Add new item */}
      <Card className="border-transparent py-4 gap-3 bg-gradient-to-br from-red-600 to-orange-500 text-white shadow-md">
        <CardHeader>
          <CardTitle className="text-white text-base">➕ Add Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="What should someone bring?"
              className="flex-1 text-base sm:text-sm h-11 bg-white/95 border-transparent text-gray-900 placeholder:text-gray-400"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} className="bg-white text-red-700 hover:bg-white/90 font-bold h-11 px-5 shadow-sm">
              Add
            </Button>
          </div>

          {/* Category picker — emoji chips instead of a dropdown */}
          <div className="flex flex-wrap gap-1.5">
            {chipCategories.map((cat) => {
              const selected = newItemCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setNewItemCategory(cat)}
                  aria-pressed={selected}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected
                      ? "bg-white text-red-700 shadow-sm"
                      : "bg-white/15 border border-white/25 text-white hover:bg-white/25 active:bg-white/30"
                  }`}
                >
                  {categoryLabel(cat, customs)}
                </button>
              );
            })}
            <button
              onClick={() => setCustomOpen((v) => !v)}
              aria-expanded={customOpen}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold bg-white/10 border border-dashed border-white/40 text-white hover:bg-white/20 transition-colors"
            >
              ＋ New
            </button>
          </div>

          {/* Custom category creator */}
          {customOpen && (
            <div className="rounded-xl border border-white/25 bg-black/15 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-white/90">Create a category</p>
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => setCustomEmoji(emoji)}
                    aria-pressed={customEmoji === emoji}
                    aria-label={`Choose ${emoji}`}
                    className={`flex size-9 items-center justify-center rounded-lg text-lg transition-colors ${
                      customEmoji === emoji
                        ? "bg-white/25 ring-2 ring-white"
                        : "hover:bg-white/15 active:bg-white/20"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Category name (e.g. Desserts)"
                  className="flex-1 text-base sm:text-sm h-10 bg-white/95 border-transparent text-gray-900 placeholder:text-gray-400"
                  onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                />
                <Button
                  size="sm"
                  onClick={handleAddCategory}
                  disabled={!customName.trim()}
                  className="bg-white text-red-700 hover:bg-white/90 font-bold h-10 shadow-sm"
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* First-load skeleton */}
      {isLoading && items.length === 0 && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      )}

      {/* Items by category — color-coded cards like the details page.
          Empty categories stay hidden so the board never looks unfinished. */}
      {itemsByCategory
        .filter(({ items: catItems }) => catItems.length > 0)
        .map(({ category, items: catItems }) => (
          <div key={category} className="rounded-2xl overflow-hidden bg-white shadow-md">
            {/* Color-coded category header */}
            <div className={`flex items-center gap-2.5 bg-gradient-to-r ${categoryGradient(category)} px-4 py-2.5 text-white`}>
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/20 text-lg">
                {categoryEmoji(category, customs)}
              </span>
              <h3 className="text-sm font-bold tracking-wide">{categoryName(category, customs)}</h3>
              <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
                {catItems.length}
              </span>
            </div>

            {/* Items */}
            <div className="p-2 space-y-1">
              {catItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-orange-50/70 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium break-words ${item.claimedBy ? "line-through text-gray-400" : "text-gray-900"}`}>
                      {item.name}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-gray-500 mt-0.5">{item.notes}</p>
                    )}
                    {item.claimedBy && <ClaimedBy pubkey={item.claimedBy} />}
                  </div>
                  {item.claimedBy === user?.pubkey ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full min-h-9"
                        onClick={() => user && unclaimItem(item.id, user.signer, user.pubkey).catch((e) => console.error("Unclaim failed:", e))}
                      >
                        Unclaim
                      </Button>
                      {item.createdBy === user?.pubkey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-red-600 px-2 min-h-9"
                          onClick={() => handleDelete(item.id)}
                          title="Delete item"
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  ) : !item.claimedBy ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm min-h-9 px-4"
                        onClick={() => user && claimItem(item.id, user.signer, user.pubkey).catch((e) => console.error("Claim failed:", e))}
                      >
                        Claim
                      </Button>
                      {item.createdBy === user?.pubkey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-red-600 px-2 min-h-9"
                          onClick={() => handleDelete(item.id)}
                          title="Delete item"
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  ) : item.createdBy === user?.pubkey ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-gray-400 hover:text-red-600 px-2 min-h-9 flex-shrink-0"
                      onClick={() => handleDelete(item.id)}
                      title="Delete item"
                    >
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}

      {!isLoading && items.length === 0 && (
        <Card className="border-dashed border-orange-300">
          <CardContent className="py-10 px-4 text-center">
            <div className="text-4xl mb-2">📝</div>
            <p className="text-sm text-gray-500">
              No items yet. Add the first one above!
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Chat Tab ─────────────────────────────────────────────────────────────────

/** Quick-reaction choices in the long-press action menu. */
const QUICK_REACTIONS = ["❤️", "👍", "👎", "😂", "😮", "😢"];

/** Full emoji picker choices (the ＋ button in the action menu). */
const PICKER_EMOJIS = [
  "😀", "😅", "🤣", "😊", "😍", "🥰", "😘", "🤔",
  "🙄", "😴", "🤗", "🥳", "😎", "🤯", "😭", "😤",
  "🙌", "👏", "🙏", "💪", "🔥", "✨", "💯", "🎈",
  "🎉", "🎊", "🥂", "🍾", "💜", "💙", "💚", "🧡",
];

/** env(safe-area-inset-top), measured once (CSS env isn't readable from JS). */
let cachedSafeAreaTop: number | undefined;
function safeAreaTop(): number {
  if (cachedSafeAreaTop !== undefined) return cachedSafeAreaTop;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top)";
  document.body.appendChild(probe);
  cachedSafeAreaTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return cachedSafeAreaTop;
}

/** Resolved name for the reply banner. */
function ReplyBannerName({ pubkey }: { pubkey: string }) {
  const { data: profile } = useAuthor(pubkey);
  return <>{getDisplayName(profile, pubkey)}</>;
}

function ChatTab({ channel, active, banned }: { channel: ChannelV2 | undefined; active: boolean; banned?: Set<string> }) {
  const { user } = useCurrentUser();
  const { messages, isLoading, sendMessage, deleteMessage, sendReaction, removeReaction } =
    useChannelChat(channel, user?.pubkey, banned);
  const uploadFile = useUploadFile();
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<{ url: string; tags: string[][] }[]>([]);
  // Long-press action menu + quote-reply composer state.
  const [actionMenu, setActionMenu] = useState<{ msg: ChatMessage; x: number; y: number; picker: boolean } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasActive = useRef(false);

  // Opening the tab snaps straight to the newest message (while inactive the
  // panel is display:none, so it can't be pre-scrolled). Once open, new
  // messages only pull the view down when already near the bottom — never
  // yank the viewport while someone is reading back through history.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const justActivated = active && !wasActive.current;
    if (justActivated) {
      el.scrollTop = el.scrollHeight;
    } else if (active) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
    wasActive.current = active;
  }, [active, messages.length]);

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || !user) return;
    try {
      const attachmentTags = pendingImages.length > 0
        ? pendingImages.map((img) => {
            const imeta: string[] = ["imeta"];
            for (const tag of img.tags) {
              if (tag[0] === "url" && tag[1]) imeta.push(`url ${tag[1]}`);
              else if (tag[0] === "m" && tag[1]) imeta.push(`m ${tag[1]}`);
              else if (tag[0] === "x" && tag[1]) imeta.push(`x ${tag[1]}`);
              else if (tag[0] === "dim" && tag[1]) imeta.push(`dim ${tag[1]}`);
              else if (tag[0] === "size" && tag[1]) imeta.push(`size ${tag[1]}`);
              else if (tag[0] === "blurhash" && tag[1]) imeta.push(`blurhash ${tag[1]}`);
            }
            return imeta;
          })
        : undefined;
      await sendMessage(input, user.signer, user.pubkey, attachmentTags, replyTo ?? undefined);
      setInput("");
      setPendingImages([]);
      setReplyTo(null);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  /** Long-press on a message → floating action menu at the press point. */
  const openActionMenu = (msg: ChatMessage, x: number, y: number) => {
    setActionMenu({ msg, x, y, picker: false });
  };

  /** Toggle the viewer's reaction on a message. */
  const handleReactionTap = (msg: ChatMessage, emoji: string) => {
    if (!user) return;
    const mine = msg.reactions?.find((r) => r.emoji === emoji && r.myRumorId);
    if (mine?.myRumorId) {
      removeReaction(mine.myRumorId, user.signer, user.pubkey).catch((e) => console.error("Unreact failed:", e));
    } else {
      sendReaction(msg, emoji, user.signer, user.pubkey).catch((e) => console.error("React failed:", e));
    }
  };

  /** Tap a quoted block → smooth-scroll to the original and flash it. */
  const handleQuoteClick = (rumorId: string) => {
    const el = document.getElementById(`msg-${rumorId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(rumorId);
    window.setTimeout(() => setHighlightId((cur) => (cur === rumorId ? null : cur)), 1400);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const tags = await uploadFile.mutateAsync(file);
        const url = tags.find((t) => t[0] === "url")?.[1] ?? tags[0]?.[1];
        if (url) {
          setPendingImages((prev) => [...prev, { url, tags }]);
        }
      } catch (err) {
        console.error("Upload failed:", err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <Card
      className={`border-orange-200 flex flex-col py-3 gap-2 ${
        active
          ? // Mobile: pinned between the fixed top block (56px header +
            // 144px hero + 16px gap) and the bottom nav (68px) — exactly one
            // scroll region (the message list).
            "max-sm:fixed max-sm:inset-x-2 max-sm:z-10 max-sm:top-[calc(216px+env(safe-area-inset-top))] max-sm:bottom-[calc(68px+env(safe-area-inset-bottom))]"
          : ""
      } h-[65dvh] max-sm:h-auto`}
    >
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-red-800 text-base">💬 Group Chat</CardTitle>
          {/* Armada CTA — this community lives on the Concord protocol;
              Armada is the full-featured client for it. */}
          <a
            href={`https://armada.buzz/c/${EVENT_CONFIG.communityId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-900 transition-colors hover:bg-orange-100 active:bg-orange-200"
          >
            <img src="/armada-favicon.png" alt="" className="size-3.5 rounded-sm" />
            Open in Armada
          </a>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden px-3">
        {/* Messages — native scroll for reliability */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 overscroll-contain"
        >
          {isLoading && messages.length === 0 ? (
            <div className="space-y-3 py-2">
              <div className="flex items-end gap-2">
                <Skeleton className="size-8 rounded-full flex-shrink-0" />
                <Skeleton className="h-10 w-48 rounded-2xl" />
              </div>
              <div className="flex items-end gap-2 justify-end">
                <Skeleton className="h-10 w-40 rounded-2xl" />
                <Skeleton className="size-8 rounded-full flex-shrink-0" />
              </div>
              <div className="flex items-end gap-2">
                <Skeleton className="size-8 rounded-full flex-shrink-0" />
                <Skeleton className="h-10 w-56 rounded-2xl" />
              </div>
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No messages yet. Say hello! 👋
            </p>
          ) : (
            <div className="space-y-2 py-1">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  id={`msg-${msg.id}`}
                  className={`rounded-xl transition-colors duration-700 ${
                    highlightId === msg.id ? "bg-orange-200/60" : ""
                  }`}
                >
                  <ChatMessageRow
                    msg={msg}
                    isMine={msg.pubkey === user?.pubkey}
                    onAction={user ? openActionMenu : undefined}
                    onReactionTap={user ? handleReactionTap : undefined}
                    onQuoteClick={handleQuoteClick}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending image previews */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 flex-wrap flex-shrink-0">
            {pendingImages.map((img, idx) => (
              <div key={idx} className="relative">
                <img src={img.url} alt="pending" className="w-16 h-16 rounded-lg object-cover border border-orange-200" />
                <button
                  onClick={() => removePendingImage(idx)}
                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload progress */}
        {uploadFile.isPending && (
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
            <Loader2 size={14} className="animate-spin" />
            Uploading image...
          </div>
        )}

        {/* Reply banner (quote-reply composer state) */}
        {replyTo && (
          <div className="flex flex-shrink-0 items-center gap-2 rounded-lg border-l-4 border-red-400 bg-orange-50 px-3 py-1.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-red-700">
                Replying to <ReplyBannerName pubkey={replyTo.pubkey} />
              </p>
              <p className="text-xs text-gray-600 truncate">{replyTo.content}</p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
              title="Cancel reply"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-1.5 flex-shrink-0 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadFile.isPending}
            className="flex size-11 items-center justify-center text-gray-500 hover:text-red-600 active:text-red-700 disabled:opacity-40 flex-shrink-0 rounded-lg hover:bg-orange-50 transition-colors"
            title="Attach image"
          >
            <ImageIcon size={20} />
          </button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            className="flex-1 text-base sm:text-sm h-11 rounded-full px-4"
            enterKeyHint="send"
          />
          <Button onClick={handleSend} className="bg-red-600 hover:bg-red-700 active:bg-red-800 flex-shrink-0 h-11 px-5 rounded-full">
            Send
          </Button>
        </div>
      </CardContent>

      {/* Long-press action menu (react / reply / delete) */}
      {actionMenu && user && (() => {
        const MENU_W = 264;
        const MENU_H = actionMenu.picker ? 330 : 190;
        const GAP = 12;
        // Never slide under the fixed header + banner block.
        const topBar = (window.innerWidth >= 640 ? 232 : 200) + safeAreaTop();
        const left = Math.max(8, Math.min(actionMenu.x - 24, window.innerWidth - MENU_W - 8));
        // Prefer above the press point; flip below when there's no room.
        const fitsAbove = actionMenu.y - MENU_H - GAP >= topBar;
        const top = fitsAbove
          ? actionMenu.y - MENU_H
          : Math.min(actionMenu.y + GAP, window.innerHeight - MENU_H - 8);

        return (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setActionMenu(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="absolute w-64 rounded-2xl border border-orange-100 bg-white p-2 shadow-2xl"
              style={{ left, top }}
              onClick={(e) => e.stopPropagation()}
            >
              {actionMenu.picker ? (
                /* Full emoji picker */
                <div className="grid max-h-64 grid-cols-6 gap-0.5 overflow-y-auto overscroll-contain pb-1">
                  {PICKER_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        handleReactionTap(actionMenu.msg, emoji);
                        setActionMenu(null);
                      }}
                      className="flex size-10 items-center justify-center rounded-full text-xl transition-all hover:bg-orange-100 active:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : (
                /* Quick reactions + ＋ for the full picker */
                <div className="flex justify-between px-1 pb-1.5">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        handleReactionTap(actionMenu.msg, emoji);
                        setActionMenu(null);
                      }}
                      className="flex size-9 items-center justify-center rounded-full text-xl transition-all hover:bg-orange-100 active:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    onClick={() => setActionMenu({ ...actionMenu, picker: true })}
                    aria-label="More emojis"
                    className="flex size-9 items-center justify-center rounded-full text-base text-gray-500 transition-all hover:bg-orange-100 active:scale-125"
                  >
                    ＋
                  </button>
                </div>
              )}
              <div className="border-t border-orange-100" />
              {/* Reply */}
              <button
                onClick={() => {
                  setReplyTo(actionMenu.msg);
                  setActionMenu(null);
                }}
                className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-800 hover:bg-orange-50 active:bg-orange-100"
              >
                <span>↩️</span> Reply
              </button>
              {/* Delete (own messages only) */}
              {actionMenu.msg.pubkey === user.pubkey && (
                <button
                  onClick={() => {
                    deleteMessage(actionMenu.msg.id, user.signer, user.pubkey).catch((e) =>
                      console.error("Delete failed:", e)
                    );
                    setActionMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 active:bg-red-100"
                >
                  <Trash2 size={15} /> Delete
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
