import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMembership } from "@/hooks/useCommunityMembership";
import { useCommunityData } from "@/hooks/useCommunityData";
import { useControlPlane } from "@/hooks/useControlPlane";
import { useChannels } from "@/hooks/useChannels";
import { EVENT_CONFIG, SIGN_UP_CATEGORIES } from "@/lib/eventConfig";
import { useCustomCategories, categoryLabel, EMOJI_CHOICES } from "@/lib/customCategories";
import {
  parseEventDetails,
  googleCalendarUrl,
  googleMapsUrl,
  appleMapsUrl,
  icsContent,
  numericAmount,
  type ParsedEventDetails,
} from "@/lib/eventParser";
import { isAppleDevice } from "@/lib/device";
import { resolveLightningInvoiceUri, useBtcUsdRate } from "@/lib/lightning";
import { LoginArea } from "@/components/auth/LoginArea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
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
      <AppHeader name={communityName} metadata={folded?.metadata} />

      {/* Main Content — full bleed; bottom padding clears the mobile nav bar */}
      <main className="px-2 pt-2 pb-28 sm:pb-6">
        <CommunityHero metadata={folded?.metadata} />

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-3">
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
            <EventDetailsTab channel={eventInfoChannel} />
          </TabsContent>

          <TabsContent value="signup" forceMount className="data-[state=inactive]:hidden">
            <SignUpTab channel={signUpChannel} />
          </TabsContent>

          <TabsContent value="chat" forceMount className="data-[state=inactive]:hidden">
            <ChatTab channel={chatChannel} active={tab === "chat"} />
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
    <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-orange-200 px-3 pt-[env(safe-area-inset-top)]">
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
    <div className="-mx-2 bg-gray-900">
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

// ── Sats ⇄ USD Converter ─────────────────────────────────────────────────────

