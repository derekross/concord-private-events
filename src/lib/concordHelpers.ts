/**
 * Concord community helpers for the Seafood Boil app.
 *
 * Simplified utilities for working with an existing Concord V2 community
 * without the full Armada control plane fold.
 */

import { channelGroupKey } from "@/concord-v2/lib/derive";
import { openWrap, type OpenedEvent } from "@/concord-v2/lib/stream";
import type { CommunityV2, ChannelV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "nostr-tools/pure";

/**
 * Derive the channel view for a community based on held keys.
 * Simplified version of armada's community.ts channelsView.
 */
export function channelsView(community: CommunityV2, channelDefs: ChannelDef[]): ChannelV2[] {
  const out: ChannelV2[] = [];

  for (const def of channelDefs) {
    const id = hexToBytes(def.channelIdHex);
    if (!def.isPrivate) {
      const streams = community.heldRoots.map((r) => ({
        epoch: r.epoch,
        group: channelGroupKey(r.key, id, r.epoch),
      }));
      out.push({
        id,
        idHex: def.channelIdHex,
        name: def.name,
        isPrivate: false,
        voice: { room: streams[0].group, mediaKey: new Uint8Array(32) },
        streams,
        current: streams[0],
      });
      continue;
    }

    const held = community.privateChannels.find((ch) => bytesToHex(ch.id) === def.channelIdHex);
    if (!held) continue;
    const stream = {
      epoch: held.epoch,
      group: channelGroupKey(held.key, id, held.epoch),
    };
    out.push({
      id,
      idHex: def.channelIdHex,
      name: def.name,
      isPrivate: true,
      voice: { room: stream.group, mediaKey: new Uint8Array(32) },
      streams: [stream],
      current: stream,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export interface ChannelDef {
  channelIdHex: string;
  name: string;
  isPrivate: boolean;
}

/**
 * Memo of already-opened wraps, keyed by wrap id. Wraps are immutable relay
 * events, so a wrap that decrypted once decrypts forever — without this, every
 * polling refetch re-runs two NIP-44 decryptions and a Schnorr verify over the
 * channel's entire history. `null` marks wraps that failed to open (not ours /
 * malformed) so they aren't retried on every poll either.
 */
const openedWrapCache = new Map<string, OpenedEvent | null>();
const OPENED_WRAP_CACHE_MAX = 3000;

function cacheOpenedWrap(id: string, value: OpenedEvent | null) {
  if (openedWrapCache.size >= OPENED_WRAP_CACHE_MAX) {
    // Map iterates in insertion order: drop the oldest third.
    const drop = Math.floor(OPENED_WRAP_CACHE_MAX / 3);
    let i = 0;
    for (const key of openedWrapCache.keys()) {
      openedWrapCache.delete(key);
      if (++i >= drop) break;
    }
  }
  openedWrapCache.set(id, value);
}

/** Open all wraps for a channel's stream, returning decoded events. */
export function openChannelWraps(wraps: NostrEvent[], channel: ChannelV2): OpenedEvent[] {
  const out: OpenedEvent[] = [];
  const byPk = new Map(channel.streams.map((s) => [s.group.pk, s]));

  for (const wrap of wraps) {
    const stream = byPk.get(wrap.pubkey);
    if (!stream) continue;

    const cached = openedWrapCache.get(wrap.id);
    if (cached !== undefined) {
      if (cached) out.push(cached);
      continue;
    }

    try {
      const opened = openWrap(wrap, stream.group);
      cacheOpenedWrap(wrap.id, opened);
      out.push(opened);
    } catch {
      // not ours / malformed
      cacheOpenedWrap(wrap.id, null);
    }
  }
  return out;
}

/** Convert hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

/** Convert Uint8Array to hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
