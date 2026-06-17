import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
} from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";
import { base } from "npm:viem/chains";
import {
  handleCors,
  jsonResponse,
  requirePlayer,
  rest,
} from "../_shared/pvp.js";

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
] as const;

function normalizeAddress(value: unknown) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function normalizeBytes32(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(text) ? text : "";
}

function scoreFor(turn: any) {
  return Number(turn?.result?.score || 0);
}

function computeFinalScore(turns: any[], players: any[]) {
  const [playerA, playerB] = players;
  let playerAWins = 0;
  let playerBWins = 0;
  for (let round = 1; round <= 4; round += 1) {
    const roundTurns = turns.filter((turn) => Number(turn.round) === round);
    const turnA = roundTurns.find((turn) => turn.player_id === playerA.player_id);
    const turnB = roundTurns.find((turn) => turn.player_id === playerB.player_id);
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

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const signerKey = Deno.env.get("PVP_WAGER_RESULT_SIGNER_PRIVATE_KEY") || "";
    const rpcUrl = Deno.env.get("BASE_RPC_URL") || "https://mainnet.base.org";
    if (!/^0x[a-fA-F0-9]{64}$/.test(signerKey)) {
      throw new Error("PVP_WAGER_RESULT_SIGNER_PRIVATE_KEY is not configured.");
    }

    const payload = await req.json();
    const player = requirePlayer(payload.player);
    const roomId = String(payload.roomId || "").trim();
    if (!roomId) {
      throw new Error("Room id is required.");
    }

    const rooms = await rest(`pvp_rooms?id=eq.${roomId}&limit=1`);
    const room = rooms?.[0];
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.status !== "finished") {
      throw new Error("Wager can only settle after the match is finished.");
    }

    const wager = room.setup?.wager || {};
    if (!wager?.enabled) {
      throw new Error("Room is not a wager match.");
    }
    if (wager.settlementTx) {
      return jsonResponse({
        room,
        settlement: {
          hash: wager.settlementTx,
          result: wager.settlementResult || "settled",
          winner: wager.settlementWinner || "",
        },
      });
    }
    const matchId = normalizeBytes32(wager.matchId);
    const escrowContract = normalizeAddress(wager.escrowContract);
    if (!matchId || !escrowContract) {
      throw new Error("Wager room is missing escrow details.");
    }

    const players = await rest(`pvp_room_players?room_id=eq.${roomId}&order=slot.asc`);
    if (!players?.some((entry: any) => entry.player_id === player.playerId) || players.length < 2) {
      throw new Error("Player is not in this wager room.");
    }
    const turns = await rest(`pvp_turns?room_id=eq.${roomId}&order=round.asc`);
    const { playerAWins, playerBWins } = computeFinalScore(turns || [], players);
    const winner =
      playerAWins > playerBWins
        ? normalizeAddress(players[0].wallet)
        : playerBWins > playerAWins
          ? normalizeAddress(players[1].wallet)
          : "";
    if ((playerAWins !== playerBWins) && !winner) {
      throw new Error("Winning player does not have a wallet recorded.");
    }

    const account = privateKeyToAccount(signerKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(rpcUrl),
    });
    const functionName = winner ? "settle" : "settleDraw";
    const args = winner ? [matchId, winner] : [matchId];
    const hash = await walletClient.sendTransaction({
      to: escrowContract as `0x${string}`,
      data: encodeFunctionData({
        abi: WAGER_ESCROW_ABI,
        functionName,
        args: args as any,
      }),
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const nextSetup = {
      ...room.setup,
      wager: {
        ...wager,
        settlementTx: hash,
        settlementResult: winner ? "winner" : "draw",
        settlementWinner: winner,
      },
    };
    const [updatedRoom] = await rest(`pvp_rooms?id=eq.${roomId}`, {
      method: "PATCH",
      body: { setup: nextSetup },
    });

    return jsonResponse({
      room: updatedRoom || { ...room, setup: nextSetup },
      settlement: { hash, result: winner ? "winner" : "draw", winner },
    });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not settle wager." }, 400);
  }
});