function SatsConverter() {
  const { data: rate } = useBtcUsdRate();

  const [sats, setSats] = useState("");
  const [usd, setUsd] = useState("");

  const onSatsChange = (v: string) => {
    setSats(v);
    const n = Number(v);
    if (!rate || !v.trim() || !isFinite(n)) {
      setUsd("");
      return;
    }
    setUsd(((n / 1e8) * rate).toFixed(2));
  };

  const onUsdChange = (v: string) => {
    setUsd(v);
    const n = Number(v);
    if (!rate || !v.trim() || !isFinite(n)) {
      setSats("");
      return;
    }
    setSats(Math.round((n / rate) * 1e8).toString());
  };

  return (
    <div className="rounded-2xl bg-white border border-orange-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">⚡</span>
        <p className="text-sm font-semibold text-gray-900">Sats ⇄ USD</p>
        {rate && (
          <span className="ml-auto text-[11px] text-gray-400">
            1 BTC = ${rate.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Sats</label>
          <Input
            value={sats}
            onChange={(e) => onSatsChange(e.target.value)}
            placeholder="21000"
            inputMode="decimal"
            className="text-base sm:text-sm h-11"
          />
        </div>
        <span className="text-gray-400 pt-5">⇄</span>
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-gray-500 mb-1 block">USD</label>
          <Input
            value={usd}
            onChange={(e) => onUsdChange(e.target.value)}
            placeholder="25.00"
            inputMode="decimal"
            className="text-base sm:text-sm h-11"
          />
        </div>
      </div>
      {!rate && (
        <p className="text-[11px] text-gray-400 mt-2">Fetching current rate…</p>
      )}
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
    <div className="rounded-2xl bg-gradient-to-br from-green-600 to-emerald-500 text-white p-5 shadow-md">
      <div className="flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-xl bg-white/15 flex-shrink-0 text-3xl">
          💸
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-widest text-white/70 font-semibold">Chip In</p>
          <p className="text-2xl font-bold leading-snug">Send the host money</p>
          {details.amount && (
            <p className="text-lg text-white/90">
              {details.amount} suggested
              {sats !== undefined && (
                <span className="text-white/70 text-sm"> · ≈ {sats.toLocaleString()} sats</span>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-2">
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

/** Where card — sky gradient with a live static-map preview. */
function WhereCard({ location }: { location: string }) {
  const { data: mapUrl } = useMapPreview(location);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="rounded-2xl bg-gradient-to-br from-sky-600 to-cyan-500 text-white p-5 shadow-md">
      <div className="flex items-center gap-4">
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
          className="mt-3 h-32 w-full rounded-xl object-cover border border-white/25"
        />
      )}
      <div className="mt-4">
        <MapMenu location={location} />
      </div>
    </div>
  );
}

// ── Event Details Tab ────────────────────────────────────────────────────────

/** Matches lines the parser consumes (mirrors eventParser patterns). */
const STRUCTURED_LINE = /^\s*(?:date|when|event|time|location|where|address|venue|place|at|amount|price|cost|suggested|cash\s?app|cashtag|venmo|lightning|lud16|ln|zap|📅|🕐|⏰|🕒|📍|🗺️|🏠)\s*[:-]/i;

/** Geocode a location string and return a static map preview URL (OSM). */
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
      const lat = Number(hit.lat);
      const lon = Number(hit.lon);
      return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=15&size=600x256&markers=${lat},${lon},red-pushpin`;
    },
  });
}

function EventDetailsTab({ channel }: { channel: ChannelV2 | undefined }) {
  const { messages, isLoading, sendMessage, editMessage } = useChannelChat(channel);
  const { user } = useCurrentUser();
  const [composerOpen, setComposerOpen] = useState(false);

  const isOwner = Boolean(
    user?.pubkey && EVENT_CONFIG.communityOwner &&
    user.pubkey.toLowerCase() === EVENT_CONFIG.communityOwner.toLowerCase()
  );

  const details = parseEventDetails(messages);
  const hasAnyDetails = details.date || details.time || details.location;

  // The message the owner edits: their oldest structured-details post.
  const ownerMessage = useMemo(() => {
    if (!user) return undefined;
    return messages
      .filter((m) => m.pubkey === user.pubkey && STRUCTURED_LINE.test(m.content))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }, [messages, user]);

  // True first load (no cached data yet) → skeletons, not a fake empty state.
  if (isLoading && messages.length === 0) {
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

      {/* When — big gradient card */}
      {(details.date || details.time) && (
        <div className="rounded-2xl bg-gradient-to-br from-red-600 to-orange-500 text-white p-5 shadow-md">
          <div className="flex items-center gap-4">
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
          <div className="mt-4 flex flex-wrap gap-2">
            <CalendarMenu details={details} />
          </div>
        </div>
      )}

      {/* Where — sky gradient card with map preview */}
      {details.location && <WhereCard location={details.location} />}

      {/* Chip In — payment methods for the host (green gradient) */}
      {details.payments.length > 0 && <ChipInCard details={details} />}

      {/* Sats ⇄ USD converter */}
      <SatsConverter />

      {/* Additional notes/messages that didn't parse as structured data */}
      {details.notes.length > 0 && (
        <Card className="border-orange-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-800 text-base">📢 Additional Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {details.notes.slice(-5).map((note, i) => (
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
              ownerMessage={ownerMessage}
              onSave={async (content) => {
                if (ownerMessage) {
                  await editMessage(ownerMessage.id, content, user.signer, user.pubkey);
                } else {
                  await sendMessage(content, user.signer, user.pubkey);
                }
                setComposerOpen(false);
              }}
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

function EventDetailsComposer({
  details,
  ownerMessage,
  onSave,
  onCancel,
}: {
  details: ParsedEventDetails;
  ownerMessage: ChatMessage | undefined;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(details.date ?? "");
  const [time, setTime] = useState(details.time ?? "");
  const [location, setLocation] = useState(details.location ?? "");
  // ONE suggested amount, however many payment methods are offered.
  const [amount, setAmount] = useState(details.amount ?? "");
  const [cashapp, setCashapp] = useState(details.payments.find((p) => p.method === "cashapp")?.id ?? "");
  const [venmo, setVenmo] = useState(details.payments.find((p) => p.method === "venmo")?.id ?? "");
  const [lightning, setLightning] = useState(details.payments.find((p) => p.method === "lightning")?.id ?? "");
  // Extra info = the owner's own unstructured lines from their details post.
  const [extra, setExtra] = useState(() => {
    if (!ownerMessage) return "";
    return ownerMessage.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !STRUCTURED_LINE.test(l))
      .join("\n");
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const lines: string[] = [];
    if (date.trim()) lines.push(`Date: ${date.trim()}`);
    if (time.trim()) lines.push(`Time: ${time.trim()}`);
    if (location.trim()) lines.push(`Location: ${location.trim()}`);
    if (amount.trim()) lines.push(`Amount: ${amount.trim()}`);
    if (cashapp.trim()) lines.push(`CashApp: ${cashapp.trim()}`);
    if (venmo.trim()) lines.push(`Venmo: ${venmo.trim()}`);
    if (lightning.trim()) lines.push(`Lightning: ${lightning.trim()}`);
    if (extra.trim()) lines.push(extra.trim());
    if (lines.length === 0) return;

    setSaving(true);
    try {
      await onSave(lines.join("\n"));
    } catch (e) {
      console.error("Failed to save event details:", e);
    } finally {
      setSaving(false);
    }
  };

  const field = "text-base sm:text-sm h-11";

  return (
    <Card className="border-orange-300">
      <CardHeader className="pb-3">
        <CardTitle className="text-red-800 text-base">✏️ Edit Event Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Date</label>
            <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="Aug 3" className={field} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Time</label>
            <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="3 PM" className={field} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Location</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="123 Main St" className={field} />
          </div>
        </div>

        <div className="border-t border-orange-100 pt-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">💸 Payment info (optional — how guests chip in)</p>
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Suggested amount (one for all methods)</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$25" className={field} />
            </div>
            <Input value={cashapp} onChange={(e) => setCashapp(e.target.value)} placeholder="Cash App $cashtag" className={field} />
            <Input value={venmo} onChange={(e) => setVenmo(e.target.value)} placeholder="Venmo @username" className={field} />
            <Input value={lightning} onChange={(e) => setLightning(e.target.value)} placeholder="Lightning address (you@wallet.com)" className={field} />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Extra info (optional)</label>
          <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Bring your own chairs!" className={field} />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving} className="bg-red-600 hover:bg-red-700 h-11 px-6">
            {saving ? <Loader2 size={16} className="animate-spin" /> : "Save"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving} className="h-11">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sign-Up Board Tab ────────────────────────────────────────────────────────

/** Resolved display name for a claimer. */
function ClaimedBy({ pubkey }: { pubkey: string }) {
  const { data: profile } = useAuthor(pubkey);
  return (
    <p className="text-xs text-green-600 mt-1">
      ✓ Claimed by {getDisplayName(profile, pubkey)}
    </p>
  );
}

function SignUpTab({ channel }: { channel: ChannelV2 | undefined }) {
  const { items, isLoading, addItem, claimItem, unclaimItem, deleteItem } = useSignUpBoard(channel);
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
      <Card className="border-orange-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-red-800 text-base">➕ Add Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="What should someone bring?"
              className="flex-1 text-base sm:text-sm h-11"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} className="bg-red-600 hover:bg-red-700 h-11 px-5">
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
                      ? "bg-red-600 text-white shadow-sm"
                      : "bg-white border border-orange-200 text-gray-700 hover:bg-orange-50 active:bg-orange-100"
                  }`}
                >
                  {categoryLabel(cat, customs)}
                </button>
              );
            })}
            <button
              onClick={() => setCustomOpen((v) => !v)}
              aria-expanded={customOpen}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold bg-orange-100 border border-dashed border-orange-300 text-orange-800 hover:bg-orange-200 transition-colors"
            >
              ＋ New
            </button>
          </div>

          {/* Custom category creator */}
          {customOpen && (
            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-gray-700">Create a category</p>
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => setCustomEmoji(emoji)}
                    aria-pressed={customEmoji === emoji}
                    aria-label={`Choose ${emoji}`}
                    className={`flex size-9 items-center justify-center rounded-lg text-lg transition-colors ${
                      customEmoji === emoji
                        ? "bg-red-600/15 ring-2 ring-red-600"
                        : "hover:bg-white active:bg-white/70"
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
                  className="flex-1 text-base sm:text-sm h-10"
                  onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                />
                <Button
                  size="sm"
                  onClick={handleAddCategory}
                  disabled={!customName.trim()}
                  className="bg-red-600 hover:bg-red-700 h-10"
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

      {/* Items by category */}
      {itemsByCategory.map(({ category, items: catItems }) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            {categoryLabel(category, customs)}
            {catItems.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {catItems.length}
              </Badge>
            )}
          </h3>
          {catItems.length === 0 ? (
            <p className="text-xs text-gray-400 pl-6">No items yet</p>
          ) : (
            <div className="space-y-2">
              {catItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 p-3 bg-white/70 rounded-lg border border-orange-100"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium break-words ${item.claimedBy ? "line-through text-gray-400" : "text-gray-900"}`}>
                      {item.name}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-gray-500 mt-1">{item.notes}</p>
                    )}
                    {item.claimedBy && <ClaimedBy pubkey={item.claimedBy} />}
                  </div>
                  {item.claimedBy === user?.pubkey ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-9"
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
                        className="bg-green-600 hover:bg-green-700 min-h-9"
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
          )}
        </div>
      ))}

      {!isLoading && items.length === 0 && (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">📝</div>
          <p className="text-sm text-gray-500">
            No items yet. Add the first one above!
          </p>
        </div>
      )}
    </div>
  );
}

// ── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({ channel, active }: { channel: ChannelV2 | undefined; active: boolean }) {
  const { messages, isLoading, sendMessage, deleteMessage } = useChannelChat(channel);
  const { user } = useCurrentUser();
  const uploadFile = useUploadFile();
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<{ url: string; tags: string[][] }[]>([]);
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
      await sendMessage(input, user.signer, user.pubkey, attachmentTags);
      setInput("");
      setPendingImages([]);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
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
      className={`border-orange-200 flex flex-col ${
        active
          ? // Mobile: pinned between the hero and the bottom nav — the card
            // IS the page here, so there's exactly one scroll region (the
            // message list). Offsets: header 56 + hero 144 + margins 20 top,
            // nav 68 bottom.
            "max-sm:fixed max-sm:inset-x-2 max-sm:z-10 max-sm:top-[calc(220px+env(safe-area-inset-top))] max-sm:bottom-[calc(68px+env(safe-area-inset-bottom))]"
          : ""
      } h-[65dvh] max-sm:h-auto`}
    >
      <CardHeader className="flex-shrink-0 pb-2 pt-4">
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
      <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden px-3 pb-3">
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
                <ChatMessageRow
                  key={msg.id}
                  msg={msg}
                  isMine={msg.pubkey === user?.pubkey}
                  onDelete={user ? (id) => {
                    deleteMessage(id, user.signer, user.pubkey).catch((e) => console.error("Delete failed:", e));
                  } : undefined}
                />
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
    </Card>
  );
}
