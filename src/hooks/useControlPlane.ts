/**
 * useControlPlane — fetch and fold the Concord V2 Control Plane.
 *
 * Queries relays for kind-1059 wraps addressed to the control plane's group
 * pubkeys, opens them, and folds the editions into current state (channels,
 * metadata, roles, banlist).
 */

import { useNostr } from "@nostrify/react";
import { resolveCommunityRelays } from "@/contexts/CommunityRelaysContext";
import { useQuery } from "@tanstack/react-query";

import {
  controlGroups,
  currentControlGroup,
  foldControlState,
  openControlWraps,
  type FoldedControl,
} from "@/concord-v2/lib/control";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "nostr-tools/pure";

export interface ControlPlaneResult {
  /** The folded control plane (never undefined — TanStack Query throws on
   *  undefined query data). */
  folded: FoldedControl | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export function useControlPlane(community: CommunityV2 | null | undefined): ControlPlaneResult {
  const { nostr } = useNostr();

  const cidHex = community?.idHex ?? null;
  const epochSig = community?.heldRoots.map((r) => r.epoch.toString()).join(",") ?? "";
  const queryKey = ["concord2", "control", cidHex, epochSig] as const;

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    enabled: Boolean(community),
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      if (!community) return null;

      const groups = controlGroups(community);
      const authors = groups.map((g) => g.pk);

      // Query the community's own relays as well as the app's: a community
      // hosted elsewhere has no control-plane wraps on our default set.
      const wraps = await nostr.query(
        [{ kinds: [KIND_WRAP], authors, limit: 500 }],
        { signal, relays: resolveCommunityRelays(community) }
      );

      // Open the wraps using the control group keys
      const editions = openControlWraps(wraps as NostrEvent[], groups);

      // Fold the editions into current state
      const curPk = currentControlGroup(community).pk;
      const snapshotIds =
        community.rootEpoch > 0n
          ? new Set(
              wraps
                .filter((w) => w.pubkey === curPk)
                .map((w) => w.id)
            )
          : undefined;

      const folded = foldControlState(editions, community.id, community.owner, undefined, snapshotIds);

      return folded;
    },
  });

  return {
    folded: data ?? null,
    isLoading,
    isError,
    error: error as Error | null,
  };
}
