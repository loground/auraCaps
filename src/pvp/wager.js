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
const ESCROW_REVERT_REASONS = {
  "0x29ac473e": "Escrow match was not found.",
  "0x0e8a471c": "Connect one of the wallets that escrowed a cap for this match.",
  "0xc1ab6dc1": "This cap cannot be used for this escrow match.",
  "0x27d7b920": "Both wager caps must have matching on-chain rarity.",
  "0xf525e320": "This escrow match cannot be refunded from its current state.",
  "0x0a516555": "Refund is locked until the escrow timeout passes.",
};

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

function getReadableEscrowError(error) {
  let text = `${error?.shortMessage || ""} ${error?.message || ""} ${String(error || "")}`;
  try {
    text += ` ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
  } catch {
    // Some wallet errors contain cyclic provider objects.
  }
  for (const [selector, message] of Object.entries(ESCROW_REVERT_REASONS)) {
    if (text.includes(selector)) {
      return message;
    }
  }
  return error?.shortMessage || error?.message || "Escrow transaction failed.";
}

async function sendEscrowTransaction({ escrowAddress, functionName, args }) {
  const session = requireWallet("wagering a cap");
  try {
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
    if (receipt?.status !== "success") {
      throw new Error(`Escrow transaction failed in tx ${hash}.`);
    }
    return { hash, receipt };
  } catch (error) {
    throw new Error(getReadableEscrowError(error));
  }
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
  if (receipt?.status !== "success") {
    throw new Error(`Approval transaction failed in tx ${hash}.`);
  }
  return { hash, receipt };
}

export async function createWagerEscrow({
  escrowAddress,
  cap,
  refundSeconds = 60,
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
  return {
    matchId,
    approvalTxHash: approval?.hash || "",
    txHash: hash,
    receipt,
    refundAfter: refundAfter.toString(),
  };
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
