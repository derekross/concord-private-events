# 🦐 Ross Seafood Boil

A private event website for the Annual Ross Seafood Boil, built on Nostr + Concord V2.

## Quick Start

```bash
npm install
npm run dev      # Development
npm run build    # Production build → dist/
```

## Setup

### 1. Create the Community (Derek)
1. Open **Armada** or **Vector** on your phone
2. Create a new community named "Ross Seafood Boil"
3. Create three channels: `event-info`, `sign-up`, `chat`
4. Copy the **community ID** (hex) and your **owner pubkey**

### 2. Configure the App
Edit `src/lib/eventConfig.ts`:
```typescript
export const EVENT_CONFIG = {
  name: "Ross Seafood Boil",
  emoji: "🦐",
  subtitle: "Annual family gathering",
  communityId: "<PASTE_COMMUNITY_ID_HEX>",
  communityOwner: "<PASTE_OWNER_PUBKEY_HEX>",
  relays: ["wss://relay.ditto.pub", "wss://relay.primal.net"],
  channels: { eventInfo: "event-info", signUp: "sign-up", chat: "chat" },
};
```

### 3. Deploy
```bash
npm run build
cd dist && surge . seafood-boil.surge.sh
```

### 4. Invite Family
From Armada/Vector, create invite links and share them with family members.
They paste the link at the landing page to join.

## Architecture

- **Template**: MKStack (React + Vite + TailwindCSS + shadcn/ui)
- **Nostr**: @nostrify/react for NIP-07 login, relay pooling, TanStack Query
- **Concord V2**: Full crypto library (derive, stream, invite, kinds) for encrypted community channels
- **Sign-Up Items**: Custom kind 31800 inside encrypted channels, with kind 3302 edits for claim/unclaim

## What Works

- ✅ Landing page with NIP-07 login
- ✅ Auth gate (community membership check via kind 13302)
- ✅ Three-tab app shell (Details, Sign-Up, Chat)
- ✅ Sign-up board with add/claim/unclaim
- ✅ Group chat with encrypted Concord channels
- ✅ Invite link route at `/invite/:naddr`
- ✅ Warm beachy theme
- ✅ Mobile-first design
- ✅ TypeScript clean, Vite build passes

## What Needs Attention

- **Community creation**: Derek needs to create the Concord V2 community and fill in the config
- **Channel wiring**: The `useChannelChat` and `useSignUpBoard` hooks accept a `ChannelV2` — when the community config is filled in, create a provider that derives channels from the community + control plane
- **Control Plane fold**: For full membership/role checking, port `control.ts` + `community.ts` from Armada (they need the roles + edition infrastructure)
- **Invite processing**: The `/invite/:naddr` route currently validates the link format; full processing needs to fetch the bundle from relays, decrypt, and store membership
- **Event details**: Should read from the `event-info` channel once wired

## Project Structure

```
src/
├── concord-v2/lib/     # Concord V2 protocol library
│   ├── derive.ts       # Key derivation (HKDF, group keys)
│   ├── stream.ts       # Private stream encrypt/decrypt (NIP-44 wraps)
│   ├── invite.ts       # CORD-05 invite links and bundles
│   ├── kinds.ts        # Event kind registry
│   ├── types.ts        # Core types (CommunityV2, ChannelV2, etc.)
│   ├── edition.ts      # Control Plane edition machinery
│   ├── version.ts      # Version chain folding
│   └── roles.ts        # Role/permission system
├── hooks/
│   ├── useCommunityMembership.ts  # Check kind 13302 membership
│   ├── useChannelChat.ts          # Read/send chat messages
│   └── useSignUpBoard.ts          # CRUD sign-up items
├── lib/
│   ├── eventConfig.ts             # Community configuration
│   ├── signUpModel.ts             # Sign-up data model
│   └── concordHelpers.ts          # Channel view utilities
├── pages/
│   ├── Landing.tsx                # Public landing + login
│   ├── AppPage.tsx                # Main app (3 tabs)
│   └── InviteLanding.tsx          # Invite processing
└── AppRouter.tsx                  # Routes
```
