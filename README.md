# 🎉 Concord Private Events

A private-event companion app for **one Concord V2 community** — event details,
a potluck-style sign-up board, and end-to-end encrypted group chat, packaged as
an installable mobile-first PWA. Members log in with Nostr (NIP-07 extension,
nsec, or remote signer); everything they see lives inside the community's
encrypted channels.

The app is community-branded, not self-branded: once the control plane loads,
the community's own **name, icon, banner, and description** take over the
header and hero.

## Features

- **Details** — the host posts and edits event info in-app (date, time,
  location, one suggested contribution amount, payment handles). Guests see
  unified gradient cards:
  - *When* with a device-aware **Add to Calendar** picker (Apple Calendar via
    `.ics` on iOS/macOS, Google Calendar elsewhere)
  - *Where* with a live OpenStreetMap preview and an **Open in Maps** picker
    (Apple Maps on Apple devices, Google Maps otherwise)
  - *Chip In* with tappable payment rows — Cash App and Venmo universal links,
    and **Lightning** taps that resolve LNURL-pay into a ready BOLT-11 invoice
    with the host's USD amount converted to sats in the background
  - *Sats ⇄ USD* converter card (Coinbase spot, 60s refresh)
- **Sign-Up** — add/claim/unclaim/delete items across built-in categories
  (seafood, drinks, sides, supplies, volunteer) plus **custom categories with
  an emoji picker**, so the board fits any kind of gathering. Claims show the
  claimer's profile name.
- **Chat** — encrypted group chat with image attachments, an in-app image
  viewer, edit/delete support, "Sending…" and "(edited)" indicators, and a
  deep link to continue in **Armada** (the full Concord client).
- **Live feel** — a streaming wrap subscription lands new messages in the UI
  in under a second; optimistic sends/edits/deletes never flicker; background
  polls only reconcile.
- **PWA** — installable (manifest + icons + service worker offline shell),
  full-bleed mobile layout, bottom app-style nav, safe-area aware, no
  pull-to-refresh.

## Quick Start

```bash
npm install
npm run dev      # Development (port 8080)
npm test         # typecheck + lint + unit tests + production build
npm run build    # Production build → dist/
```

## Setup: point it at your community

1. **Create the community** in [Armada](https://armada.buzz) with three
   channels: `event-info`, `sign-up`, `chat`.
2. Copy the **community ID** (hex) and your **owner pubkey** (hex) into
   `src/lib/eventConfig.ts`:

   ```typescript
   export const EVENT_CONFIG: EventConfig = {
     name: "Concord Private Events",   // fallback branding (landing/loading)
     emoji: "🎉",
     subtitle: "Plan your gathering, together",
     communityId: "<COMMUNITY_ID_HEX>",
     communityOwner: "<OWNER_PUBKEY_HEX>",
     relays: ["wss://your.relay", "wss://nos.lol", "wss://relay.ditto.pub"],
     channels: { eventInfo: "event-info", signUp: "sign-up", chat: "chat" },
   };
   ```

   Set the community's name/banner/icon/description in Armada — the app reads
   them from the control plane (encrypted images are decrypted client-side).
3. **Deploy** the `dist/` folder to any static host (Surge, Netlify, Pages…).
4. **Invite guests** with Armada invite links; they paste the link on the
   landing page. The owner (`communityOwner`) gets the in-app details editor.

## How it works

- **Concord V2** (`src/concord-v2/`) — the protocol library ported from
  Armada: HKDF key derivation, NIP-44 gift-wrap streams (kind 1059 wraps →
  kind 20013/20014 seals → unsigned rumors), the control-plane fold
  (channels, metadata, roles), invites, and encrypted community images.
- **Data hooks** (`src/hooks/`) — TanStack Query over the relay pool:
  `useChannelChat` (chat + event-info, with kind-3302 edit honoring),
  `useSignUpBoard` (kind 31800 items with claim/edit/delete), plus
  `useLiveChannelEvents`, a single streaming subscription that pushes new
  wraps into the query caches the moment relays see them.
- **Latency design** — sub-second `eoseTimeout`, optimistic mutations keyed
  by the real rumor id, opened-wrap decryption memoization, and
  force-mounted tabs so switching is instant.

## Project Structure

```
src/
├── concord-v2/lib/     # Concord V2 protocol library (wire format)
├── hooks/              # data hooks (chat, board, control plane, live sub)
├── lib/                # eventConfig, parsers, payments, categories, helpers
├── pages/              # Landing, AppPage (3 tabs), InviteLanding
└── components/         # ui/ (shadcn), auth/, chat/, providers
public/
├── manifest.webmanifest, sw.js   # PWA
└── icons/                        # generated brand icons (Twemoji, CC-BY 4.0)
```
