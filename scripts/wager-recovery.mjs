import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const ARTIFACT_PATH = path.join(ROOT, "artifacts", "AuraCapsWagerEscrow.json");
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "base-AuraCapsWagerEscrow.json");
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const STATUS_LABELS = ["None", "Created", "Funded", "Settled", "Refunded"];

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

function normalizeBytes32(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(text) ? text : "";
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? getAddress(text) : "";
}

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(key)) return key;
  if (/^[a-fA-F0-9]{64}$/.test(key)) return `0x${key}`;
  return "";
}

function getEscrowAddress() {
  const envAddress = normalizeAddress(process.env.VITE_PVP_WAGER_ESCROW_ADDRESS);
  if (envAddress) return envAddress;
  if (fs.existsSync(DEPLOYMENT_PATH)) {
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    const deployedAddress = normalizeAddress(deployment.address);
    if (deployedAddress) return deployedAddress;
  }
  throw new Error("Missing VITE_PVP_WAGER_ESCROW_ADDRESS.");
}

function getDeployment() {
  return fs.existsSync(DEPLOYMENT_PATH)
    ? JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"))
    : {};
}

function getRpcUrl() {
  return (
    process.env.BASE_RPC_URL ||
    process.env.DEPLOY_RPC_URL ||
    process.env.VITE_BASE_RPC_URL ||
    DEFAULT_BASE_RPC_URL
  );
}

function getSupabaseUrl() {
  const url = String(process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
  if (!url) return "";
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error(
      `VITE_SUPABASE_URL must be the project API URL like https://PROJECT_REF.supabase.co, got ${url}`
    );
  }
  return url;
}

