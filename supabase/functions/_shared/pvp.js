export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function handleCors(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
    },
  });
}

export function getSupabaseEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url, serviceRoleKey };
}

export async function rest(path, { method = "GET", body } = {}) {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST failed: ${response.status}`);
  }
  return data;
}

export function requirePlayer(player) {
  const playerId = String(player?.playerId || "").trim();
  if (!playerId) {
    throw new Error("A local player identity is required for PvP.");
  }
  return {
    playerId,
    username: String(player?.username || "Player").trim(),
    walletAddress: normalizeAddress(player?.walletAddress),
  };
}

export function normalizeMode(value) {
  return value === "slammer" ? "slammer" : "classic";
}

export function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function normalizeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

export function normalizeRarity(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeWager(setup = {}, cap = null) {
  const wager = setup?.wager || {};
  if (!wager?.enabled) {
    return { enabled: false };
  }
  const rarity = normalizeRarity(wager.rarity || cap?.rarity);
  const collectionAddress = normalizeAddress(wager.collectionAddress || cap?.contractAddress);
  const escrowContract = normalizeAddress(wager.escrowContract);
  return {
    enabled: true,
    rarity,
    collectionAddress,
    escrowContract,
    matchId: normalizeBytes32(wager.matchId),
    creatorApprovalTx: normalizeTxHash(wager.creatorApprovalTx),
    creatorDepositTx: normalizeTxHash(wager.creatorDepositTx),
  };
}

export function requireWagerCap({ player, cap, wager }) {
  if (!wager?.enabled) {
    return;
  }
  if (!player.walletAddress) {
    throw new Error("Connect a wallet before entering wager PvP.");
  }
  if (!wager.escrowContract || !wager.matchId) {
    throw new Error("Wager PvP requires a funded escrow match.");
  }
  const capTokenId = String(cap?.tokenId || "").trim();
  const capRarity = normalizeRarity(cap?.rarity);
  const capCollection = normalizeAddress(cap?.contractAddress);
  if (!capTokenId || !capRarity || !capCollection) {
    throw new Error("Wager PvP requires a wallet cap with token id, rarity, and collection metadata.");
  }
  if (wager.rarity && capRarity !== wager.rarity) {
    throw new Error("Wager cap rarity must match the room wager rarity.");
  }
  if (wager.collectionAddress && capCollection !== wager.collectionAddress) {
    throw new Error("Wager cap collection must match the room wager collection.");
  }
  if (wager.matchId && cap?.wagerMatchId && normalizeBytes32(cap.wagerMatchId) !== wager.matchId) {
    throw new Error("Wager cap escrow match does not match this room.");
  }
}

export function normalizeBytes32(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(text) ? text : "";
}

export function normalizeTxHash(value) {
  return normalizeBytes32(value);
}
