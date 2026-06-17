import { createPublicClient, encodeFunctionData, http } from "viem";
import { base } from "viem/chains";
import { BASE_RPC_URL, isRpcRateLimitError, wait } from "../base-rpc.js";
import { getWalletSession } from "../wallet-access.jsx";

const WAGER_ESCROW_ABI = [
  {
    type: "function",
    name: "createMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "refundAfter", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "joinMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
  },
];
const ERC721_APPROVAL_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getApproved",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

async function readContractWithRetry(args, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await publicClient.readContract(args);
    } catch (error) {
      lastError = error;
      if (!isRpcRateLimitError(error) || attempt === attempts - 1) {
        throw error;
      }
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function requireWallet(action) {
  const session = getWalletSession();
  if (session?.mode !== "wallet" || !session.address || !session.provider?.request) {
    throw new Error(`Connect your wallet on Base before ${action}.`);
  }
  return session;
}

function requireCap(cap) {
  const tokenId = String(cap?.tokenId || "").trim();
  const collectionAddress = String(cap?.contractAddress || "").trim();
  if (!tokenId || !collectionAddress) {
    throw new Error("Choose a wallet cap with token ID and collection metadata.");
  }
  return { tokenId: BigInt(tokenId), collectionAddress };
}

function makeMatchId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function sendEscrowTransaction({ escrowAddress, functionName, args }) {
  const session = requireWallet("wagering a cap");
  const hash = await session.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: session.address,
        to: escrowAddress,
        data: encodeFunctionData({ abi: WAGER_ESCROW_ABI, functionName, args }),
      },
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

async function ensureCapApproved({ escrowAddress, collectionAddress, tokenId }) {
  const session = requireWallet("approving a wager cap");
  const [approvedAddress, approvedForAll] = await Promise.all([
    readContractWithRetry({
      address: collectionAddress,
      abi: ERC721_APPROVAL_ABI,
      functionName: "getApproved",
      args: [tokenId],
    }),
    readContractWithRetry({
      address: collectionAddress,
      abi: ERC721_APPROVAL_ABI,
      functionName: "isApprovedForAll",
      args: [session.address, escrowAddress],
    }),
  ]);

  if (approvedForAll || String(approvedAddress).toLowerCase() === escrowAddress.toLowerCase()) {
    return null;
  }

  const hash = await session.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: session.address,
        to: collectionAddress,
        data: encodeFunctionData({
          abi: ERC721_APPROVAL_ABI,
          functionName: "approve",
          args: [escrowAddress, tokenId],
        }),
      },
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function createWagerEscrow({
  escrowAddress,
  cap,
  refundSeconds = 45 * 60,
}) {
  const { tokenId, collectionAddress } = requireCap(cap);
  const matchId = makeMatchId();
  const refundAfter = BigInt(Math.floor(Date.now() / 1000) + refundSeconds);
  const approval = await ensureCapApproved({ escrowAddress, collectionAddress, tokenId });
  const { hash, receipt } = await sendEscrowTransaction({
    escrowAddress,
    functionName: "createMatch",
    args: [matchId, collectionAddress, tokenId, refundAfter],
  });
  return { matchId, approvalTxHash: approval?.hash || "", txHash: hash, receipt };
}

export async function joinWagerEscrow({ escrowAddress, matchId, cap }) {
  if (!matchId) {
    throw new Error("Wager room is missing an escrow match id.");
  }
  const { tokenId, collectionAddress } = requireCap(cap);
  const approval = await ensureCapApproved({ escrowAddress, collectionAddress, tokenId });
  const { hash, receipt } = await sendEscrowTransaction({
    escrowAddress,
    functionName: "joinMatch",
    args: [matchId, tokenId],
  });
  return { matchId, approvalTxHash: approval?.hash || "", txHash: hash, receipt };
}

export async function refundWagerEscrow({ escrowAddress, matchId }) {
  if (!matchId) {
    throw new Error("Wager room is missing an escrow match id.");
  }
  const { hash, receipt } = await sendEscrowTransaction({
    escrowAddress,
    functionName: "refund",
    args: [matchId],
  });
  return { matchId, txHash: hash, receipt };
}
