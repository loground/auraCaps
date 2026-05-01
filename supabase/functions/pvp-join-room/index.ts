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
    const roomCode = normalizeRoomCode(payload.roomCode);
    if (!roomCode) {
      throw new Error("Room code is required.");
    }

    const rooms = await rest(`pvp_rooms?code=eq.${encodeURIComponent(roomCode)}&limit=1`);
    const room = rooms?.[0];
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.status !== "waiting") {
      throw new Error("Room is not waiting for players.");
    }

    const players = await rest(`pvp_room_players?room_id=eq.${room.id}&order=slot.asc`);
    const existing = players.find((entry) => entry.player_id === player.playerId);
    if (existing) {
      return jsonResponse({ room, player: existing });
    }
    if (players.length >= 2) {
      throw new Error("Room is full.");
    }

    const [joinedPlayer] = await rest("pvp_room_players", {
      method: "POST",
      body: {
        room_id: room.id,
        player_id: player.playerId,
        player_name: player.username,
        wallet: player.wallet,
        slot: 2,
        selected_cap: payload.cap || null,
      },
    });

    const [updatedRoom] = await rest(`pvp_rooms?id=eq.${room.id}`, {
      method: "PATCH",
      body: {
        status: "ready",
      },
    });

    return jsonResponse({ room: updatedRoom || room, player: joinedPlayer });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not join PvP room." }, 400);
  }
});
