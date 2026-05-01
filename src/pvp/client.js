const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "";

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

export function getAuraPlayerIdentity(auraSession) {
  const user = auraSession?.user || {};
  const walletAddress =
    auraSession?.walletAddress ||
    user.walletAddress ||
    user.wallet ||
    user.address ||
    "";
  const username =
    user.username ||
    user.name ||
    user.displayName ||
    (walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Aura Player");
  const auraUserId = user.id || user._id || user.userId || "";
  return {
    auraUserId,
    walletAddress,
    username,
    avatarUrl: user.avatar || user.avatarUrl || user.image || "",
  };
}

export async function createPvpRoom({ auraSession, setup, capSelection }) {
  return callPvpFunction("pvp-create-room", {
    player: getAuraPlayerIdentity(auraSession),
    setup,
    cap: capSelection?.playerCapMeta || null,
  });
}

export async function joinPvpRoom({ auraSession, roomCode, capSelection }) {
  return callPvpFunction("pvp-join-room", {
    roomCode: normalizeRoomCode(roomCode),
    player: getAuraPlayerIdentity(auraSession),
    cap: capSelection?.playerCapMeta || null,
  });
}

export async function getPvpRoom({ auraSession, roomId, roomCode }) {
  return callPvpFunction("pvp-get-room", {
    roomId,
    roomCode: normalizeRoomCode(roomCode),
    player: getAuraPlayerIdentity(auraSession),
  });
}

export async function submitPvpTurnResult({ auraSession, roomId, turn }) {
  return callPvpFunction("pvp-submit-turn", {
    roomId,
    player: getAuraPlayerIdentity(auraSession),
    turn,
  });
}
