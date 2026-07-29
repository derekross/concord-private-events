/**
 * Concord Private Events — deployment configuration.
 *
 * This app is a private-event companion for ONE Concord V2 community:
 * event details, a sign-up board, and encrypted group chat. Point it at
 * your own community by filling in communityId / communityOwner / relays
 * below (create the community in Armada, then paste the values here).
 *
 * name/emoji/subtitle are only the FALLBACK branding (landing page and
 * loading states) — once the control plane loads, the community's own
 * name, icon, banner, and description take over.
 */

export interface EventConfig {
  name: string;
  emoji: string;
  subtitle: string;
  /** The Concord V2 community identifier (hex). Empty until Derek sets it. */
  communityId: string;
  /** The community owner's x-only pubkey (hex). Empty until set. */
  communityOwner: string;
  /** Relays to query for community events. */
  relays: string[];
  /** Preferred channel names. NO channel setup is required — every app
   *  feature (chat, events, RSVPs, sign-up board) works inside a single
   *  "general" channel, since kinds distinguish the content. Dedicated
   *  channels with these names take priority when they exist. */
  channels: {
    eventInfo: string;
    signUp: string;
    chat: string;
  };
}

export const EVENT_CONFIG: EventConfig = {
  name: "Concord Private Events",
  emoji: "🎉",
  subtitle: "Plan your gathering, together",
  // Community created in Armada: https://armada.buzz/c/abb8a4b895bc4d023d3aec8d367b5c6acd58ee7593a6716c130e13728d9ed89e
  communityId: "abb8a4b895bc4d023d3aec8d367b5c6acd58ee7593a6716c130e13728d9ed89e",
  // Owner: Derek Ross (npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424)
  communityOwner: "3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24",
  relays: [
    "wss://nostr-relay.derekross.me",
    "wss://nos.lol",
    "wss://relay.ditto.pub",
  ],
  channels: {
    eventInfo: "event-info",
    signUp: "sign-up",
    chat: "chat",
  },
};

/**
 * Sign-up board ships with NO default categories — this is a generic events
 * app, so users create their own (with an emoji) from the Add Item section.
 * The legacy maps below exist only so boards that already have items in
 * these categories keep rendering nicely.
 */
export const SIGN_UP_CATEGORIES: readonly string[] = [];

export type SignUpCategory = string;

export const CATEGORY_LABELS: Record<string, string> = {
  seafood: "🦐 Seafood",
  drinks: "🥤 Drinks",
  sides: "🥗 Sides",
  supplies: "🍽️ Supplies",
  volunteer: "🙋 Volunteer",
};

export const CATEGORY_EMOJI: Record<string, string> = {
  seafood: "🦐",
  drinks: "🥤",
  sides: "🥗",
  supplies: "🍽️",
  volunteer: "🙋",
};
