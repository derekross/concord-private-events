/**
 * Invite redemption — pure logic, no React, no network.
 *
 * Turning a validated InviteBundle into a Community List entry. Kept separate
 * from the hooks so the whole chain (mint → parse → convert → add → rehydrate)
 * can be exercised in-process, which is where the field-mapping bugs live.
 */

import {
  addToList,
  assertListBounds,
  type CommunityList,
  type CommunityListEntry,
  type JoinMaterial,
} from "@/concord-v2/lib/communityList";
import { InviteError, encodeFragment, type InviteBundle, type ParsedInviteLink } from "@/concord-v2/lib/invite";

/**
 * NIP-44 v2 caps plaintext at 65535 bytes. Stay well under: the list is
 * re-encrypted whole on every write, and going over would make the membership
 * list unpublishable — locking the user out of joining anything else.
 */
const MAX_LIST_BYTES = 60_000;

/**
 * The membership subset of a bundle.
 *
 * Built field by field ON PURPOSE — never spread the bundle. JoinMaterial is
 * documented as "the invite bundle's MEMBERSHIP subset (never the icon, never
 * the link fields)", and a spread would silently carry `icon`, `expires_at`,
 * `creator_npub` and `label` into every future re-publish of the list.
 */
export function bundleToJoinMaterial(bundle: InviteBundle): JoinMaterial {
  const jm: JoinMaterial = {
    community_id: bundle.community_id,
    owner: bundle.owner,
    owner_salt: bundle.owner_salt,
    community_root: bundle.community_root,
    root_epoch: bundle.root_epoch,
    channels: bundle.channels.map((c) => ({
      id: c.id,
      key: c.key,
      epoch: c.epoch,
      name: c.name,
    })),
    relays: [...bundle.relays],
    name: bundle.name,
  };

  // Armada extensions ride the bundle's index signature. Copy them only when
  // they are actually well-shaped, so a malformed bundle can't inject garbage.
  const heldRoots = bundle.held_roots;
  if (
    Array.isArray(heldRoots) &&
    heldRoots.every(
      (r) => r && typeof r === "object" &&
        typeof (r as { epoch?: unknown }).epoch === "number" &&
        typeof (r as { key?: unknown }).key === "string"
    )
  ) {
    jm.held_roots = (heldRoots as Array<{ epoch: number; key: string }>).map((r) => ({
      epoch: r.epoch,
      key: r.key,
    }));
  }

  if (typeof bundle.refounder === "string") jm.refounder = bundle.refounder;

  return jm;
}

/**
 * A Community List entry for a freshly redeemed invite.
 *
 * `invite_ref` stores the link in its domain-agnostic bare form so a member
 * stranded on a superseded epoch can re-resolve the same link later and merge
 * the refreshed bundle forward. Re-encoding (rather than keeping the raw hash)
 * canonicalises the fragment.
 */
export function bundleToEntry(
  bundle: InviteBundle,
  link: ParsedInviteLink,
  now: number = Date.now()
): CommunityListEntry {
  const jm = bundleToJoinMaterial(bundle);
  return {
    community_id: bundle.community_id,
    seed: jm,
    current: jm,
    added_at: now,
    invite_ref: `${link.naddr}#${encodeFragment(link.token, link.bootstrapRelays)}`,
  };
}

/**
 * Add an entry to the list, refusing anything that couldn't be published.
 *
 * assertListBounds alone is not enough — it bounds the entry COUNT, but the
 * real constraint is the NIP-44 plaintext cap on the serialized document, and
 * the caller is documented as responsible for checking that too.
 */
export function applyRedemption(
  list: CommunityList,
  entry: CommunityListEntry
): CommunityList {
  const next = addToList(list, entry);

  try {
    assertListBounds(next);
  } catch (err) {
    throw new InviteError(
      "bounds",
      err instanceof Error ? err.message : "Community list is full"
    );
  }

  const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
  if (bytes > MAX_LIST_BYTES) {
    throw new InviteError(
      "bounds",
      `Your community list would be ${bytes} bytes, over the ${MAX_LIST_BYTES} limit. Leave a community first.`
    );
  }

  return next;
}

/** Human-facing copy for each failure, plus whether retrying could help. */
export function describeInviteError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof InviteError) {
    switch (err.code) {
      case "bad-link":
        return { message: "This isn't a Concord invite link.", retryable: false };
      case "bad-fragment":
        return {
          message:
            "This invite link is incomplete — the part after the # is missing. Copy the whole link.",
          retryable: false,
        };
      case "bad-bundle":
        return { message: "This invite couldn't be opened.", retryable: true };
      case "revoked":
        return { message: "This invite has been revoked. Ask for a new one.", retryable: false };
      case "expired":
        return { message: "This invite has expired. Ask for a new one.", retryable: false };
      case "owner-mismatch":
        return {
          message: "This invite failed a security check and was rejected.",
          retryable: false,
        };
      case "bounds":
        return { message: err.message, retryable: false };
    }
  }
  return {
    message: err instanceof Error ? err.message : "Something went wrong.",
    retryable: true,
  };
}
