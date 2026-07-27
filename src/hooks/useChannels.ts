/**
 * useChannels — derive channel objects from the community + control plane.
 *
 * Returns a map of channel-name → ChannelV2 so the app can find channels
 * by their configured names (event-info, sign-up, chat).
 */

import { useMemo } from "react";

import { channelsView as channelsViewLib } from "@/concord-v2/lib/community";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";
import type { FoldedControl } from "@/concord-v2/lib/control";
import { EVENT_CONFIG } from "@/lib/eventConfig";

export interface ChannelsResult {
  /** All channels the member can read. */
  channels: ChannelV2[];
  /** Map of channel-name → ChannelV2 for quick lookup. */
  channelsByName: Map<string, ChannelV2>;
  /** Convenience: specific channels from eventConfig. */
  eventInfoChannel: ChannelV2 | undefined;
  signUpChannel: ChannelV2 | undefined;
  chatChannel: ChannelV2 | undefined;
  /** The general channel (fallback for event info). */
  generalChannel: ChannelV2 | undefined;
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
        generalChannel: undefined,
      };
    }

    const channels = channelsViewLib(community, folded ?? undefined);
    const channelsByName = new Map<string, ChannelV2>();
    for (const ch of channels) {
      channelsByName.set(ch.name, ch);
    }

    const eventInfoChannel = channelsByName.get(EVENT_CONFIG.channels.eventInfo) ?? channelsByName.get("general");
    const signUpChannel = channelsByName.get(EVENT_CONFIG.channels.signUp);
    const chatChannel = channelsByName.get(EVENT_CONFIG.channels.chat) ?? channelsByName.get("general");
    const generalChannel = channelsByName.get("general");

    return {
      channels,
      channelsByName,
      eventInfoChannel,
      signUpChannel,
      chatChannel,
      generalChannel,
    };
  }, [community, folded]);
}
