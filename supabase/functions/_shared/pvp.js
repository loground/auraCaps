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
