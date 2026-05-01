import {
  handleCors,
  jsonResponse,
  requirePlayer,
  rest,
} from "../_shared/pvp.js";

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

    const players = await rest(`pvp_room_players?room_id=eq.${roomId}&player_id=eq.${encodeURIComponent(player.playerId)}&limit=1`);
    if (!players?.[0]) {
      throw new Error("Player is not in this room.");
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

    return jsonResponse({ turn: savedTurn });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not submit PvP turn." }, 400);
  }
});
