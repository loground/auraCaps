# AURA CAPS

AURA CAPS is a browser-based 3D cap-battle game built with Three.js, Rapier physics, Aura login/profile data, and Supabase-backed PvP rooms.

## Features

- 3D themed main menu with Hell, Heaven, Jungle Bay, and Bankr themes
- Classic cap duel and Slammer battle modes
- Training, AI, and PvP match flows
- Aura login, profile, and inventory-backed cap collection
- Animated sprite cap support
- Supabase Edge Functions for PvP room creation, joining, listing, and turn submission

## Tech Stack

- Vite
- Three.js
- Rapier 3D
- Supabase JS
- Aura profile and inventory API proxy routes

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
VITE_AURA_CLIENT_ID=
```

The Supabase values enable PvP rooms. `VITE_AURA_CLIENT_ID` enables Login with Aura.

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

## Debugging Aura Data

Aura diagnostics are stored in `window.__AURA_LOGS__`. To also print them to the console:

```js
localStorage.setItem("aura_debug", "1")
```

Set it back to `"0"` or remove the key to quiet console output.

## Assets

Large game assets are served from `public/` and referenced by path at runtime.
