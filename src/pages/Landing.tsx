import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMemberships, type Membership } from "@/hooks/useCommunityMemberships";
import { LoginArea } from "@/components/auth/LoginArea";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_BRANDING, ARMADA_BASE } from "@/lib/eventConfig";
import { parseInviteLink, encodeFragment as concordEncodeFragment } from "@/concord-v2/lib/invite";

/**
 * Deterministic card colour from the community id, so a community always looks
 * the same without fetching anything. Real icons live behind the control-plane
 * fold, which would cost one wrap query per card on this screen.
 */
const CARD_GRADIENTS = [
  "from-orange-400 to-red-500",
  "from-sky-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-fuchsia-400 to-purple-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
];

function gradientFor(idHex: string) {
  let h = 0;
  for (let i = 0; i < idHex.length; i++) h = (h * 31 + idHex.charCodeAt(i)) >>> 0;
  return CARD_GRADIENTS[h % CARD_GRADIENTS.length];
}

function monogram(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const chars = [...trimmed];
  // Emoji-first names (common in Concord) read better as the emoji itself.
  return /\p{Extended_Pictographic}/u.test(chars[0]) ? chars[0] : chars[0].toUpperCase();
}

function CommunityCard({ membership, onOpen }: { membership: Membership; onOpen: () => void }) {
  const name = membership.entry.current?.name || "Untitled community";
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 p-3 bg-white/70 hover:bg-white rounded-2xl border border-orange-200 transition text-left"
    >
      <div
        className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradientFor(
          membership.community.idHex
        )} flex items-center justify-center text-xl font-bold text-white flex-shrink-0`}
      >
        {monogram(name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-800 truncate">{name}</p>
        {membership.isExcluded && (
          <p className="text-xs text-amber-700">Removed — read-only</p>
        )}
      </div>
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { memberships, isLoading } = useCommunityMemberships();
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState("");

  // Exactly one community → go straight in, preserving the single-community
  // experience. With several, always show the picker: auto-resuming the last
  // one would make this screen unreachable (back would just re-redirect).
  useEffect(() => {
    if (!user || isLoading) return;
    if (memberships.length === 1) {
      navigate(`/c/${memberships[0].community.idHex}`, { replace: true });
    }
  }, [user, isLoading, memberships, navigate]);

  const handleInviteSubmit = () => {
    const trimmed = inviteInput.trim();
    if (!trimmed) {
      setInviteError("Please paste your invite link");
      return;
    }
    const parsed = parseInviteLink(trimmed);
    if (!parsed) {
      setInviteError("That doesn't look like a valid invite link");
      return;
    }
    const fragment = concordEncodeFragment(parsed.token, parsed.bootstrapRelays);
    navigate(`/invite/${parsed.naddr}#${fragment}`);
  };

  const inviteBox = (
    <div className="space-y-3 p-6 bg-white/60 rounded-2xl border border-orange-200 text-left">
      <p className="text-sm font-medium text-gray-700">Have an invite link?</p>
      <Textarea
        value={inviteInput}
        onChange={(e) => {
          setInviteInput(e.target.value);
          setInviteError("");
        }}
        placeholder="https://... or naddr1..."
        className="min-h-[80px] text-sm"
      />
      {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
      <Button onClick={handleInviteSubmit} className="w-full bg-red-600 hover:bg-red-700">
        Continue {APP_BRANDING.emoji}
      </Button>
    </div>
  );

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-2 py-12 bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      <div className="w-full max-w-md text-center space-y-8">
        <div className="space-y-4">
          <div className="text-7xl mb-2 animate-bounce-slow">{APP_BRANDING.emoji}</div>
          <h1 className="text-4xl font-bold text-red-800 tracking-tight">{APP_BRANDING.name}</h1>
          <p className="text-lg text-orange-700 font-medium">{APP_BRANDING.subtitle}</p>
        </div>

        {!user ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Sign in with your Nostr account to see your communities.
            </p>
            <LoginArea className="w-full" />
            {inviteBox}
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-[72px] w-full rounded-2xl" />
            <Skeleton className="h-[72px] w-full rounded-2xl" />
          </div>
        ) : memberships.length === 0 ? (
          <div className="space-y-4">
            <div className="p-6 bg-white/60 rounded-2xl border border-orange-200">
              <p className="text-sm text-gray-700">You're not in any communities yet.</p>
              <p className="text-xs text-gray-500 mt-2">
                Paste an invite below, or create a community in{" "}
                <a href={ARMADA_BASE} className="underline" target="_blank" rel="noreferrer">
                  Armada
                </a>
                .
              </p>
            </div>
            {inviteBox}
          </div>
        ) : memberships.length === 1 ? (
          // The effect above is navigating; render nothing rather than flashing
          // the picker for a single community.
          null
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700">Choose a community</p>
            <div className="space-y-2">
              {memberships.map((m) => (
                <CommunityCard
                  key={m.community.idHex}
                  membership={m}
                  onOpen={() => navigate(`/c/${m.community.idHex}`)}
                />
              ))}
            </div>
            {inviteBox}
          </div>
        )}

        <p className="text-xs text-gray-400 mt-12">Powered by Nostr · Concord V2</p>
      </div>
    </div>
  );
}
