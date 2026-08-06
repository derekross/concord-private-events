/**
 * usePublishCommunityList — the only write path for the kind-13302 list.
 *
 * Kind 13302 is a self-encrypted REPLACEABLE event: every publish replaces the
 * whole document. Getting this wrong doesn't corrupt one entry, it drops every
 * membership the user has. Three guards make that structurally hard:
 *
 *  1. The mutation takes a REDUCER, not a list. Callers cannot publish a list
 *     they built from stale state — they describe a change instead.
 *  2. It re-fetches immediately before writing, shrinking the lost-update
 *     window against another device.
 *  3. It REFUSES when the current list failed to decrypt. A signer that went
 *     away mid-session must never be mistaken for "no memberships", which
 *     would replace everything with a single entry.
 *
 * Publishes with `tags: []` and without the app's client tag, matching what
 * Armada writes for the same kind.
 */

import { useNostr } from "@nostrify/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NostrEvent } from "@nostrify/nostrify";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { communityListQueryKey } from "@/hooks/useCommunityList";
import {
  EMPTY_COMMUNITY_LIST,
  type CommunityList,
} from "@/concord-v2/lib/communityList";
import { KIND_COMMUNITY_LIST } from "@/concord-v2/lib/kinds";

type Reducer = (prev: CommunityList) => CommunityList;

interface ListQueryData {
  list: CommunityList;
  event: NostrEvent | null;
  decryptFailed: boolean;
}

export function usePublishCommunityList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation<NostrEvent, Error, Reducer>({
    mutationFn: async (reduce: Reducer) => {
      const pubkey = user?.pubkey;
      const signer = user?.signer;
      if (!pubkey || !signer) throw new Error("You need to be signed in.");
      if (!signer.nip44) {
        throw new Error("Your signer can't encrypt (NIP-44), so your community list can't be updated.");
      }

      const key = communityListQueryKey(pubkey);

      // Read-modify-write against the freshest copy we can get.
      const fresh = await queryClient.fetchQuery<ListQueryData>({
        queryKey: key,
        staleTime: 0,
      });

      if (fresh?.decryptFailed) {
        throw new Error(
          "Your existing community list couldn't be decrypted, so it can't be safely updated. " +
            "Reconnect your signer and try again."
        );
      }

      const prev = fresh?.list ?? EMPTY_COMMUNITY_LIST;
      const next = reduce(prev);

      const content = await signer.nip44.encrypt(pubkey, JSON.stringify(next));
      const signed = await signer.signEvent({
        kind: KIND_COMMUNITY_LIST,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(signed, { signal: AbortSignal.timeout(10_000) });

      // Seed the cache so the destination renders immediately rather than
      // waiting for the next 15s poll.
      queryClient.setQueryData<ListQueryData>(key, {
        list: next,
        event: signed,
        decryptFailed: false,
      });

      return signed;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: communityListQueryKey(user?.pubkey) });
    },
  });
}
