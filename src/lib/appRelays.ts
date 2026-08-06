import type { RelayMetadata } from '@/contexts/AppContext';

/**
 * App default relays. Used as the initial `relayMetadata` for new users and as
 * a fallback when the user has no NIP-65 relay list configured (e.g. during
 * nostrconnect handshakes before any user relays have been loaded).
 */
export const APP_RELAYS: RelayMetadata = {
  relays: [
    { url: 'wss://jskitty.com/nostr', read: true, write: true },
    { url: 'wss://nostr-relay.derekross.me/', read: true, write: true },
    { url: 'wss://nos.lol/', read: true, write: true },
    { url: 'wss://relay.ditto.pub/', read: true, write: true },
    // Concord STOCK_RELAYS (concord-v2/lib/invite.ts) that we'd otherwise miss.
    // An invite minted elsewhere defaults to that dictionary, so without these
    // a community joined from another client resolves but renders empty.
    // NOTE: this only covers communities on the stock set. Communities on their
    // own relays still need per-community relay routing — see the plan's Phase 5.
    { url: 'wss://asia.vectorapp.io/nostr', read: true, write: true },
    { url: 'wss://relay.dreamith.to', read: true, write: true },
  ],
  updatedAt: 0,
};
