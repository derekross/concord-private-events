/**
 * useCommunityMembership — check if the current user is a member of the
 * configured Concord V2 community.
 *
 * Uses useCommunityData: if the community data loads (the user has keys
 * for it in their Community List), they're a member. The owner is always
 * a member by definition.
 */

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityData } from "@/hooks/useCommunityData";
import { EVENT_CONFIG } from "@/lib/eventConfig";

export function useCommunityMembership(_pubkey: string | undefined) {
  const { user } = useCurrentUser();
  const { community, isLoading } = useCommunityData();

  // The owner is always a member (case-insensitive hex compare)
  const ownerHex = EVENT_CONFIG.communityOwner.toLowerCase();
  const userHex = user?.pubkey?.toLowerCase();
  const isOwner = userHex === ownerHex;

  // If we successfully loaded the community object, the user has keys → member
  // While loading, we don't know yet — return false but isLoading=true so
  // callers can gate on isLoading rather than getting a false negative.
  const isMember = Boolean(community) || isOwner;

  return {
    data: isMember,
    // Stay loading while community data loads AND we're not the owner
    // (owner can skip the wait). This prevents premature redirects.
    isLoading: isLoading && !isOwner,
  };
}
