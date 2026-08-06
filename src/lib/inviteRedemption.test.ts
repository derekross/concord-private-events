/**
 * Invite redemption — full in-process round trip.
 *
 * Everything needed to mint a real invite is exported, so these tests build a
 * genuine bundle event, parse it back, and follow it all the way into a
 * rehydrated community. No network, no mocks.
 *
 * The point is the field mapping between InviteBundle and JoinMaterial: a
 * dropped key here doesn't throw, it produces a membership that silently can't
 * decrypt anything later.
 */

import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  buildBundleEvent,
  buildRevocationEvent,
  encodeFragment,
  InviteError,
  mintLinkSigner,
  mintToken,
  parseBundleEvent,
  parseInviteLink,
  type InviteBundle,
  type ParsedInviteLink,
} from "@/concord-v2/lib/invite";
import { communityIdOf } from "@/concord-v2/lib/derive";
import {
  EMPTY_COMMUNITY_LIST,
  isLive,
  rehydrateCommunity,
} from "@/concord-v2/lib/communityList";
import {
  applyRedemption,
  bundleToEntry,
  bundleToJoinMaterial,
} from "@/lib/inviteRedemption";

/** A self-consistent community: community_id == H(owner || owner_salt). */
function makeCommunity() {
  const ownerSk = generateSecretKey();
  const ownerPk = getPublicKey(ownerSk);
  const ownerSalt = crypto.getRandomValues(new Uint8Array(32));
  const ownerXonly = hexToBytes(ownerPk);
  const communityId = communityIdOf(ownerXonly, ownerSalt);
  return {
    ownerPk,
    ownerSaltHex: bytesToHex(ownerSalt),
    communityIdHex: bytesToHex(communityId),
  };
}

function makeBundle(over: Partial<InviteBundle> = {}): InviteBundle {
  const c = makeCommunity();
  return {
    community_id: c.communityIdHex,
    owner: c.ownerPk,
    owner_salt: c.ownerSaltHex,
    community_root: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    root_epoch: 1,
    channels: [
      {
        id: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        key: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        epoch: 1,
        name: "general",
      },
    ],
    relays: ["wss://relay.example.com"],
    name: "Test Community",
    held_roots: [{ epoch: 1, key: bytesToHex(crypto.getRandomValues(new Uint8Array(32))) }],
    // Link-only fields — these must NOT survive into the membership entry.
    icon: { url: "https://example.com/i.png", key: "00".repeat(32), nonce: "00".repeat(12) } as never,
    creator_npub: "npub1example",
    label: "spring invite",
    ...over,
  };
}

function mintInvite(bundle: InviteBundle) {
  const { sk, pk } = mintLinkSigner();
  const token = mintToken();
  const event = buildBundleEvent(bundle, token, sk);
  const link: ParsedInviteLink = {
    linkSigner: pk,
    token,
    bootstrapRelays: ["wss://relay.example.com"],
    naddr: "naddr1test",
  };
  return { sk, pk, token, event, link };
}

describe("invite round trip", () => {
  it("survives mint -> parse -> entry -> rehydrate with keys intact", () => {
    const bundle = makeBundle();
    const { pk, token, event, link } = mintInvite(bundle);

    const parsed = parseBundleEvent(event, pk, token, Date.now());
    expect(parsed.community_id).toBe(bundle.community_id);

    const entry = bundleToEntry(parsed, link);
    const list = applyRedemption(EMPTY_COMMUNITY_LIST, entry);
    expect(isLive(list, bundle.community_id)).toBe(true);

    const community = rehydrateCommunity(entry);
    expect(community).toBeDefined();
    expect(community!.idHex.toLowerCase()).toBe(bundle.community_id.toLowerCase());
    expect(community!.owner.toLowerCase()).toBe(bundle.owner.toLowerCase());
    // The granted private channel must carry through, or chat silently breaks.
    expect(community!.privateChannels?.length ?? 0).toBe(1);
  });

  it("records a re-resolvable invite_ref", () => {
    const bundle = makeBundle();
    const { token, link } = mintInvite(bundle);
    const entry = bundleToEntry(bundle, link);
    expect(entry.invite_ref).toBe(
      `${link.naddr}#${encodeFragment(token, link.bootstrapRelays)}`
    );
  });
});

