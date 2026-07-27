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
import { Textarea } from "@/components/ui/textarea";
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
import { useSignUpBoard } from "@/hooks/useSignUpBoard";
import { useChannelChat } from "@/hooks/useChannelChat";
import { useUploadFile } from "@/hooks/useUploadFile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRef, useEffect } from "react";
import { Loader2, ImageIcon, X, Trash2 } from "lucide-react";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";

type Tab = "details" | "signup" | "chat";

export default function AppPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  // Load the community from the user's Community List
  const { community, isLoading: communityLoading } = useCommunityData();

  // Fetch and fold the control plane to discover channels
  const { folded, isLoading: controlLoading } = useControlPlane(community);

  // Derive channel objects with their stream keys
  const { eventInfoChannel, signUpChannel, chatChannel } = useChannels(community, folded);

  // Check membership (depends on community data loading)
  const { data: isMember, isLoading: membershipLoading } = useCommunityMembership(user?.pubkey);

  const [tab, setTab] = useState<Tab>("details");

  // Not logged in → redirect to landing
  if (!user) {
    navigate("/");
    return null;
  }

  // Still loading community data → show loading
  if (membershipLoading || communityLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
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
      <div className="min-h-screen bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-orange-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{EVENT_CONFIG.emoji}</span>
              <h1 className="text-lg font-bold text-red-800">{EVENT_CONFIG.name}</h1>
            </div>
            <LoginArea />
          </div>
        </header>
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Loading channels...
          </div>
        </div>
      </div>
    );
  }

  // Not a member → redirect to landing (show invite input)
  if (!isMember && EVENT_CONFIG.communityId) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-orange-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{EVENT_CONFIG.emoji}</span>
            <h1 className="text-lg font-bold text-red-800">{EVENT_CONFIG.name}</h1>
          </div>
          <LoginArea />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="details">📋 Details</TabsTrigger>
            <TabsTrigger value="signup">📝 Sign-Up</TabsTrigger>
            <TabsTrigger value="chat">💬 Chat</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <EventDetailsTab channel={eventInfoChannel} />
          </TabsContent>

          <TabsContent value="signup">
            <SignUpTab channel={signUpChannel} />
          </TabsContent>

          <TabsContent value="chat">
            <ChatTab channel={chatChannel} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ── Event Details Tab ────────────────────────────────────────────────────────

