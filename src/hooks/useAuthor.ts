/**
 * useAuthor — resolve a pubkey's kind-0 profile (display name, picture, etc.)
 * Lightweight version of Armada's useAuthor.
 */
import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import { NSchema as n } from "@nostrify/nostrify";

export interface AuthorProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();

  // NOTE: never resolve to undefined — TanStack Query throws on undefined
  // query data. Unknown/missing profiles resolve to a bare { pubkey }.
  return useQuery<AuthorProfile>({
    queryKey: ["author", pubkey ?? ""],
    queryFn: async ({ signal }) => {
      if (!pubkey) return { pubkey: "" };

      const [event] = await nostr.query(
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { signal }
      );

      if (!event) return { pubkey };

      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        return { pubkey, ...metadata };
      } catch {
        return { pubkey };
      }
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Get the best display name for an author */
export function getDisplayName(profile: AuthorProfile | undefined, pubkey: string): string {
  if (profile?.display_name) return profile.display_name;
  if (profile?.name) return profile.name;
  // Short npub fallback
  return pubkey.slice(0, 8) + "…";
}
