import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
} from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";
import { base } from "npm:viem/chains";
import { normalizeAddress, normalizeBytes32, rest } from "./pvp.js";

const WAGER_ESCROW_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "winner", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleDraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
  },
];

export function scoreFor(turn) {
  return Number(turn?.result?.score || 0);
}

export function computeFinalScore(turns = [], players = []) {
  const [playerA, playerB] = players;
  let playerAWins = 0;
  let playerBWins = 0;
  for (let round = 1; round <= 4; round += 1) {
    const roundTurns = turns.filter((turn) => Number(turn.round) === round);
    const turnA = roundTurns.find((turn) => turn.player_id === playerA?.player_id);
    const turnB = roundTurns.find((turn) => turn.player_id === playerB?.player_id);
    if (!turnA || !turnB) {
      throw new Error("Wager match is missing final turns.");
    }
    const scoreA = scoreFor(turnA);
    const scoreB = scoreFor(turnB);
    if (scoreA > scoreB) playerAWins += 1;
    else if (scoreB > scoreA) playerBWins += 1;
  }
  return { playerAWins, playerBWins };
}

export async function settleFinishedWagerRoom({
  room,
  players,
  turns,
  allowDraw = false,
} = {}) {
  const wager = room?.setup?.wager || {};
  if (!room?.id || room.status !== "finished" || !wager?.enabled) {
    return null;
  }
  const signerKey = Deno.env.get("PVP_WAGER_RESULT_SIGNER_PRIVATE_KEY") || "";
  const rpcUrl = Deno.env.get("BASE_RPC_URL") || "https://mainnet.base.org";
  if (!/^0x[a-fA-F0-9]{64}$/.test(signerKey)) {
    throw new Error("PVP_WAGER_RESULT_SIGNER_PRIVATE_KEY is not configured.");
  }
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  if (wager.settlementTx) {
    const receipt = await publicClient.getTransactionReceipt({
      hash: wager.settlementTx,
    }).catch(() => null);
    if (receipt?.status === "success") {
      return {
        room,
        settlement: {
          hash: wager.settlementTx,
          result: wager.settlementResult || "settled",
          winner: wager.settlementWinner || "",
        },
      };
    }
  }

  if (!Array.isArray(players) || players.length < 2) {
    throw new Error("Room is missing both players.");
  }
  const matchId = normalizeBytes32(wager.matchId);
  const escrowContract = normalizeAddress(wager.escrowContract);
  if (!matchId || !escrowContract) {
    throw new Error("Wager room is missing escrow details.");
  }

  const { playerAWins, playerBWins } = computeFinalScore(turns || [], players);
  const winner =
    playerAWins > playerBWins
      ? normalizeAddress(players[0].wallet)
      : playerBWins > playerAWins
        ? normalizeAddress(players[1].wallet)
        : "";
  if (!winner && !allowDraw) {
    return {
      skipped: true,
      reason: "draw",
      playerAWins,
      playerBWins,
    };
  }
  if ((playerAWins !== playerBWins) && !winner) {
    throw new Error("Winning player does not have a wallet recorded.");
  }

  const account = privateKeyToAccount(signerKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });
  const functionName = winner ? "settle" : "settleDraw";
  const args = winner ? [matchId, winner] : [matchId];
  const hash = await walletClient.sendTransaction({
    to: escrowContract,
    data: encodeFunctionData({
      abi: WAGER_ESCROW_ABI,
      functionName,
      args,
    }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Wager settlement transaction reverted: ${hash}`);
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
  const [updatedRoom] = await rest(`pvp_rooms?id=eq.${room.id}`, {
    method: "PATCH",
    body: { setup: nextSetup },
  });
  return {
    room: updatedRoom || { ...room, setup: nextSetup },
    settlement: { hash, result: winner ? "winner" : "draw", winner },
  };
}
