/**
 * useChannels — derive channel objects from the community + control plane.
 *
 * One channel can carry everything the app does: kinds distinguish chat
 * messages (9), calendar events (31922/31923), RSVPs (31925), and sign-up
 * items (31800) — channels are only organizational. So a community needs NO
 * channel setup: every app slot falls back to the "general" channel (the
 * default every Armada community has). Priority per slot: its dedicated
 * configured name → "general" → the chat channel → the first channel, so
 * communities that still have dedicated event-info / sign-up channels keep
 * working unchanged.
 */

import { useMemo } from "react";

import { channelsView as channelsViewLib } from "@/concord-v2/lib/community";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";
import type { FoldedControl } from "@/concord-v2/lib/control";
import { CHANNEL_PREFERENCES } from "@/lib/eventConfig";

export interface ChannelsResult {
  /** All channels the member can read. */
  channels: ChannelV2[];
  /** Map of channel-name → ChannelV2 for quick lookup. */
  channelsByName: Map<string, ChannelV2>;
  /** Event details channel: `eventInfo` if it exists, else the chat channel. */
  eventInfoChannel: ChannelV2 | undefined;
  /** Sign-up channel: `signUp` if it exists, else the chat channel. */
  signUpChannel: ChannelV2 | undefined;
  /** Chat channel (configured name, else "general", else the first channel). */
  chatChannel: ChannelV2 | undefined;
}

export function useChannels(
  community: CommunityV2 | null | undefined,
  folded: FoldedControl | null | undefined,
): ChannelsResult {
  return useMemo(() => {
    if (!community) {
      return {
        channels: [],
        channelsByName: new Map(),
        eventInfoChannel: undefined,
        signUpChannel: undefined,
        chatChannel: undefined,
      };
    }

    const channels = channelsViewLib(community, folded ?? undefined);
    // Case-insensitive name lookup — Armada display names may be capitalized
    // ("General", "Chat"), while our config keys are lowercase.
    const channelsByName = new Map<string, ChannelV2>();
    for (const ch of channels) {
      channelsByName.set(ch.name.toLowerCase(), ch);
    }
    const byName = (name: string) => channelsByName.get(name.toLowerCase());

    const generalChannel = byName("general");
    const chatChannel =
      byName(CHANNEL_PREFERENCES.chat) ?? generalChannel ?? channels[0];
    const eventInfoChannel =
      byName(CHANNEL_PREFERENCES.eventInfo) ?? generalChannel ?? chatChannel;
    const signUpChannel =
      byName(CHANNEL_PREFERENCES.signUp) ?? generalChannel ?? chatChannel;

    return {
      channels,
      channelsByName,
      eventInfoChannel,
      signUpChannel,
      chatChannel,
    };
  }, [community, folded]);
}
