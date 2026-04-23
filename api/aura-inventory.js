export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const userId = String(req.query?.userId || "").trim();
  if (!userId) {
    res.status(400).json({ ok: false, error: "Missing userId query param." });
    return;
  }

  const params = new URLSearchParams({
    condensed: String(req.query?.condensed ?? "true"),
    ownedOnly: String(req.query?.ownedOnly ?? "true"),
    packType: String(req.query?.packType ?? "all"),
    limit: String(req.query?.limit ?? "200"),
    page: String(req.query?.page ?? "1"),
  });
  if (req.query?.collection) {
    params.set("collection", String(req.query.collection));
  }

  const upstreamUrl = `https://api.auramaxx.gg/api/users/${encodeURIComponent(
    userId
  )}/pack-cards?${params.toString()}`;

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
      error: "Aura inventory upstream request failed.",
      details: String(error?.message || error),
    });
  }
}