async function supabaseRest(pathname) {
  const url = getSupabaseUrl();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "");
  if (!url || !key) {
    throw new Error("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to look up rooms.");
  }
  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST failed: ${response.status}`);
  }
  return data;
}

async function findRoom(roomRef) {
  const ref = String(roomRef || "").trim();
  if (!ref) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref)) {
    const byId = await supabaseRest(`pvp_rooms?id=eq.${encodeURIComponent(ref)}&limit=1`);
    if (byId?.[0]) return byId[0];
  }
  const code = ref.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!code) return null;
  const byCode = await supabaseRest(`pvp_rooms?code=eq.${encodeURIComponent(code)}&limit=1`);
  return byCode?.[0] || null;
}

async function getDeploymentBlock(publicClient, deployment = {}) {
  if (!deployment.transactionHash) return 0n;
  const receipt = await publicClient
    .getTransactionReceipt({ hash: deployment.transactionHash })
    .catch(() => null);
  return receipt?.blockNumber || 0n;
}

function formatTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  return new Date(value * 1000).toISOString();
}

function getRefundMessage(refundAfter) {
  const now = Math.floor(Date.now() / 1000);
  const unlocksAt = Number(refundAfter || 0);
  if (!unlocksAt) return "unknown";
  if (now >= unlocksAt) return "unlocked now";
  const minutes = Math.ceil((unlocksAt - now) / 60);
  return `locked for about ${minutes} more minute${minutes === 1 ? "" : "s"}`;
}

async function printEscrowState({ publicClient, artifact, escrowAddress, matchId }) {
  const escrow = await publicClient.readContract({
    address: escrowAddress,
    abi: artifact.abi,
    functionName: "escrows",
    args: [matchId],
  });
  const [
    collection,
    playerA,
    playerB,
    tokenA,
    tokenB,
    rarity,
    refundAfter,
    status,
  ] = escrow;
  const statusNumber = Number(status);
  console.log(`Escrow: ${escrowAddress}`);
  console.log(`Match: ${matchId}`);
  console.log(`Status: ${STATUS_LABELS[statusNumber] || statusNumber}`);
  console.log(`Collection: ${collection}`);
  console.log(`Player A: ${playerA}`);
  console.log(`Player B: ${playerB}`);
  console.log(`Token A: ${tokenA.toString()}`);
  console.log(`Token B: ${tokenB.toString()}`);
  console.log(`Rarity: ${rarity.toString()}`);
  console.log(`Refund after: ${formatTime(refundAfter)} (${getRefundMessage(refundAfter)})`);
  return { playerA, playerB, refundAfter, statusNumber };
}

async function listMatchesForPlayer({ publicClient, artifact, escrowAddress, deployment, player }) {
  const fromBlock = await getDeploymentBlock(publicClient, deployment);
  const latestBlock = await publicClient.getBlockNumber();
  const chunkSize = 9_500n;
  const created = [];
  const joined = [];
  for (let start = fromBlock; start <= latestBlock; start += chunkSize + 1n) {
    const end = start + chunkSize > latestBlock ? latestBlock : start + chunkSize;
    const [createdChunk, joinedChunk] = await Promise.all([
      publicClient.getContractEvents({
        address: escrowAddress,
        abi: artifact.abi,
        eventName: "MatchCreated",
        args: { playerA: player },
        fromBlock: start,
        toBlock: end,
      }),
      publicClient.getContractEvents({
        address: escrowAddress,
        abi: artifact.abi,
        eventName: "MatchJoined",
        args: { playerB: player },
        fromBlock: start,
        toBlock: end,
      }),
    ]);
    created.push(...createdChunk);
    joined.push(...joinedChunk);
  }
  const matchIds = [
    ...created.map((event) => event.args.matchId),
    ...joined.map((event) => event.args.matchId),
  ];
  const uniqueMatchIds = [...new Set(matchIds.map((id) => String(id)))];
  if (uniqueMatchIds.length === 0) {
    console.log(`No escrow matches found for ${player}.`);
    return;
  }
  console.log(`Found ${uniqueMatchIds.length} escrow match${uniqueMatchIds.length === 1 ? "" : "es"} for ${player}:`);
  for (const matchId of uniqueMatchIds) {
    console.log("");
    await printEscrowState({ publicClient, artifact, escrowAddress, matchId });
  }
}

async function main() {
  loadDotEnv(ENV_PATH);

  const command = process.argv[2] || "inspect";
  let matchId = normalizeBytes32(getArg("--match-id"));
  const roomRef = String(getArg("--room-id") || getArg("--room-code")).trim();
  const player = normalizeAddress(getArg("--player"));

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const escrowAddress = getEscrowAddress();
  const deployment = getDeployment();
  const publicClient = createPublicClient({
    chain: base,
    transport: http(getRpcUrl()),
  });
  if (!matchId && roomRef) {
    const room = await findRoom(roomRef);
    if (!room) throw new Error("Room not found.");
    matchId = normalizeBytes32(room.setup?.wager?.matchId);
    if (!matchId) throw new Error("Room does not have a wager matchId.");
    console.log(`Room: ${room.id} (${room.code || roomRef})`);
  }
  if (!matchId && player && command === "inspect") {
    await listMatchesForPlayer({ publicClient, artifact, escrowAddress, deployment, player });
    return;
  }
  if (!matchId) {
    throw new Error(
      "Usage: npm run wager:inspect -- --match-id 0x... | --player 0x... or npm run wager:refund -- --match-id 0x..."
    );
  }
  const state = await printEscrowState({ publicClient, artifact, escrowAddress, matchId });

  const role = await publicClient.readContract({
    address: escrowAddress,
    abi: artifact.abi,
    functionName: "RESULT_SIGNER_ROLE",
  });
  const configuredSigner = normalizeAddress(deployment.resultSigner);
  if (configuredSigner) {
    const hasRole = await publicClient.readContract({
      address: escrowAddress,
      abi: artifact.abi,
      functionName: "hasRole",
      args: [role, configuredSigner],
    });
    const balance = await publicClient.getBalance({ address: configuredSigner });
    console.log(`Configured result signer: ${configuredSigner}`);
    console.log(`Signer has role: ${hasRole ? "yes" : "no"}`);
    console.log(`Signer ETH: ${formatEther(balance)}`);
  }

  if (command !== "refund") {
    return;
  }
  if (![1, 2].includes(state.statusNumber)) {
    throw new Error("Refund is only available while escrow status is Created or Funded.");
  }
  if (Number(state.refundAfter || 0) > Math.floor(Date.now() / 1000)) {
    throw new Error("Refund is still locked. Wait until the refundAfter time printed above.");
  }
  const privateKey = normalizePrivateKey(process.env.WAGER_REFUND_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error("Set WAGER_REFUND_PRIVATE_KEY to player A or player B wallet private key before refunding.");
  }
  const account = privateKeyToAccount(privateKey);
  const accountAddress = getAddress(account.address);
  if (![state.playerA, state.playerB].map((value) => getAddress(value)).includes(accountAddress)) {
    throw new Error(`Refund key is ${accountAddress}, but refund must be sent by player A or player B.`);
  }
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(getRpcUrl()),
  });
  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: artifact.abi,
    functionName: "refund",
    args: [matchId],
  });
  console.log(`Refund tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Refund failed in tx ${hash}`);
  }
  console.log("Refund completed.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
