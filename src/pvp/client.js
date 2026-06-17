import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "";
let supabaseClient = null;
const pvpChannels = new Map();

export function isPvpConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getPvpConfigStatus() {
  if (isPvpConfigured()) {
    return "ready";
  }
  return "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable PvP rooms.";
}

function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

async function callPvpFunction(name, payload) {
  if (!isPvpConfigured()) {
    throw new Error(getPvpConfigStatus());
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `PvP request failed: ${response.status}`);
  }
  return body;
}

export function getSupabasePvpClient() {
  if (!isPvpConfigured()) {
    return null;
  }
  supabaseClient ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return supabaseClient;
}

export function getPlayerIdentity(identity) {
  return {
    playerId: identity?.playerId || "",
    username: identity?.username || "Player",
    walletAddress: identity?.walletAddress || "",
  };
}

export async function createPvpRoom({ playerIdentity, setup, capSelection }) {
  return callPvpFunction("pvp-create-room", {
    player: getPlayerIdentity(playerIdentity),
    setup,
    cap: capSelection?.playerCapMeta || null,
    isPrivate: Boolean(setup?.isPrivate),
  });
}

export async function joinPvpRoom({ playerIdentity, roomCode, capSelection }) {
  return callPvpFunction("pvp-join-room", {
    roomCode: normalizeRoomCode(roomCode),
    player: getPlayerIdentity(playerIdentity),
    cap: capSelection?.playerCapMeta || null,
  });
}

export async function getPvpRoom({ playerIdentity, roomId, roomCode }) {
  return callPvpFunction("pvp-get-room", {
    roomId,
    roomCode: normalizeRoomCode(roomCode),
    player: getPlayerIdentity(playerIdentity),
  });
}

export async function listPvpRooms({ playerIdentity }) {
  return callPvpFunction("pvp-list-rooms", {
    player: getPlayerIdentity(playerIdentity),
  });
}

export async function submitPvpTurnResult({ playerIdentity, roomId, turn }) {
  return callPvpFunction("pvp-submit-turn", {
    roomId,
    player: getPlayerIdentity(playerIdentity),
    turn,
  });
}

export function subscribePvpRoom({ roomId, onChange, onAim, onTurnSubmitted }) {
  const client = getSupabasePvpClient();
  if (!client || !roomId) {
    return () => {};
  }
  const channel = client
    .channel(`pvp-room-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pvp_rooms",
        filter: `id=eq.${roomId}`,
      },
      onChange
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pvp_turns",
        filter: `room_id=eq.${roomId}`,
      },
      onChange
    )
    .on("broadcast", { event: "aim" }, (event) => {
      onAim?.(event.payload);
    })
    .on("broadcast", { event: "turn-submitted" }, (event) => {
      onTurnSubmitted?.(event.payload);
    })
    .subscribe();
  pvpChannels.set(roomId, channel);

  return () => {
    pvpChannels.delete(roomId);
    client.removeChannel(channel);
  };
}

export function sendPvpAim({ roomId, aim }) {
  const client = getSupabasePvpClient();
  if (!client || !roomId) {
    return;
  }
  const channel = pvpChannels.get(roomId);
  if (!channel) {
    return;
  }
  channel.send({
    type: "broadcast",
    event: "aim",
    payload: aim,
  });
}

export function sendPvpTurnSubmitted({ roomId, turn }) {
  const client = getSupabasePvpClient();
  if (!client || !roomId) {
    return;
  }
  const channel = pvpChannels.get(roomId);
  if (!channel) {
    return;
  }
  channel.send({
    type: "broadcast",
    event: "turn-submitted",
    payload: turn,
  });
}
