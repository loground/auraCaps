import {
  handleCors,
  jsonResponse,
  normalizeRoomCode,
  requirePlayer,
  rest,
} from "../_shared/pvp.js";

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
    const roomCode = normalizeRoomCode(payload.roomCode);
    const roomFilter = roomId
      ? `id=eq.${encodeURIComponent(roomId)}`
      : `code=eq.${encodeURIComponent(roomCode)}`;
    if (!roomId && !roomCode) {
      throw new Error("Room id or room code is required.");
    }

    const rooms = await rest(`pvp_rooms?${roomFilter}&limit=1`);
    const room = rooms?.[0];
    if (!room) {
      throw new Error("Room not found.");
    }

    const players = await rest(`pvp_room_players?room_id=eq.${room.id}&order=slot.asc`);
    const isMember = players.some((entry) => entry.player_id === player.playerId);
    if (!isMember) {
      throw new Error("Player is not in this room.");
    }

    const turns = await rest(`pvp_turns?room_id=eq.${room.id}&order=created_at.asc`);
    return jsonResponse({ room, players, turns });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not load PvP room." }, 400);
  }
});
