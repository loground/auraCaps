import {
  handleCors,
  jsonResponse,
  normalizeMode,
  requirePlayer,
  rest,
} from "../_shared/pvp.js";

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  crypto.getRandomValues(new Uint8Array(6)).forEach((value) => {
    code += alphabet[value % alphabet.length];
  });
  return code;
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
    const setup = payload.setup || {};
    const mode = normalizeMode(setup.gameMode);
    const roomCode = makeRoomCode();
    const isPrivate = Boolean(payload.isPrivate);

    const [room] = await rest("pvp_rooms", {
      method: "POST",
      body: {
        code: roomCode,
        mode,
        map_id: setup.arenaKey || "classic",
        status: "waiting",
        is_private: isPrivate,
        created_by: player.playerId,
        current_turn: player.playerId,
        setup,
      },
    });

    await rest("pvp_room_players", {
      method: "POST",
      body: {
        room_id: room.id,
        player_id: player.playerId,
        player_name: player.username,
        wallet: player.wallet,
        slot: 1,
        selected_cap: payload.cap || null,
      },
    });

    return jsonResponse({ room });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Could not create PvP room." }, 400);
  }
});
