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
  /** Channel names the app expects to find in the community. */
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

/** Sign-up board item categories. */
export const SIGN_UP_CATEGORIES = [
  "seafood",
  "drinks",
  "sides",
  "supplies",
  "volunteer",
] as const;

export type SignUpCategory = (typeof SIGN_UP_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SignUpCategory, string> = {
  seafood: "🦐 Seafood",
  drinks: "🥤 Drinks",
  sides: "🥗 Sides",
  supplies: "🍽️ Supplies",
  volunteer: "🙋 Volunteer",
};

export const CATEGORY_EMOJI: Record<SignUpCategory, string> = {
  seafood: "🦐",
  drinks: "🥤",
  sides: "🥗",
  supplies: "🍽️",
  volunteer: "🙋",
};
