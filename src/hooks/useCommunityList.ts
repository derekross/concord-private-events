/**
 * useCommunityList — the user's kind-13302 Community List, decrypted.
 *
 * This is the ONLY network read for membership. Everything else in the app
 * (which communities you're in, which one you're viewing, whether you're the
 * owner) is derived from this one query, so switching communities costs no
 * extra round-trip.
 *
 * `decryptFailed` is deliberately distinct from "empty list". A decrypt failure
 * (signer offline, bunker dropped) previously looked identical to "no
 * memberships" — harmless while the list was read-only, but a write path must
 * never treat it as an empty list and replace the whole document with one
 * entry. Any publisher MUST refuse when this is true.
 */

import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import type { NostrEvent } from "@nostrify/nostrify";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EMPTY_COMMUNITY_LIST,
  type CommunityList,
} from "@/concord-v2/lib/communityList";
import { KIND_COMMUNITY_LIST } from "@/concord-v2/lib/kinds";

export interface CommunityListResult {
  list: CommunityList;
  /** The source event, needed for read-modify-write publishes. */
  event: NostrEvent | null;
  /** A list exists but could not be decrypted. Publishing must abort. */
  decryptFailed: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

interface ListQueryData {
  list: CommunityList;
  event: NostrEvent | null;
  decryptFailed: boolean;
}

const EMPTY: ListQueryData = {
  list: EMPTY_COMMUNITY_LIST,
  event: null,
  decryptFailed: false,
};

/** Query key shared with the publish path so it can seed/invalidate the cache. */
export function communityListQueryKey(pubkey: string | undefined) {
  return ["concord2", "list", pubkey] as const;
}

export function useCommunityList(): CommunityListResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const pubkey = user?.pubkey;
  const signer = user?.signer;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: communityListQueryKey(pubkey),
    enabled: Boolean(pubkey),
    // Poll briskly: key rotations (bans/refounding) arrive as a new list entry
    // with fresh held_roots — the whole app re-derives from this.
    staleTime: 15_000,
    refetchInterval: 15_000,
    queryFn: async ({ signal }): Promise<ListQueryData> => {
      if (!pubkey) return EMPTY;

      const events = await nostr.query(
        [{ kinds: [KIND_COMMUNITY_LIST], authors: [pubkey], limit: 1 }],
        { signal }
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
      if (!latest?.content) return EMPTY;

      if (!signer?.nip44) {
        return { list: EMPTY_COMMUNITY_LIST, event: latest, decryptFailed: true };
      }

      try {
        const decrypted = await signer.nip44.decrypt(pubkey, latest.content);
        const parsed = JSON.parse(decrypted) as Partial<CommunityList>;
        return {
          list: {
            ...parsed,
            entries: Array.isArray(parsed.entries) ? parsed.entries : [],
            tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
          } as CommunityList,
          event: latest,
          decryptFailed: false,
        };
      } catch (err) {
        console.warn("[useCommunityList] Failed to decrypt Community List:", err);
        return { list: EMPTY_COMMUNITY_LIST, event: latest, decryptFailed: true };
      }
    },
  });

  return {
    list: data?.list ?? EMPTY_COMMUNITY_LIST,
    event: data?.event ?? null,
    decryptFailed: data?.decryptFailed ?? false,
    isLoading,
    isError,
    error: error as Error | null,
  };
}
