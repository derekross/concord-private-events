/**
 * Concord V2 community assembly — CORD-03 channelsView.
 * Copied from Armada's community.ts (genesis/classifier omitted).
 */

import {
  bytesToHex,
  channelGroupKey,
  hex32,
  voiceGroupKey,
  voiceMediaKey,
} from "@/concord-v2/lib/derive";
import type { FoldedControl } from "@/concord-v2/lib/control";
import type { ChannelV2, CommunityV2, VoiceKeys } from "@/concord-v2/lib/types";

/**
 * Assemble the channels the member can actually read from the Control fold +
 * held keys.
 */
export function channelsView(community: CommunityV2, folded: FoldedControl | undefined): ChannelV2[] {
  const out: ChannelV2[] = [];
  const seen = new Set<string>();

  const privateKeysById = new Map(community.privateChannels.map((ch) => [bytesToHex(ch.id), ch]));

  const voiceKeys = (secret: Uint8Array, id: Uint8Array, epoch: bigint): VoiceKeys => ({
    room: voiceGroupKey(secret, id, epoch),
    mediaKey: voiceMediaKey(secret, id, epoch),
  });

  for (const def of folded?.channels.values() ?? []) {
    if (def.deleted) continue;
    seen.add(def.channelIdHex);
    const id = hex32(def.channelIdHex);

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
        voice: voiceKeys(community.root, id, community.rootEpoch),
        streams,
        current: streams[0],
      });
      continue;
    }

    const held = privateKeysById.get(def.channelIdHex);
    if (!held) continue;
    const stream = { epoch: held.epoch, group: channelGroupKey(held.key, id, held.epoch) };
    out.push({
      id,
      idHex: def.channelIdHex,
      name: def.name,
      isPrivate: true,
      voice: voiceKeys(held.key, id, held.epoch),
      streams: [stream],
      current: stream,
    });
  }

  // Private channels held but not yet folded
  for (const held of community.privateChannels) {
    const idHex = bytesToHex(held.id);
    if (seen.has(idHex)) continue;
    const stream = { epoch: held.epoch, group: channelGroupKey(held.key, held.id, held.epoch) };
    out.push({
      id: held.id,
      idHex,
      name: held.name || idHex.slice(0, 8),
      isPrivate: true,
      voice: voiceKeys(held.key, held.id, held.epoch),
      streams: [stream],
      current: stream,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
