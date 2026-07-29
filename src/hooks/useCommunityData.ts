/**
 * useCommunityData — load the Concord V2 community from the user's Community List.
 *
 * Fetches the kind-13302 event, NIP-44 decrypts it to self, finds the entry
 * matching EVENT_CONFIG.communityId, and rehydrates it into a runtime
 * CommunityV2 object with encryption keys.
 */

import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EMPTY_COMMUNITY_LIST,
  isLive,
  rehydrateCommunity,
  type CommunityList,
} from "@/concord-v2/lib/communityList";
import { KIND_COMMUNITY_LIST } from "@/concord-v2/lib/kinds";
import { EVENT_CONFIG } from "@/lib/eventConfig";
import type { CommunityV2 } from "@/concord-v2/lib/types";

export interface CommunityDataResult {
  /** The rehydrated community, or null when the user isn't a member (never
   *  undefined — TanStack Query throws on undefined query data). */
  community: CommunityV2 | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export function useCommunityData(): CommunityDataResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const pubkey = user?.pubkey;
  const signer = user?.signer;

  const queryKey = ["concord2", "list", pubkey, EVENT_CONFIG.communityId] as const;

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    enabled: Boolean(pubkey && EVENT_CONFIG.communityId),
    // Poll briskly: key rotations (bans/refounding) arrive as a new list
    // entry with fresh held_roots — the whole app re-derives from this.
    staleTime: 15_000,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      if (!pubkey || !EVENT_CONFIG.communityId) return null;

      // Fetch the user's kind-13302 Community List
      const events = await nostr.query(
        [{ kinds: [KIND_COMMUNITY_LIST], authors: [pubkey], limit: 1 }],
        { signal }
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;

      let list: CommunityList = EMPTY_COMMUNITY_LIST;

      if (latest?.content && signer?.nip44) {
        try {
          const decrypted = await signer.nip44.decrypt(pubkey, latest.content);
          const parsed = JSON.parse(decrypted) as Partial<CommunityList>;
          list = {
            ...parsed,
            entries: Array.isArray(parsed.entries) ? parsed.entries : [],
            tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
          } as CommunityList;
        } catch (err) {
          console.warn("[useCommunityData] Failed to decrypt Community List:", err);
          return null;
        }
      } else if (latest?.content && !signer?.nip44) {
        return null;
      }

      // Find the entry matching our configured community
      const communityId = EVENT_CONFIG.communityId;
      if (!isLive(list, communityId)) {
        // Not in the list — could be the owner (who might not have a list entry yet)
        // or genuinely not a member.
        return null;
      }

      const entry = list.entries.find((e) => e.community_id === communityId);
      if (!entry) return null;

      // Rehydrate the runtime community object with encryption keys
      const community = rehydrateCommunity(entry, EVENT_CONFIG.relays);
      return community;
    },
  });

  return {
    community: data ?? null,
    isLoading,
    isError,
    error: error as Error | null,
  };
}
