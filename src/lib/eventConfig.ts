/**
 * Event configuration for the Ross Seafood Boil.
 *
 * The communityId and relays will be set after Derek creates the community
 * in Armada/Vector. The app reads from this config to know which community
 * to join and display.
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
  name: "Ross Seafood Boil",
  emoji: "🦐",
  subtitle: "Annual family gathering",
  // These will be set after Derek creates the community
  communityId: "",
  communityOwner: "",
  relays: ["wss://relay.ditto.pub", "wss://relay.primal.net"],
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
