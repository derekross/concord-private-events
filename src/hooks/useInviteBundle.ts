/**
 * useInviteBundle — fetch and open the kind-33301 bundle an invite points at.
 *
 * The bundle is self-certifying: parseBundleEvent verifies the event's kind,
 * author and signature, decrypts it with the link's token, and checks
 * community_id == H(owner || owner_salt). Nothing external is needed to know
 * which community an invite is for, and a tampered bundle fails closed.
 *
 * Relay selection is the crux. Every other query in this app routes through the
 * app's fixed relay set, but an invite minted in another client may only exist
 * on the relays encoded in the link fragment. NPool accepts a per-call relay
 * override, so we query the union of both — without it most real invites would
 * simply report "not found".
 */

import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";

import { APP_RELAYS } from "@/lib/appRelays";
import {
  parseBundleEvent,
  type InviteBundle,
  type ParsedInviteLink,
} from "@/concord-v2/lib/invite";
import { KIND_INVITE_BUNDLE } from "@/concord-v2/lib/kinds";

export interface InviteBundleResult {
  bundle: InviteBundle | null;
  /** No bundle event found anywhere we looked. Retryable, unlike a bad bundle. */
  notFound: boolean;
  relaysTried: string[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useInviteBundle(link: ParsedInviteLink | undefined): InviteBundleResult {
  const { nostr } = useNostr();

  const relaysTried = [
    ...new Set([
      ...(link?.bootstrapRelays ?? []),
      ...APP_RELAYS.relays.filter((r) => r.read).map((r) => r.url),
    ]),
  ];

  const { data, isLoading, error, refetch } = useQuery({
    // The token is a secret; keep it out of the query key. The link signer is
    // single-use and already uniquely identifies the bundle.
    queryKey: ["concord2", "invite", link?.linkSigner],
    enabled: Boolean(link),
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      if (!link) return { bundle: null, notFound: true };

      const events = await nostr.query(
        [{ kinds: [KIND_INVITE_BUNDLE], authors: [link.linkSigner], limit: 5 }],
        { signal, relays: relaysTried }
      );

      // Newest wins: a revocation is a newer replacement at the same
      // coordinate, and parseBundleEvent turns that into a `revoked` error —
      // which is exactly what we want to surface.
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return { bundle: null, notFound: true };

      // Throws InviteError (bad-bundle / revoked / expired / owner-mismatch).
      const bundle = parseBundleEvent(latest, link.linkSigner, link.token, Date.now());
      return { bundle, notFound: false };
    },
  });

  return {
    bundle: data?.bundle ?? null,
    notFound: data?.notFound ?? false,
    relaysTried,
    isLoading,
    error: (error as Error) ?? null,
    refetch: () => void refetch(),
  };
}
