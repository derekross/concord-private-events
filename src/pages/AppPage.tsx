import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMembership } from "@/hooks/useCommunityMembership";
import { useCommunityData } from "@/hooks/useCommunityData";
import { useControlPlane } from "@/hooks/useControlPlane";
import { useChannels } from "@/hooks/useChannels";
import { EVENT_CONFIG, CATEGORY_LABELS, SIGN_UP_CATEGORIES, type SignUpCategory } from "@/lib/eventConfig";
import { parseEventDetails, googleCalendarUrl, googleMapsUrl, icsDataUrl } from "@/lib/eventParser";
import { LoginArea } from "@/components/auth/LoginArea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignUpBoard } from "@/hooks/useSignUpBoard";
import { useChannelChat } from "@/hooks/useChannelChat";
import { useLiveChannelEvents } from "@/hooks/useLiveChannelEvents";
import { useDecryptedImage } from "@/hooks/useDecryptedImage";
import { useUploadFile } from "@/hooks/useUploadFile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRef, useEffect } from "react";
import { Loader2, ImageIcon, X, Trash2, CalendarPlus, MapPin, Clock, CalendarDays } from "lucide-react";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { useSeoMeta } from "@unhead/react";
import type { CommunityMetadata } from "@/concord-v2/lib/types";
import type { ChannelV2 } from "@/concord-v2/lib/types";

type Tab = "details" | "signup" | "chat";

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
  // Polling remains only as a reconciliation net.
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
          <div className="text-4xl animate-bounce">🦐</div>
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
        <div className="px-4 py-6 space-y-4">
          <Skeleton className="h-32 w-full" />
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

      {/* Main Content — full bleed; bottom padding clears the mobile tab bar */}
      <main className="px-4 pt-4 pb-28 sm:pb-6">
        <CommunityHero metadata={folded?.metadata} />

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-4">
          {/* Mobile: fixed bottom app-style nav bar. Desktop: static top tabs. */}
          <TabsList className="grid w-full grid-cols-3 mb-4 h-12 max-sm:fixed max-sm:bottom-0 max-sm:inset-x-0 max-sm:z-20 max-sm:mb-0 max-sm:h-auto max-sm:rounded-none max-sm:border-t max-sm:border-orange-200 max-sm:bg-white/95 max-sm:backdrop-blur-sm max-sm:pb-[env(safe-area-inset-bottom)]">
            <TabsTrigger value="details" className="max-sm:flex-col max-sm:gap-1 max-sm:py-3 max-sm:rounded-none">
              <span className="max-sm:text-2xl max-sm:leading-none">📋</span>
              <span className="max-sm:text-xs max-sm:font-medium">Details</span>
            </TabsTrigger>
            <TabsTrigger value="signup" className="max-sm:flex-col max-sm:gap-1 max-sm:py-3 max-sm:rounded-none">
              <span className="max-sm:text-2xl max-sm:leading-none">📝</span>
              <span className="max-sm:text-xs max-sm:font-medium">Sign-Up</span>
            </TabsTrigger>
            <TabsTrigger value="chat" className="max-sm:flex-col max-sm:gap-1 max-sm:py-3 max-sm:rounded-none">
              <span className="max-sm:text-2xl max-sm:leading-none">💬</span>
              <span className="max-sm:text-xs max-sm:font-medium">Chat</span>
            </TabsTrigger>
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
            <ChatTab channel={chatChannel} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ── App Header ───────────────────────────────────────────────────────────────

