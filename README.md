# 🎉 Concord Private Events

A private-event companion app for **any Concord V2 community** — event details,
a potluck-style sign-up board, and end-to-end encrypted group chat, packaged as
an installable mobile-first PWA. Sign in with Nostr (NIP-07 extension, nsec, or
remote signer), pick one of your communities, and everything you see lives
inside that community's encrypted channels.

The app is community-branded, not self-branded: once the control plane loads,
the community's own **name, icon, banner, and description** take over the
header and hero.

## Features

- **Any community** — sign in and pick from the communities you belong to.
  Nothing is hardcoded: community identity, ownership and keys all come from
  your encrypted Community List and the control-plane fold. Each community has
  its own URL (`/c/<id>`) and its own sign-up categories.
- **Join in-app** — paste an invite link and the app fetches the invite bundle,
  verifies it (revoked / expired / tampered invites are refused), previews the
  community, and writes the membership to your Community List. No second client
  required.
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
- **Sign-Up** — add/claim/unclaim/delete items. No default categories: each
  board grows its own **custom categories with an emoji picker**, so it fits
  any kind of gathering. Claims show the claimer's profile name, and deletes
  confirm in a styled dialog.
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

## Using it with your community

There is nothing to configure. The app is not tied to a community — sign in,
and it reads the communities you already belong to from your encrypted
Community List (kind 13302).

1. **Sign in** with Nostr (NIP-07 extension, nsec, or a remote signer).
2. **Pick a community.** If you're in exactly one you go straight in;
   otherwise you get a picker. The URL is `/c/<community-id>`, so a community
   can be linked or bookmarked directly.
3. **Or paste an invite link** on the landing page. The app fetches the invite
   bundle, shows you what you'd be joining, and on confirm writes the
   membership into your own Community List — no other client needed.

Communities themselves are created in [Armada](https://armada.buzz), which is
also where you set the name, icon, banner and description; this app reads them
from the control plane (encrypted images are decrypted client-side).

**No channel setup is needed.** Everything — chat, NIP-52 events + RSVPs, and
the sign-up board — works inside a single `general` channel, because event
kinds distinguish the content. If you prefer dedicated channels, name them
`event-info`, `sign-up` and `chat` and they'll be used instead.

The **community owner** (as recorded in the community itself, not in any app
config) gets the in-app event-details editor. Event details are read only from
the owner's messages, so a member cannot inject a payment handle or date into
the event cards.

### Deploying

Build and serve `dist/` from any static host. The app uses client-side routing,
so the host must fall back to `index.html` for unknown paths — otherwise
`/c/<id>` and `/invite/<naddr>` 404 on a fresh load. `npm run build` also
writes `dist/404.html` for hosts that use that convention.

### Relays

Queries go to the app's default relay set (`src/lib/appRelays.ts`) unioned
with the community's own relays from your membership material, so a community
hosted on private relays still resolves.

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
├── hooks/              # data hooks (memberships, chat, board, control plane, live sub)
├── lib/                # app config, invite redemption, parsers, payments, helpers
├── pages/              # Landing (picker), AppPage (3 tabs), InviteLanding (join)
└── components/         # ui/ (shadcn), auth/, chat/, providers
public/
├── manifest.webmanifest, sw.js   # PWA
└── icons/                        # generated brand icons (Twemoji, CC-BY 4.0)
```