describe("bundleToJoinMaterial", () => {
  it("carries every membership field", () => {
    const bundle = makeBundle();
    const jm = bundleToJoinMaterial(bundle);
    expect(jm.community_id).toBe(bundle.community_id);
    expect(jm.owner).toBe(bundle.owner);
    expect(jm.owner_salt).toBe(bundle.owner_salt);
    expect(jm.community_root).toBe(bundle.community_root);
    expect(jm.root_epoch).toBe(bundle.root_epoch);
    expect(jm.channels).toEqual(bundle.channels);
    expect(jm.relays).toEqual(bundle.relays);
    expect(jm.name).toBe(bundle.name);
    expect(jm.held_roots).toEqual(bundle.held_roots);
  });

  it("drops link-only fields", () => {
    const jm = bundleToJoinMaterial(makeBundle()) as Record<string, unknown>;
    expect(jm.icon).toBeUndefined();
    expect(jm.creator_npub).toBeUndefined();
    expect(jm.label).toBeUndefined();
    expect(jm.expires_at).toBeUndefined();
  });

  it("ignores malformed held_roots rather than copying garbage", () => {
    const jm = bundleToJoinMaterial(makeBundle({ held_roots: ["nope"] as never }));
    expect(jm.held_roots).toBeUndefined();
  });
});

describe("security properties", () => {
  it("rejects a revoked invite", () => {
    const { sk, pk, token } = mintInvite(makeBundle());
    const revocation = buildRevocationEvent(sk);
    expect(() => parseBundleEvent(revocation, pk, token, Date.now())).toThrow(InviteError);
    try {
      parseBundleEvent(revocation, pk, token, Date.now());
    } catch (e) {
      expect((e as InviteError).code).toBe("revoked");
    }
  });

  it("rejects an expired invite", () => {
    const bundle = makeBundle({ expires_at: Date.now() - 60_000 });
    const { pk, token, event } = mintInvite(bundle);
    try {
      parseBundleEvent(event, pk, token, Date.now());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as InviteError).code).toBe("expired");
    }
  });

  it("rejects a bundle whose owner was tampered with", () => {
    // community_id no longer equals H(owner || salt).
    const bundle = makeBundle({ owner: getPublicKey(generateSecretKey()) });
    const { pk, token, event } = mintInvite(bundle);
    try {
      parseBundleEvent(event, pk, token, Date.now());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as InviteError).code).toBe("owner-mismatch");
    }
  });

  it("rejects a bundle from a different link signer", () => {
    const { token, event } = mintInvite(makeBundle());
    const impostor = mintLinkSigner().pk;
    expect(() => parseBundleEvent(event, impostor, token, Date.now())).toThrow(InviteError);
  });
});

describe("applyRedemption", () => {
  it("refuses once the list would exceed the byte cap", () => {
    let list = EMPTY_COMMUNITY_LIST;
    expect(() => {
      // Each entry carries channels/roots, so this trips the cap well before
      // any theoretical entry-count limit.
      for (let i = 0; i < 60; i++) {
        const bundle = makeBundle({
          channels: Array.from({ length: 40 }, (_, n) => ({
            id: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
            key: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
            epoch: 1,
            name: `channel-${n}`,
          })),
        });
        const { link } = mintInvite(bundle);
        list = applyRedemption(list, bundleToEntry(bundle, link));
      }
    }).toThrow(InviteError);
  });

  it("keeps existing memberships when adding a new one", () => {
    const a = makeBundle();
    const b = makeBundle();
    let list = applyRedemption(EMPTY_COMMUNITY_LIST, bundleToEntry(a, mintInvite(a).link));
    list = applyRedemption(list, bundleToEntry(b, mintInvite(b).link));
    expect(isLive(list, a.community_id)).toBe(true);
    expect(isLive(list, b.community_id)).toBe(true);
  });
});

describe("parseInviteLink", () => {
  it("rejects a bare link whose coordinate is malformed", () => {
    // Correct shape (`<naddr>#<fragment>`) but "naddr1test" is not a decodable
    // naddr — a well-formed fragment must not rescue a bad coordinate.
    const { token, link } = mintInvite(makeBundle());
    const bare = `${link.naddr}#${encodeFragment(token, link.bootstrapRelays)}`;
    expect(parseInviteLink(bare)).toBeUndefined();
  });

  it("rejects junk", () => {
    expect(parseInviteLink("https://example.com/nope")).toBeUndefined();
    expect(parseInviteLink("")).toBeUndefined();
  });
});
