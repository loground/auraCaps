import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const ROOT = process.cwd();
const CONTRACT_NAME = "AuraCapsWagerEscrow";
const ARTIFACT_PATH = path.join(ROOT, "artifacts", `${CONTRACT_NAME}.json`);
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");
const ENV_PATH = path.join(ROOT, ".env.local");

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

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(key)) return key;
  if (/^[a-fA-F0-9]{64}$/.test(key)) return `0x${key}`;
  return "";
}

function normalizeAddress(value) {
  const address = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address : "";
}

function updateEnvAddress(address) {
  const key = "VITE_PVP_WAGER_ESCROW_ADDRESS";
  const line = `${key}=${address}`;
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const next = current.match(new RegExp(`^${key}=.*$`, "m"))
    ? current.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.writeFileSync(ENV_PATH, next);
}

loadDotEnv(ENV_PATH);

const network = getArg("--network", "base");
const chain = network === "base-sepolia" ? baseSepolia : base;
const defaultRpcUrl =
  network === "base-sepolia" ? "https://sepolia.base.org" : "https://mainnet.base.org";
const rpcUrl = process.env.BASE_RPC_URL || process.env.DEPLOY_RPC_URL || defaultRpcUrl;
const privateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);

if (!privateKey) {
  console.error("Missing DEPLOYER_PRIVATE_KEY in .env.local.");
  console.error("Create a dedicated deployer wallet, fund it with ETH for gas, then add:");
  console.error("DEPLOYER_PRIVATE_KEY=0x...");
  process.exit(1);
}

if (!fs.existsSync(ARTIFACT_PATH)) {
  execFileSync("node", ["scripts/compile-escrow.mjs"], { stdio: "inherit" });
}

const account = privateKeyToAccount(privateKey);
const admin = normalizeAddress(process.env.ESCROW_ADMIN_ADDRESS) || account.address;
const resultSigner = normalizeAddress(process.env.ESCROW_RESULT_SIGNER_ADDRESS) || admin;
const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

console.log(`Deploying ${CONTRACT_NAME} to ${chain.name}`);
console.log(`Deployer: ${account.address}`);
console.log(`Admin: ${admin}`);
console.log(`Result signer: ${resultSigner}`);
if (resultSigner === admin) {
  console.warn("Warning: ESCROW_RESULT_SIGNER_ADDRESS is not set, using admin as result signer.");
}

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [admin, resultSigner],
});

console.log(`Deployment tx: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Deployment failed in tx ${hash}`);
}

const deployment = {
  contractName: CONTRACT_NAME,
  network,
  chainId: chain.id,
  address: receipt.contractAddress,
  transactionHash: hash,
  deployer: account.address,
  admin,
  resultSigner,
  deployedAt: new Date().toISOString(),
};

fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
const deploymentPath = path.join(DEPLOYMENTS_DIR, `${network}-${CONTRACT_NAME}.json`);
fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
updateEnvAddress(receipt.contractAddress);

console.log(`Escrow contract deployed: ${receipt.contractAddress}`);
console.log(`Deployment saved: ${deploymentPath}`);
console.log(`Updated .env.local with VITE_PVP_WAGER_ESCROW_ADDRESS=${receipt.contractAddress}`);
