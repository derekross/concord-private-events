/**
 * The relays that serve the community currently open.
 *
 * Every Nostr call in this app otherwise routes through one NPool bound to the
 * app's fixed relay set (NIP-65 sync is deliberately disabled). That is fine
 * for a single-community deployment, but a community hosted on its OWN relays
 * would then appear in the picker and render completely empty — the membership
 * list decrypts locally, while none of its wraps are anywhere we look.
 *
 * This is context rather than a prop for a specific reason: the relays are
 * ambient for everything rendered inside a community route, and with props a
 * future hook that forgets to thread them would silently regress to app-only
 * relays — the exact bug this fixes, reintroduced quietly. With context, the
 * correct behaviour is the default.
 */

import { createContext, useContext } from "react";

import { APP_RELAYS } from "@/lib/appRelays";
import type { CommunityV2 } from "@/concord-v2/lib/types";

/** undefined => no community context; fall back to the pool's default routing. */
export const CommunityRelaysContext = createContext<string[] | undefined>(undefined);

export function useCommunityRelays(): string[] | undefined {
  return useContext(CommunityRelaysContext);
}

/**
 * App relays UNIONED with the community's own, so a community whose relays are
 * unreachable still works and one on private relays becomes reachable.
 *
 * This union is safe here, which is worth stating because it looks like the
 * thing rehydrateCommunity forbids. That prohibition is about writing platform
 * relays INTO community.relays, where an empty-but-fast relay wins a paged
 * backfill's page race and starves the real ones. These are single-shot
 * `limit: 500` queries with no paging, so an extra fast-EOSE relay costs
 * nothing.
 */
export function resolveCommunityRelays(
  community: CommunityV2 | null | undefined
): string[] | undefined {
  if (!community?.relays?.length) return undefined;
  const app = APP_RELAYS.relays.filter((r) => r.read).map((r) => r.url);
  return [...new Set([...community.relays, ...app])];
}
