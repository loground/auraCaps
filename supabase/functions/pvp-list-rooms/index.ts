import {
  handleCors,
  jsonResponse,
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

    const payload = await req.json().catch(() => ({}));
    requirePlayer(payload.player);

    const rooms = await rest(
      "pvp_rooms?status=eq.waiting&is_private=eq.false&order=created_at.desc&limit=20"
    );
    const roomIds = rooms.map((room) => room.id);
    const players =
      roomIds.length > 0
        ? await rest(`pvp_room_players?room_id=in.(${roomIds.join(",")})&order=slot.asc`)
        : [];

    const roomsWithPlayers = rooms.map((room) => ({
      ...room,
      players: players
        .filter((player) => player.room_id === room.id)
        .map((player) => ({
          slot: player.slot,
          player_name: player.player_name,
        })),
    }));

    return jsonResponse({ rooms: roomsWithPlayers });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not list PvP rooms." }, 400);
  }
});
