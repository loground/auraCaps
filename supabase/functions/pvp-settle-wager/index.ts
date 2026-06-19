import {
  handleCors,
  jsonResponse,
  requirePlayer,
  rest,
} from "../_shared/pvp.js";
import { settleFinishedWagerRoom } from "../_shared/wager-settlement.js";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
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

    const players = await rest(`pvp_room_players?room_id=eq.${roomId}&order=slot.asc`);
    if (!players?.some((entry: any) => entry.player_id === player.playerId) || players.length < 2) {
      throw new Error("Player is not in this wager room.");
    }
    const turns = await rest(`pvp_turns?room_id=eq.${roomId}&order=round.asc`);
    const result = await settleFinishedWagerRoom({
      room,
      players,
      turns,
      allowDraw: true,
    });
    return jsonResponse(result || { room, settlement: null });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not settle wager." }, 400);
  }
});
