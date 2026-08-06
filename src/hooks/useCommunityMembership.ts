/**
 * useCommunityMembership — is the current user a member of this community,
 * and are they its owner?
 *
 * Membership means "holds usable keys": the community rehydrated out of the
 * user's own encrypted Community List. Ownership compares against
 * `community.owner`, which rehydrateCommunity has already checked with
 * verifyCommunityId (community_id == H(owner || owner_salt)).
 *
 * Both facts therefore come from the protocol, never from client config. That
 * matters: the previous version treated a hardcoded pubkey as "always a
 * member", which is an authorization check a deployment config has no business
 * making. It also bought nothing — an owner with no list entry has no keys, so
 * the control plane stays disabled and every tab renders empty anyway.
 *
 * The UI gate this feeds is convenience only. The real boundary is that
 * without list keys nothing decrypts.
 */

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityData } from "@/hooks/useCommunityData";

export interface CommunityMembershipResult {
  isMember: boolean;
  isOwner: boolean;
  /** Removed by a rekey that carried no blob for us: listed, but read-only. */
  isExcluded: boolean;
  isLoading: boolean;
}

export function useCommunityMembership(
  communityId: string | undefined
): CommunityMembershipResult {
  const { user } = useCurrentUser();
  const { community, isExcluded, isLoading } = useCommunityData(communityId);

  const isMember = Boolean(community);
  const isOwner = Boolean(
    community && user?.pubkey &&
    user.pubkey.toLowerCase() === community.owner.toLowerCase()
  );

  return { isMember, isOwner, isExcluded, isLoading };
}
