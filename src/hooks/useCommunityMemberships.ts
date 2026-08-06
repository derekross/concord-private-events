/**
 * useCommunityMemberships — every community the user belongs to.
 *
 * Pure derivation over useCommunityList: no extra network call. The list was
 * already being fetched and fully decrypted; the app just used to discard
 * everything except one hardcoded community.
 *
 * Entries that fail to rehydrate are dropped. That is a fail-closed outcome by
 * design — rehydrateCommunity runs verifyCommunityId, so a corrupt or forged
 * entry yields undefined rather than a community with unverified keys.
 */

import { useMemo } from "react";

import { useCommunityList } from "@/hooks/useCommunityList";
import {
  isExcluded,
  liveEntries,
  rehydrateCommunity,
  type CommunityListEntry,
} from "@/concord-v2/lib/communityList";
import type { CommunityV2 } from "@/concord-v2/lib/types";

const LAST_COMMUNITY_KEY = "concord-events:last-community";

export interface Membership {
  entry: CommunityListEntry;
  community: CommunityV2;
  /** Removed by a rekey that carried no blob for us: still listed, read-only. */
  isExcluded: boolean;
}

export interface CommunityMembershipsResult {
  memberships: Membership[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/** Remember the last community opened. Used ONLY to sort the picker. */
export function rememberLastCommunity(communityId: string): void {
  try {
    localStorage.setItem(LAST_COMMUNITY_KEY, communityId);
  } catch {
    // Private mode / storage disabled — ordering is cosmetic, ignore.
  }
}

function readLastCommunity(): string | null {
  try {
    return localStorage.getItem(LAST_COMMUNITY_KEY);
  } catch {
    return null;
  }
}

export function useCommunityMemberships(): CommunityMembershipsResult {
  const { list, isLoading, isError, error } = useCommunityList();

  const memberships = useMemo(() => {
    const last = readLastCommunity();

    const out: Membership[] = [];
    for (const entry of liveEntries(list)) {
      // No extraRelays: rehydrateCommunity's own docstring forbids passing the
      // deployment's platform relays here. A relay holding no Concord wraps
      // answers every plane REQ with an instant empty EOSE, winning the
      // backfill page race and starving the real relays (their issue #19).
      const community = rehydrateCommunity(entry);
      if (!community) continue;
      out.push({ entry, community, isExcluded: isExcluded(entry) });
    }

    out.sort((a, b) => {
      if (a.community.idHex === last) return -1;
      if (b.community.idHex === last) return 1;
      const an = a.entry.current?.name ?? "";
      const bn = b.entry.current?.name ?? "";
      return an.localeCompare(bn);
    });

    return out;
  }, [list]);

  return { memberships, isLoading, isError, error };
}
