/**
 * Concord V2 core types — trimmed for Seafood Boil app.
 * Based on armada/src/concord-v2/lib/types.ts with git-activity deps removed.
 */

import type { GroupKey } from "./derive";

/** Protocol recommendation for a community's relay set (CORD-02 §6). */
export const MAX_COMMUNITY_RELAYS = 5;

/** Community/channel/role name cap: 64 bytes of UTF-8 (CORD-02 §6). */
export const NAME_MAX_BYTES = 64;
/** Community description cap: 10,000 bytes of UTF-8 (CORD-02 §6). */
export const DESCRIPTION_MAX_BYTES = 10_000;
/** Hostile-bundle bound: reject an invite carrying more channels than this (CORD-05 §1). */
export const MAX_BUNDLE_CHANNELS = 256;
/** The Community List caps at 50 memberships (CORD-02 §8). */
export const MAX_LIST_MEMBERSHIPS = 50;

/** Dedupe (order-preserving) + truncate a relay set to the recommended cap. */
export function capRelays(relays: string[], cap = MAX_COMMUNITY_RELAYS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of relays) {
    if (out.length >= cap) break;
    if (typeof r === "string" && r && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** Byte length of a string as UTF-8. */
export function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** An encrypted-blob pointer (icon / banner). */
export interface ImagePointer {
  url: string;
  key: string;
  nonce: string;
  hash: string;
}

export function isImagePointer(v: unknown): v is ImagePointer {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.url === "string" &&
    typeof o.key === "string" &&
    typeof o.nonce === "string" &&
    typeof o.hash === "string"
  );
}

/** Community metadata — the vsk=0 Control Plane entity's content (CORD-02 §6). */
export interface CommunityMetadata {
  name: string;
  description?: string;
  relays: string[];
  icon?: ImagePointer;
  banner?: ImagePointer;
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Channel metadata — the vsk=2 Control Plane entity's content (CORD-03 §2). */
export interface ChannelMetadata {
  name: string;
  private: boolean;
  deleted?: boolean;
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A private Channel's independent key material, as delivered by an invite. */
export interface PrivateChannelKey {
  id: Uint8Array;
  key: Uint8Array;
  epoch: bigint;
  name: string;
}

/** A held root-key epoch (the current one plus retained priors for history). */
export interface HeldRoot {
  epoch: bigint;
  key: Uint8Array;
}

/** A Concord V2 community as the client holds it. */
export interface CommunityV2 {
  id: Uint8Array;
  idHex: string;
  owner: string;
  ownerSalt: Uint8Array;
  root: Uint8Array;
  rootEpoch: bigint;
  heldRoots: HeldRoot[];
  privateChannels: PrivateChannelKey[];
  relays: string[];
  name: string;
  refounder?: string;
}

/** A Channel's call coordinates (CORD-07 §1). */
export interface VoiceKeys {
  room: GroupKey;
  mediaKey: Uint8Array;
}

/** One channel as the UI consumes it: folded definition + derived stream keys. */
export interface ChannelV2 {
  id: Uint8Array;
  idHex: string;
  name: string;
  isPrivate: boolean;
  voice: VoiceKeys;
  streams: Array<{ epoch: bigint; group: GroupKey }>;
  current: { epoch: bigint; group: GroupKey };
}
