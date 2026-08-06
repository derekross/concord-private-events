/**
 * useCommunityData — one community from the user's Community List, by id.
 *
 * Pure selection over useCommunityMemberships, so it costs no network call of
 * its own. Returns the rehydrated CommunityV2 (with encryption keys) plus the
 * raw list entry, which callers need for invite_ref re-resolution.
 *
 * Pass the id from the route. A community the user isn't in returns null, and
 * callers redirect — the UI gate is convenience only; the real boundary is that
 * without this entry there are no keys, so nothing decrypts.
 */

import { useMemo } from "react";

import { useCommunityMemberships } from "@/hooks/useCommunityMemberships";
import type { CommunityListEntry } from "@/concord-v2/lib/communityList";
import type { CommunityV2 } from "@/concord-v2/lib/types";

export interface CommunityDataResult {
  /** The rehydrated community, or null when the user isn't a member. */
  community: CommunityV2 | null;
  /** The backing list entry, or null. */
  entry: CommunityListEntry | null;
  /** Removed by a rekey that carried no blob for us: readable UI, stale keys. */
  isExcluded: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export function useCommunityData(
  communityId: string | undefined
): CommunityDataResult {
  const { memberships, isLoading, isError, error } = useCommunityMemberships();

  const match = useMemo(() => {
    if (!communityId) return null;
    const wanted = communityId.toLowerCase();
    return memberships.find((m) => m.community.idHex.toLowerCase() === wanted) ?? null;
  }, [memberships, communityId]);

  return {
    community: match?.community ?? null,
    entry: match?.entry ?? null,
    isExcluded: match?.isExcluded ?? false,
    isLoading,
    isError,
    error,
  };
}
