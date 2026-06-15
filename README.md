# AURA CAPS

AURA CAPS is a browser-based 3D cap-battle game built with Three.js, Rapier physics, and Supabase-backed PvP rooms.

## Features

- 3D themed main menu with Hell, Heaven, Jungle Bay, and Bankr themes
- Classic cap duel and Slammer battle modes
- Training and AI match flows
- Local free-cap collection with animated sprite cap support
- Animated sprite cap support
- Dormant Supabase PvP implementation reserved for a future wallet-gated release

## Tech Stack

- Vite
- Three.js
- Rapier 3D
- Supabase JS

## Getting Started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the local URL printed by Vite.

## Environment Variables

Create `.env.local` with:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_WALLETCONNECT_PROJECT_ID=
```

Create the WalletConnect project ID in the Reown dashboard. WalletConnect lets
users connect Phantom and other supported wallets, while the app restricts
sessions to Base Mainnet. The Supabase values support the currently hidden PvP
implementation.

## Useful Scripts

```bash
npm run dev
npm run build
npm run preview
```

## Supabase

PvP Edge Functions live in `supabase/functions`. Deploy them after configuring a Supabase project:

```bash
supabase functions deploy pvp-create-room --no-verify-jwt
supabase functions deploy pvp-join-room --no-verify-jwt
supabase functions deploy pvp-get-room --no-verify-jwt
supabase functions deploy pvp-list-rooms --no-verify-jwt
supabase functions deploy pvp-submit-turn --no-verify-jwt
```

Database migrations live in `supabase/migrations`.

## Assets

Large game assets are served from `public/` and referenced by path at runtime.
