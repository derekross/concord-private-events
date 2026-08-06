/**
 * /app — the pre-multi-community route.
 *
 * Kept because bookmarks, shared links and the cached service-worker shell
 * still point here. Resolves to the user's single community when there is
 * exactly one, otherwise sends them to the picker.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityMemberships } from "@/hooks/useCommunityMemberships";
import { APP_BRANDING } from "@/lib/eventConfig";

export default function LegacyAppRedirect() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { memberships, isLoading } = useCommunityMemberships();

  useEffect(() => {
    if (!user) {
      navigate("/", { replace: true });
      return;
    }
    if (isLoading) return;
    if (memberships.length === 1) {
      navigate(`/c/${memberships[0].community.idHex}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [user, isLoading, memberships, navigate]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      <div className="text-center space-y-3">
        <div className="text-4xl animate-bounce">{APP_BRANDING.emoji}</div>
        <p className="text-sm text-gray-600">Loading…</p>
      </div>
    </div>
  );
}
