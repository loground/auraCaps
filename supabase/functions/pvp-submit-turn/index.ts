import {
  handleCors,
  jsonResponse,
  requirePlayer,
  rest,
} from "../_shared/pvp.js";
import { settleFinishedWagerRoom } from "../_shared/wager-settlement.js";

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const payload = await req.json();
    const player = requirePlayer(payload.player);
    const turn = payload.turn || {};
    const roomId = String(payload.roomId || "").trim();
    if (!roomId) {
      throw new Error("Room id is required.");
    }

    const rooms = await rest(`pvp_rooms?id=eq.${roomId}&limit=1`);
    const room = rooms?.[0];
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.status !== "playing") {
      throw new Error("Room is not currently playing.");
    }
    if (room.current_turn && room.current_turn !== player.playerId) {
      throw new Error("It is not your turn.");
    }

    const roomPlayers = await rest(`pvp_room_players?room_id=eq.${roomId}&order=slot.asc`);
    const currentPlayer = roomPlayers.find((entry) => entry.player_id === player.playerId);
    if (!currentPlayer) {
      throw new Error("Player is not in this room.");
    }
    if (roomPlayers.length < 2) {
      throw new Error("Waiting for opponent.");
    }

    const throwInput = turn.throwInput || {};
    const safeThrowInput = {
      x: clampNumber(throwInput.x, -20, 20),
      z: clampNumber(throwInput.z, -20, 20),
      height: clampNumber(throwInput.height, 1, 12, 4),
      power: clampNumber(throwInput.power, 0, 100),
    };

    const result = turn.result || {};
    const safeResult = {
      outcome: ["win", "lose", "tie"].includes(result.outcome) ? result.outcome : "tie",
      score: clampNumber(result.score, 0, room.mode === "slammer" ? 6 : 2),
      landed: Boolean(result.landed),
      outOfBounds: Boolean(result.outOfBounds),
    };

    const round = Math.max(1, Math.min(4, Number(turn.round || room.current_round || 1)));
    const existingTurns = await rest(
      `pvp_turns?room_id=eq.${roomId}&round=eq.${round}&player_id=eq.${encodeURIComponent(player.playerId)}&limit=1`
    );
    if (existingTurns?.length > 0) {
      throw new Error("Turn already submitted for this round.");
    }
    const [savedTurn] = await rest("pvp_turns", {
      method: "POST",
      body: {
        room_id: roomId,
        player_id: player.playerId,
        round,
        turn_index: Number(turn.turnIndex || 1),
        mode: room.mode,
        throw_input: safeThrowInput,
        result: safeResult,
        client_proof: turn.clientProof || {},
      },
    });

    const roundTurns = await rest(`pvp_turns?room_id=eq.${roomId}&round=eq.${round}`);
    const nextPlayer = roomPlayers.find((entry) => entry.player_id !== player.playerId);
    let roomPatch = {};
    if (roundTurns.length >= 2) {
      roomPatch =
        round >= 4
          ? { status: "finished", current_turn: null }
          : { current_round: round + 1, current_turn: roomPlayers[0].player_id };
    } else {
      roomPatch = { current_turn: nextPlayer?.player_id || null };
    }
    const [updatedRoom] = await rest(`pvp_rooms?id=eq.${roomId}`, {
      method: "PATCH",
      body: roomPatch,
    });
    let settledRoom = updatedRoom || room;
    let settlement = null;
    if (
      roomPatch.status === "finished" &&
      settledRoom?.setup?.wager?.enabled &&
      !settledRoom?.setup?.wager?.settlementTx
    ) {
      try {
        const allTurns = await rest(`pvp_turns?room_id=eq.${roomId}&order=round.asc`);
        const settlementResult = await settleFinishedWagerRoom({
          room: settledRoom,
          players: roomPlayers,
          turns: allTurns || [],
          allowDraw: false,
        });
        if (settlementResult?.room) {
          settledRoom = settlementResult.room;
        }
        settlement = settlementResult?.settlement || null;
      } catch (settlementError) {
        const nextSetup = {
          ...settledRoom.setup,
          wager: {
            ...(settledRoom.setup?.wager || {}),
            settlementError:
              settlementError?.message || "Automatic wager settlement failed.",
            settlementErrorAt: new Date().toISOString(),
          },
        };
        const [roomWithSettlementError] = await rest(`pvp_rooms?id=eq.${roomId}`, {
          method: "PATCH",
          body: { setup: nextSetup },
        });
        settledRoom = roomWithSettlementError || { ...settledRoom, setup: nextSetup };
      }
    }

    return jsonResponse({ turn: savedTurn, room: settledRoom, settlement });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not submit PvP turn." }, 400);
  }
});
