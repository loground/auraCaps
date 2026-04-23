export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const wallet = String(req.query?.wallet || "").trim();
  const username = String(req.query?.username || "").trim();
  const userId = String(req.query?.userId || "").trim();

  if (!wallet && !username && !userId) {
    res.status(400).json({ error: "Missing wallet, username, or userId query param." });
    return;
  }

  const upstreamUrl = userId
    ? `https://api.auramaxx.gg/api/users/${encodeURIComponent(userId)}`
    : `https://api.auramaxx.gg/api/users/lookup?username=${encodeURIComponent(wallet || username)}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    res.status(upstream.status).json({
      ok: upstream.ok,
      status: upstream.status,
      data,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "Aura upstream request failed.",
      details: String(error?.message || error),
    });
  }
}