function AppHeader({ name, metadata }: { name: string; metadata?: CommunityMetadata }) {
  const icon = useDecryptedImage(metadata?.icon);

  return (
    <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-orange-200 px-4 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon ? (
            <img src={icon} alt="" className="size-7 rounded-lg object-cover flex-shrink-0" />
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

// ── Community Hero (banner / icon / description) ─────────────────────────────

function CommunityHero({ metadata }: { metadata?: CommunityMetadata }) {
  const banner = useDecryptedImage(metadata?.banner);
  const [expanded, setExpanded] = useState(false);

  const name = metadata?.name ?? EVENT_CONFIG.name;
  const description = metadata?.description ?? EVENT_CONFIG.subtitle;
  // Offer expand/collapse only for genuinely long descriptions.
  const isLong = (description?.length ?? 0) > 140;

  return (
    <div className="-mx-4 bg-gray-900">
      <div className="relative h-36 sm:h-44">
        {banner ? (
          <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-red-600 via-orange-500 to-amber-400" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        {/* Community icon lives in the top-left app header, not here. */}
        <div className="absolute bottom-3 left-4 right-4">
          <h2 className="text-2xl font-bold text-white drop-shadow-sm">{name}</h2>
          {description && (
            <p className={`text-sm text-white/85 ${expanded ? "" : "line-clamp-2"}`}>
              {description}
            </p>
          )}
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-semibold text-white/90 underline underline-offset-2 mt-0.5 hover:text-white"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Event Details Tab ────────────────────────────────────────────────────────

function EventDetailsTab({ channel }: { channel: ChannelV2 | undefined }) {
  const { messages, isLoading } = useChannelChat(channel);

  const details = parseEventDetails(messages);
  const calUrl = googleCalendarUrl(details, EVENT_CONFIG.name);
  const icsUrl = icsDataUrl(details, EVENT_CONFIG.name);
  const mapsUrl = details.location ? googleMapsUrl(details.location) : null;
  const hasAnyDetails = details.date || details.time || details.location;

  // True first load (no cached data yet) → skeletons, not a fake empty state.
  if (isLoading && messages.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!hasAnyDetails && (
        <Card className="border-dashed border-orange-300">
          <CardContent className="py-10 px-6 text-center">
            <div className="text-5xl mb-3">🦐</div>
            <p className="text-base font-medium text-gray-700 mb-2">No event details posted yet</p>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Post info to the {channel?.name ?? "event-info"} channel in Armada using formats like{" "}
              <code className="bg-orange-50 px-1.5 py-0.5 rounded text-red-700">Date: Aug 3</code>,{" "}
              <code className="bg-orange-50 px-1.5 py-0.5 rounded text-red-700">Time: 3 PM</code>,{" "}
              <code className="bg-orange-50 px-1.5 py-0.5 rounded text-red-700">Location: 123 Main St</code>
            </p>
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
          {(calUrl || icsUrl) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {calUrl && (
                <a
                  href={calUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors px-4 py-2 text-sm font-medium"
                >
                  <CalendarPlus size={15} />
                  Google Calendar
                </a>
              )}
              {icsUrl && (
                <a
                  href={icsUrl}
                  download="seafood-boil.ics"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors px-4 py-2 text-sm font-medium"
                >
                  📥 Apple Calendar (.ics)
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Where — big white card */}
      {details.location && (
        <div className="rounded-2xl bg-white border border-orange-200 p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-xl bg-orange-100 flex-shrink-0">
              <MapPin size={28} className="text-red-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold">Where</p>
              <p className="text-xl font-semibold text-gray-900 break-words leading-snug">
                {details.location}
              </p>
            </div>
          </div>
          {mapsUrl && (
            <div className="mt-4">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors px-4 py-2 text-sm font-medium text-white"
              >
                <MapPin size={15} />
                Open in Maps
              </a>
            </div>
          )}
        </div>
      )}

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

      {hasAnyDetails && (
        <p className="text-xs text-gray-500 px-1">
          💡 Post details to the {channel?.name ?? "event-info"} channel using formats like{" "}
          <code className="bg-orange-50 px-1 rounded">Date: Aug 3</code>,{" "}
          <code className="bg-orange-50 px-1 rounded">Time: 3 PM</code>,{" "}
          <code className="bg-orange-50 px-1 rounded">Location: 123 Main St</code>
        </p>
      )}
    </div>
  );
}

// ── Sign-Up Board Tab ────────────────────────────────────────────────────────

function SignUpTab({ channel }: { channel: ChannelV2 | undefined }) {
  const { items, isLoading, addItem, claimItem, unclaimItem, deleteItem } = useSignUpBoard(channel);
  const { user } = useCurrentUser();
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<SignUpCategory>("seafood");

  const handleAdd = async () => {
    if (!newItemName.trim() || !user) return;
    try {
      await addItem(newItemCategory, newItemName, user.signer, user.pubkey);
      setNewItemName("");
    } catch (e) {
      console.error("Failed to add item:", e);
    }
  };

  const handleDelete = (itemId: string) => {
    if (!user || !confirm("Delete this item?")) return;
    deleteItem(itemId, user.signer, user.pubkey).catch((e) => console.error("Delete failed:", e));
  };

  // Group items by category
  const itemsByCategory = SIGN_UP_CATEGORIES.map((cat) => ({
    category: cat,
    items: items.filter((item) => item.category === cat),
  }));

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
              placeholder="e.g., 2 lbs shrimp"
              className="flex-1 text-base sm:text-sm h-11"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Select value={newItemCategory} onValueChange={(v) => setNewItemCategory(v as SignUpCategory)}>
              <SelectTrigger className="w-36 h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIGN_UP_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} className="bg-red-600 hover:bg-red-700 h-11 px-5">
              Add
            </Button>
          </div>
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
            {CATEGORY_LABELS[category]}
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
                    {item.claimedBy && (
                      <p className="text-xs text-green-600 mt-1">✓ Claimed</p>
                    )}
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

function ChatTab({ channel }: { channel: ChannelV2 | undefined }) {
  const { messages, isLoading, sendMessage, deleteMessage } = useChannelChat(channel);
  const { user } = useCurrentUser();
  const uploadFile = useUploadFile();
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<{ url: string; tags: string[][] }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages only when already near the bottom — never
  // yank the viewport while someone is reading back through history.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

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
    <Card className="border-orange-200 flex flex-col h-[65dvh]">
      <CardHeader className="flex-shrink-0 pb-2 pt-4">
        <CardTitle className="text-red-800 text-base">💬 Group Chat</CardTitle>
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
