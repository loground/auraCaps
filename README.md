# AURA CAPS

AURA CAPS is a browser-based 3D cap-battle game built with Three.js, Rapier physics, and Supabase-backed PvP rooms.

## Features

- 3D themed main menu with Hell, Heaven, Jungle Bay, and Bankr themes
- Classic cap duel and Slammer battle modes
- Training, AI, and PvP room match flows
- Optional wager PvP rooms for wallet caps of matching rarity
- Local free-cap collection with animated sprite cap support
- Animated sprite cap support
- Supabase-backed PvP rooms with public/private room support

## Tech Stack

- Vite
- wagmi + RainbowKit
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
VITE_BASE_RPC_URL=
VITE_VIBE_MARKET_API_KEY=
VITE_PVP_WAGER_ESCROW_ADDRESS=
```

Create the WalletConnect project ID in the Reown dashboard. RainbowKit presents
Phantom first in its recommended wallet list, and wagmi restricts sessions to
Base Mainnet. The Supabase values power PvP room creation, joining, realtime
updates, and turn submission.

`VITE_BASE_RPC_URL` should be a Base Mainnet HTTPS RPC URL from a provider such
as Alchemy, QuickNode, Infura, Ankr, or Coinbase Developer Platform. The public
`https://mainnet.base.org` fallback is fine for light local testing but can rate
limit production users. In Vercel, set it for Production and Preview, then
redeploy because Vite embeds `VITE_*` values at build time.

`VITE_PVP_WAGER_ESCROW_ADDRESS` enables Wager PvP in the game setup. Leave it
empty until the escrow contract is deployed and audited.

Create a free vibe.market API key:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "description": "AURA CAPS",
    "email": "YOUR_EMAIL"
  }' \
  https://build.vibechain.com/apikey/create
```

Put the returned key in `VITE_VIBE_MARKET_API_KEY`. The app sends it to the
vibe.market API using the documented `API-KEY` request header.

Because Vite exposes all `VITE_*` variables to browser code, this setup is
appropriate for development only. Production deployments should keep the key
server-side and proxy vibe.market API requests through a backend.

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

## Wager PvP Escrow

Wager PvP must not rely on Supabase custody. The intended flow is:

1. Both players connect wallets on Base and pick opened vibe.market caps.
2. Player A approves the escrow contract, creates an escrow match, and transfers
   their selected ERC-721 cap to the escrow contract.
3. Player B approves the escrow contract and can only join by escrowing a cap
   from the same collection with the same on-chain rarity.
4. Supabase coordinates the match and records turns, but does not hold assets.
5. A backend result signer settles the escrow to the winner after the match.
6. Either player can refund after the escrow timeout if the match never settles.

The reference contract is in `contracts/AuraCapsWagerEscrow.sol`. Treat it as a
starting point for audit and deployment, not production-ready custody code. The
production backend should verify escrow events before starting wager matches and
call `settle` from a protected result signer after the final round.

Compile the escrow contract:

```bash
npm run contracts:compile
```

Deploy it to Base after creating and funding a dedicated deployer wallet:

```bash
# .env.local
DEPLOYER_PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY
ESCROW_ADMIN_ADDRESS=0xYOUR_ADMIN_WALLET
ESCROW_RESULT_SIGNER_ADDRESS=0xYOUR_BACKEND_SETTLEMENT_WALLET
```

```bash
npm run contracts:deploy:base
```

The deploy script prints the escrow contract address, saves a deployment JSON in
`deployments/`, and updates `VITE_PVP_WAGER_ESCROW_ADDRESS` in `.env.local`.
Use `npm run contracts:deploy:base-sepolia` first if you want a testnet dress
rehearsal.

## Assets

Large game assets are served from `public/` and referenced by path at runtime.