function EventDetailsTab({ channel }: { channel: import("@/concord-v2/lib/types").ChannelV2 | undefined }) {
  const { messages } = useChannelChat(channel);

  const details = parseEventDetails(messages);
  const calUrl = googleCalendarUrl(details, EVENT_CONFIG.name);
  const icsUrl = icsDataUrl(details, EVENT_CONFIG.name);
  const mapsUrl = details.location ? googleMapsUrl(details.location) : null;
  const hasAnyDetails = details.date || details.time || details.location;

  return (
    <Card className="border-orange-200">
      <CardHeader>
        <CardTitle className="text-red-800 flex items-center gap-2">
          📋 Event Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnyDetails && (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">📋</div>
            <p className="text-sm text-gray-500 mb-1">No event details posted yet.</p>
            <p className="text-xs text-gray-400">
              Post info to the {channel?.name ?? "event-info"} channel in Armada.
              Use formats like <code className="bg-orange-50 px-1 rounded">Date: Aug 3</code>,{" "}
              <code className="bg-orange-50 px-1 rounded">Time: 3 PM</code>,{" "}
              <code className="bg-orange-50 px-1 rounded">Location: 123 Main St</code>
            </p>
          </div>
        )}

        {hasAnyDetails && (
          <div className="space-y-3">
            {/* Date */}
            {details.date && (
              <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg border border-orange-100">
                <div className="flex items-center gap-3">
                  <span className="text-xl">📅</span>
                  <div>
                    <p className="text-xs text-gray-500">Date</p>
                    <p className="text-sm font-medium text-gray-900">{details.date}</p>
                  </div>
                </div>
                {calUrl && (
                  <a href={calUrl} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1">
                    📅 Add to Calendar
                  </a>
                )}
              </div>
            )}

            {/* Time */}
            {details.time && (
              <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg border border-orange-100">
                <div className="flex items-center gap-3">
                  <span className="text-xl">🕐</span>
                  <div>
                    <p className="text-xs text-gray-500">Time</p>
                    <p className="text-sm font-medium text-gray-900">{details.time}</p>
                  </div>
                </div>
                {icsUrl && (
                  <a href={icsUrl} download="seafood-boil.ics"
                     className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1">
                    📥 Download .ics
                  </a>
                )}
              </div>
            )}

            {/* Location */}
            {details.location && (
              <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg border border-orange-100">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl flex-shrink-0">📍</span>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Location</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{details.location}</p>
                  </div>
                </div>
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1 flex-shrink-0">
                    🗺️ Open Maps
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Additional notes/messages that didn't parse as structured data */}
        {details.notes.length > 0 && (
          <div className="pt-4 border-t border-orange-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">📢 Additional Info</h3>
            <div className="space-y-2">
              {details.notes.slice(-5).map((note, i) => (
                <div key={i} className="p-2 bg-white/70 rounded-lg border border-orange-100">
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{note}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw messages for debugging (collapse once parser is solid) */}
        {messages.length > 0 && (
          <details className="pt-4 border-t border-orange-100">
            <summary className="cursor-pointer text-xs text-gray-500">
              View all {messages.length} messages from {channel?.name ?? "channel"}
            </summary>
            <div className="space-y-2 mt-2">
              {messages.slice().reverse().map((msg) => (
                <div key={msg.id} className="p-2 bg-white/50 rounded-lg">
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(msg.createdAt * 1000).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="pt-4 border-t border-orange-100">
          <p className="text-xs text-gray-500">
            💡 Post details to the {channel?.name ?? "event-info"} channel using formats like{" "}
            <code className="bg-orange-50 px-1 rounded">Date: Aug 3</code>,{" "}
            <code className="bg-orange-50 px-1 rounded">Time: 3 PM</code>,{" "}
            <code className="bg-orange-50 px-1 rounded">Location: 123 Main St</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sign-Up Board Tab ────────────────────────────────────────────────────────

function SignUpTab({ channel }: { channel: import("@/concord-v2/lib/types").ChannelV2 | undefined }) {
  const { items, addItem, claimItem, unclaimItem, deleteItem } = useSignUpBoard(channel);
  const { user } = useCurrentUser();
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<SignUpCategory>("seafood");

  const handleAdd = async () => {
    if (!newItemName.trim() || !user) return;
    try {
      await addItem(newItemCategory, newItemName, user.signer);
      setNewItemName("");
    } catch (e) {
      console.error("Failed to add item:", e);
    }
  };

  const handleClaim = async (itemId: string, creator: string) => {
    if (!user) return;
    try {
      await claimItem(itemId, creator, user.signer);
    } catch (e) {
      console.error("Failed to claim item:", e);
    }
  };

  const handleUnclaim = async (itemId: string) => {
    if (!user) return;
    try {
      await unclaimItem(itemId, user.signer);
    } catch (e) {
      console.error("Failed to unclaim item:", e);
    }
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
        <CardHeader>
          <CardTitle className="text-red-800 text-base">➕ Add Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="e.g., 2 lbs shrimp"
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Select value={newItemCategory} onValueChange={(v) => setNewItemCategory(v as SignUpCategory)}>
              <SelectTrigger className="w-36">
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
            <Button onClick={handleAdd} className="bg-red-600 hover:bg-red-700">
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

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
                  className="flex items-center justify-between p-3 bg-white/70 rounded-lg border border-orange-100"
                >
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${item.claimedBy ? "line-through text-gray-400" : "text-gray-900"}`}>
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
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUnclaim(item.id)}
                      >
                        Unclaim
                      </Button>
                      {item.createdBy === user?.pubkey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-red-600 px-2"
                          onClick={() => {
                            if (confirm("Delete this item?")) {
                              deleteItem(item.id, user.signer).catch((e) => console.error("Delete failed:", e));
                            }
                          }}
                          title="Delete item"
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  ) : !item.claimedBy ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        onClick={() => handleClaim(item.id, item.createdBy)}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        Claim
                      </Button>
                      {item.createdBy === user?.pubkey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-red-600 px-2"
                          onClick={() => {
                            if (confirm("Delete this item?")) {
                              deleteItem(item.id, user.signer).catch((e) => console.error("Delete failed:", e));
                            }
                          }}
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
                      className="text-gray-400 hover:text-red-600 px-2"
                      onClick={() => {
                        if (confirm("Delete this item?")) {
                          deleteItem(item.id, user.signer).catch((e) => console.error("Delete failed:", e));
                        }
                      }}
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

      {items.length === 0 && (
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

function ChatTab({ channel }: { channel: import("@/concord-v2/lib/types").ChannelV2 | undefined }) {
  const { messages, sendMessage, deleteMessage } = useChannelChat(channel);
  const { user } = useCurrentUser();
  const uploadFile = useUploadFile();
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<{ url: string; tags: string[][] }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
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
      await sendMessage(input, user.signer, attachmentTags);
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
    <Card className="border-orange-200 flex flex-col h-[65vh]">
      <CardHeader className="flex-shrink-0 pb-2">
        <CardTitle className="text-red-800 text-base">💬 Group Chat</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden px-3 pb-3">
        {/* Messages — native scroll for reliability */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          <div className="space-y-2 py-1">
            {messages.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">
                No messages yet. Say hello! 👋
              </p>
            ) : (
              messages.map((msg) => (
                <ChatMessageRow
                  key={msg.id}
                  msg={msg}
                  isMine={msg.pubkey === user?.pubkey}
                  onDelete={user ? (id) => {
                    deleteMessage(id, user.signer).catch((e) => console.error("Delete failed:", e));
                  } : undefined}
                />
              ))
            )}
          </div>
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
        <div className="flex gap-1 flex-shrink-0 items-end">
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
            className="p-2 text-gray-500 hover:text-red-600 disabled:opacity-40 flex-shrink-0"
            title="Attach image"
          >
            <ImageIcon size={20} />
          </button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            className="flex-1"
          />
          <Button onClick={handleSend} className="bg-red-600 hover:bg-red-700 flex-shrink-0">
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
