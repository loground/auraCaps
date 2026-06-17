import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const ARTIFACT_PATH = path.join(ROOT, "artifacts", "AuraCapsWagerEscrow.json");
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function normalizeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function normalizeBytes32(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(text) ? text : "";
}

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(key)) return key;
  if (/^[a-fA-F0-9]{64}$/.test(key)) return `0x${key}`;
  return "";
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name} in .env.local or environment.`);
  return value;
}

async function supabaseRest(pathname, { method = "GET", body } = {}) {
  const url = requireEnv("VITE_SUPABASE_URL").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "");
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY.");
  }
  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST failed: ${response.status}`);
  }
  return data;
}

function scoreFor(turn) {
  return Number(turn?.result?.score || 0);
}

function computeFinalScore(turns, players) {
  const [playerA, playerB] = players;
  let playerAWins = 0;
  let playerBWins = 0;
  for (let round = 1; round <= 4; round += 1) {
    const roundTurns = turns.filter((turn) => Number(turn.round) === round);
    const turnA = roundTurns.find((turn) => turn.player_id === playerA.player_id);
    const turnB = roundTurns.find((turn) => turn.player_id === playerB.player_id);
    if (!turnA || !turnB) {
      throw new Error(`Room is missing both turns for round ${round}.`);
    }
    const scoreA = scoreFor(turnA);
    const scoreB = scoreFor(turnB);
    if (scoreA > scoreB) playerAWins += 1;
    else if (scoreB > scoreA) playerBWins += 1;
  }
  return { playerAWins, playerBWins };
}

async function main() {
  loadDotEnv(ENV_PATH);

  const roomId = String(getArg("--room-id")).trim();
  if (!roomId) {
    throw new Error("Usage: npm run wager:settle -- --room-id <pvp_room_id>");
  }

  const signerKey = normalizePrivateKey(
    process.env.PVP_WAGER_RESULT_SIGNER_PRIVATE_KEY ||
      process.env.ESCROW_RESULT_SIGNER_PRIVATE_KEY ||
      process.env.DEPLOYER_PRIVATE_KEY
  );
  if (!signerKey) {
    throw new Error("Missing PVP_WAGER_RESULT_SIGNER_PRIVATE_KEY in .env.local.");
  }

  const rooms = await supabaseRest(`pvp_rooms?id=eq.${encodeURIComponent(roomId)}&limit=1`);
  const room = rooms?.[0];
  if (!room) throw new Error("Room not found.");
  if (room.status !== "finished") {
    throw new Error(`Room is ${room.status}, not finished.`);
  }

  const wager = room.setup?.wager || {};
  if (!wager.enabled) throw new Error("Room is not a wager room.");
  if (wager.settlementTx && !process.argv.includes("--force")) {
    console.log(`Wager already recorded as settled: ${wager.settlementTx}`);
    return;
  }

  const escrowAddress = normalizeAddress(wager.escrowContract || process.env.VITE_PVP_WAGER_ESCROW_ADDRESS);
  const matchId = normalizeBytes32(wager.matchId);
  if (!escrowAddress || !matchId) {
    throw new Error("Room is missing wager escrowContract or matchId.");
  }

  const players = await supabaseRest(`pvp_room_players?room_id=eq.${encodeURIComponent(roomId)}&order=slot.asc`);
  if (!Array.isArray(players) || players.length < 2) {
    throw new Error("Room is missing both players.");
  }
  const turns = await supabaseRest(`pvp_turns?room_id=eq.${encodeURIComponent(roomId)}&order=round.asc`);
  const { playerAWins, playerBWins } = computeFinalScore(turns || [], players);
  const winner =
    playerAWins > playerBWins
      ? normalizeAddress(players[0].wallet)
      : playerBWins > playerAWins
        ? normalizeAddress(players[1].wallet)
        : "";
  if (playerAWins !== playerBWins && !winner) {
    throw new Error("Winning player does not have a wallet saved in pvp_room_players.");
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const account = privateKeyToAccount(signerKey);
  const rpcUrl =
    process.env.BASE_RPC_URL ||
    process.env.DEPLOY_RPC_URL ||
    process.env.VITE_BASE_RPC_URL ||
    DEFAULT_BASE_RPC_URL;
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  const functionName = winner ? "settle" : "settleDraw";
  const args = winner ? [matchId, winner] : [matchId];

  console.log(`Room: ${roomId}`);
  console.log(`Score: player A ${playerAWins}, player B ${playerBWins}`);
  console.log(`Escrow: ${escrowAddress}`);
  console.log(`Match: ${matchId}`);
  console.log(winner ? `Winner wallet: ${winner}` : "Result: draw, returning both caps");

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: artifact.abi,
    functionName,
    args,
  });
  console.log(`Settlement tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Settlement failed in tx ${hash}`);
  }

  const nextSetup = {
    ...room.setup,
    wager: {
      ...wager,
      settlementTx: hash,
      settlementResult: winner ? "winner" : "draw",
      settlementWinner: winner,
    },
  };
  await supabaseRest(`pvp_rooms?id=eq.${encodeURIComponent(roomId)}`, {
    method: "PATCH",
    body: { setup: nextSetup },
  });
  console.log("Supabase room settlement metadata updated.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
