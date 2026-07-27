/**
 * useCommunityMembership — check if the current user is a member of the
 * configured Concord V2 community by reading their Community List (kind 13302).
 */

import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import { KIND_COMMUNITY_LIST } from "@/concord-v2/lib/kinds";
import { EVENT_CONFIG } from "@/lib/eventConfig";

export function useCommunityMembership(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ["community-membership", pubkey],
    queryFn: async ({ signal }) => {
      if (!pubkey) return false;
      if (!EVENT_CONFIG.communityId) return false;

      const [event] = await nostr.query(
        [{ kinds: [KIND_COMMUNITY_LIST], authors: [pubkey] }],
        { signal }
      );

      if (!event) return false;

      try {
        const content = JSON.parse(event.content);
        const memberships = Array.isArray(content) ? content : content.communities ?? [];
        return memberships.some(
          (m: { community_id?: string }) => m.community_id === EVENT_CONFIG.communityId
        );
      } catch {
        return false;
      }
    },
    enabled: !!pubkey && !!EVENT_CONFIG.communityId,
    staleTime: 30_000,
  });
}
