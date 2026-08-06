/**
 * /invite/:naddr#<fragment> — preview an invite and join the community.
 *
 * This is the whole redemption flow: fetch the bundle, show what you'd be
 * joining, and on confirm write the membership into the user's kind-13302
 * Community List. Joining no longer requires the Armada client.
 *
 * The parsed link is captured ON MOUNT because a remote-signer login can
 * round-trip the page, and the secret lives in the URL fragment.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityList } from "@/hooks/useCommunityList";
import { useInviteBundle } from "@/hooks/useInviteBundle";
import { usePublishCommunityList } from "@/hooks/usePublishCommunityList";
import { useDecryptedImage } from "@/hooks/useDecryptedImage";
import { LoginArea } from "@/components/auth/LoginArea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_BRANDING } from "@/lib/eventConfig";
import { applyRedemption, bundleToEntry, describeInviteError } from "@/lib/inviteRedemption";
import { isLive } from "@/concord-v2/lib/communityList";
import { parseInviteRoute } from "@/concord-v2/lib/invite";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-2 py-12 bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      <div className="w-full max-w-md text-center space-y-6">{children}</div>
    </div>
  );
}

export default function InviteLanding() {
  const { naddr } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { list } = useCommunityList();
  const publishList = usePublishCommunityList();
  const [joinError, setJoinError] = useState<string | null>(null);

  // Capture once: a bunker/nostrconnect login can re-render or navigate, and
  // the fragment must survive that.
  const [link] = useState(() => {
    const fragment = window.location.hash.replace(/^#/, "");
    return naddr ? parseInviteRoute(naddr, fragment) : undefined;
  });

  const { bundle, notFound, relaysTried, isLoading, error, refetch } = useInviteBundle(link);
  const iconUrl = useDecryptedImage(bundle?.icon);

  const alreadyMember = useMemo(
    () => (bundle ? isLive(list, bundle.community_id) : false),
    [list, bundle]
  );

  // Once joined, the list query is seeded synchronously by the publish hook,
  // so the destination renders with data already in place.
  useEffect(() => {
    if (publishList.isSuccess && bundle) {
      navigate(`/c/${bundle.community_id}`, { replace: true });
    }
  }, [publishList.isSuccess, bundle, navigate]);

  const handleJoin = () => {
    if (!bundle || !link) return;
    setJoinError(null);
    const entry = bundleToEntry(bundle, link);
    publishList.mutate((prev) => applyRedemption(prev, entry), {
      onError: (err) => setJoinError(describeInviteError(err).message),
    });
  };

  if (!link) {
    return (
      <Shell>
        <div className="text-5xl">🔗</div>
        <h1 className="text-xl font-bold text-red-800">That invite link isn't valid</h1>
        <p className="text-sm text-gray-600">
          It may be incomplete — invite links include a secret after the <code>#</code>, so
          copy the whole thing.
        </p>
        <Button onClick={() => navigate("/")} variant="outline">Back</Button>
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <Skeleton className="h-16 w-16 rounded-2xl mx-auto" />
        <Skeleton className="h-6 w-48 mx-auto" />
        <p className="text-sm text-gray-500">Looking up this invite…</p>
      </Shell>
    );
  }

  if (error || notFound) {
    const described = error
      ? describeInviteError(error)
      : {
          message: "Couldn't find this invite yet — it may not have reached these relays.",
          retryable: true,
        };
    return (
      <Shell>
        <div className="text-5xl">⚠️</div>
        <h1 className="text-xl font-bold text-red-800">{described.message}</h1>
        {notFound && (
          <p className="text-xs text-gray-500">
            Tried: {relaysTried.join(", ")}
          </p>
        )}
        <div className="flex gap-2 justify-center">
          {described.retryable && <Button onClick={refetch}>Try again</Button>}
          <Button onClick={() => navigate("/")} variant="outline">Back</Button>
        </div>
      </Shell>
    );
  }

  if (!bundle) return null;

  const preview = (
    <div className="space-y-3">
      {iconUrl ? (
        <img src={iconUrl} alt="" className="w-16 h-16 rounded-2xl mx-auto object-cover" />
      ) : (
        <div className="text-5xl">{APP_BRANDING.emoji}</div>
      )}
      <h1 className="text-2xl font-bold text-red-800">{bundle.name}</h1>
      <p className="text-sm text-gray-600">
        {bundle.channels.length > 0
          ? `${bundle.channels.length} channel${bundle.channels.length === 1 ? "" : "s"} included`
          : "You've been invited to join this community"}
      </p>
    </div>
  );

  if (!user) {
    return (
      <Shell>
        {preview}
        <div className="space-y-3 p-6 bg-white/60 rounded-2xl border border-orange-200">
          <p className="text-sm text-gray-700">Sign in to accept this invite.</p>
          <LoginArea className="w-full" />
        </div>
      </Shell>
    );
  }

  if (alreadyMember) {
    return (
      <Shell>
        {preview}
        <p className="text-sm text-gray-700">You're already in this community.</p>
        <Button
          onClick={() => navigate(`/c/${bundle.community_id}`)}
          className="bg-red-600 hover:bg-red-700"
        >
          Go to community
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      {preview}
      <div className="space-y-3 p-6 bg-white/60 rounded-2xl border border-orange-200">
        {joinError && <p className="text-sm text-red-600">{joinError}</p>}
        <Button
          onClick={handleJoin}
          disabled={publishList.isPending}
          className="w-full bg-red-600 hover:bg-red-700"
        >
          {publishList.isPending ? (
            <><Loader2 size={16} className="animate-spin mr-2" /> Joining…</>
          ) : (
            <>Join {bundle.name}</>
          )}
        </Button>
        <Button onClick={() => navigate("/")} variant="ghost" className="w-full">
          Not now
        </Button>
      </div>
    </Shell>
  );
}
