import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMembership } from "@/hooks/useCommunityMembership";
import { LoginArea } from "@/components/auth/LoginArea";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_CONFIG } from "@/lib/eventConfig";
import { parseInviteLink, encodeFragment as concordEncodeFragment } from "@/concord-v2/lib/invite";

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { data: isMember, isLoading } = useCommunityMembership(user?.pubkey);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState("");

  // Redirect members to the app
  if (user && isMember) {
    navigate("/app");
    return null;
  }

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

    // Navigate to the invite route, properly re-encoding the fragment
    const naddr = parsed.naddr;
    const fragment = concordEncodeFragment(parsed.token, parsed.bootstrapRelays);
    navigate(`/invite/${naddr}#${fragment}`);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Hero */}
        <div className="space-y-4">
          <div className="text-7xl mb-2 animate-bounce-slow">{EVENT_CONFIG.emoji}</div>
          <h1 className="text-4xl font-bold text-red-800 tracking-tight">
            {EVENT_CONFIG.name}
          </h1>
          <p className="text-lg text-orange-700 font-medium">
            {EVENT_CONFIG.subtitle}
          </p>
        </div>

        {/* Auth Section */}
        {!user ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Sign in with your Nostr account to view event details and sign up.
            </p>
            <LoginArea className="w-full" />
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            <div className="text-2xl">⏳</div>
            <p className="text-sm text-gray-600">Checking membership...</p>
          </div>
        ) : !EVENT_CONFIG.communityId ? (
          /* Community not configured yet */
          <div className="space-y-4 p-6 bg-white/60 rounded-2xl border border-orange-200">
            <div className="text-2xl">🎉</div>
            <p className="text-sm text-gray-700">
              Welcome! The event community hasn't been set up yet.
              Derek needs to create the community first, then this page will come alive.
            </p>
          </div>
        ) : !isMember ? (
          /* Not a member — show invite input */
          <div className="space-y-4 p-6 bg-white/60 rounded-2xl border border-orange-200">
            <p className="text-sm font-medium text-gray-700">
              You need an invite to join this event.
            </p>
            <p className="text-xs text-gray-500">
              Paste your invite link below:
            </p>
            <Textarea
              value={inviteInput}
              onChange={(e) => {
                setInviteInput(e.target.value);
                setInviteError("");
              }}
              placeholder="https://... or naddr1..."
              className="min-h-[80px] text-sm"
            />
            {inviteError && (
              <p className="text-xs text-red-600">{inviteError}</p>
            )}
            <Button
              onClick={handleInviteSubmit}
              className="w-full bg-red-600 hover:bg-red-700"
            >
              Join Event 🦐
            </Button>
          </div>
        ) : null}

        {/* Footer */}
        <p className="text-xs text-gray-400 mt-12">
          Powered by Nostr · Concord V2
        </p>
      </div>
    </div>
  );
}


