import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMembership } from "@/hooks/useCommunityMembership";
import { EVENT_CONFIG, CATEGORY_LABELS, SIGN_UP_CATEGORIES, type SignUpCategory } from "@/lib/eventConfig";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type Tab = "details" | "signup" | "chat";

export default function AppPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { data: isMember, isLoading } = useCommunityMembership(user?.pubkey);
  const [tab, setTab] = useState<Tab>("details");

  // Auth gate
  if (!user) {
    navigate("/");
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
        <div className="text-center space-y-3">
          <div className="text-4xl animate-bounce">🦐</div>
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

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
            <EventDetailsTab />
          </TabsContent>

          <TabsContent value="signup">
            <SignUpTab />
          </TabsContent>

          <TabsContent value="chat">
            <ChatTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ── Event Details Tab ────────────────────────────────────────────────────────

function EventDetailsTab() {
  return (
    <Card className="border-orange-200">
      <CardHeader>
        <CardTitle className="text-red-800 flex items-center gap-2">
          📋 Event Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!EVENT_CONFIG.communityId ? (
          <div className="space-y-3 text-center py-6">
            <div className="text-4xl">🦐</div>
            <p className="text-sm text-gray-600">
              Event details will appear here once the community is set up.
            </p>
            <p className="text-xs text-gray-400">
              Derek needs to create the Concord community in Armada or Vector,
              then update the config with the community ID.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <DetailRow label="📅 Date" value="TBD — check the event-info channel" />
            <DetailRow label="🕐 Time" value="TBD" />
            <DetailRow label="📍 Location" value="TBD — check the event-info channel" />
            <DetailRow label="🅿️ Parking" value="TBD" />
            <div className="pt-4 border-t border-orange-100">
              <p className="text-xs text-gray-500">
                Details are stored as encrypted messages in the event-info channel.
                Once the community is active, they'll show up here automatically.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm font-medium text-gray-600">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

// ── Sign-Up Board Tab ────────────────────────────────────────────────────────

function SignUpTab() {
  // Channel would come from community context
  // For now, pass undefined — will be wired when community is configured
  const { items, addItem, claimItem, unclaimItem } = useSignUpBoard(undefined);
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUnclaim(item.id)}
                    >
                      Unclaim
                    </Button>
                  ) : !item.claimedBy ? (
                    <Button
                      size="sm"
                      onClick={() => handleClaim(item.id, item.createdBy)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      Claim
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
            {!EVENT_CONFIG.communityId
              ? "Sign-up board will be available once the community is set up."
              : "No items yet. Add the first one above!"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const { messages, sendMessage } = useChannelChat(undefined);
  const { user } = useCurrentUser();
  const [input, setInput] = useState("");

  const handleSend = async () => {
    if (!input.trim() || !user) return;
    try {
      await sendMessage(input, user.signer);
      setInput("");
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  return (
    <Card className="border-orange-200 flex flex-col h-[60vh]">
      <CardHeader className="flex-shrink-0">
        <CardTitle className="text-red-800 text-base">💬 Group Chat</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
        <ScrollArea className="flex-1 px-1">
          <div className="space-y-2">
            {messages.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">
                {!EVENT_CONFIG.communityId
                  ? "Chat will be available once the community is set up."
                  : "No messages yet. Say hello! 👋"}
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.pubkey === user?.pubkey ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      msg.pubkey === user?.pubkey
                        ? "bg-red-600 text-white rounded-br-sm"
                        : "bg-white text-gray-900 border border-orange-100 rounded-bl-sm"
                    }`}
                  >
                    <p>{msg.content}</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 px-2">
                    {new Date(msg.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        <div className="flex gap-2 flex-shrink-0">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            className="flex-1"
          />
          <Button onClick={handleSend} className="bg-red-600 hover:bg-red-700">
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
