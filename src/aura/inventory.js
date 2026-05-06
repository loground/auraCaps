import { getCapWeightMultiplier } from "../game/cap-physics.js";

const AURA_SPRITE_NAMES = new Set([
  "FILTHY",
  "GOLDIE",
  "ALI",
  "YODIE",
  "WILLY",
  "EAZY",
  "ANGRYTALIK",
]);

const AURA_SPRITE_OVERRIDES_BY_NAME = {
  ANGRYTALIK: {
    columns: 4,
    rows: 1,
    frameCount: 4,
    zoom: 1.25,
  },
};

const RARITY_LABELS = {
  1: "common",
  2: "rare",
  3: "epic",
  4: "legendary",
  5: "mythic",
};

export function parseSpriteHints(configLike = {}) {
  const columns = Number.parseInt(String(configLike.columns ?? configLike.cols ?? ""), 10);
  const rows = Number.parseInt(String(configLike.rows ?? ""), 10);
  const frameCount = Number.parseInt(
    String(configLike.frameCount ?? configLike.frames ?? ""),
    10
  );
  const fps = Number(configLike.fps);
  const zoom = Number(configLike.zoom);
  return {
    columns: Number.isFinite(columns) && columns > 0 ? columns : undefined,
    rows: Number.isFinite(rows) && rows > 0 ? rows : undefined,
    frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : undefined,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 8,
    zoom: Number.isFinite(zoom) && zoom > 1 ? zoom : undefined,
  };
}

export function pickAuraLookupValue(sessionLike) {
  const user = sessionLike?.user || {};
  const candidates = [
    sessionLike?.walletAddress,
    user?.walletAddress,
    user?.address,
    user?.username,
    user?.handle,
    user?.displayName,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

export function toAbsImage(imageLike) {
  const value = String(imageLike || "").trim();
  if (!value) return "";
  if (value.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }
  return `https://ipfs.io/ipfs/${value}`;
}

export function normalizeRarity(value) {
  const rarityNumber = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(rarityNumber) && RARITY_LABELS[rarityNumber]) {
    return RARITY_LABELS[rarityNumber];
  }
  return String(value || "").trim();
}

export function readTraitValue(traitList, keys) {
  const normalizedKeys = keys.map((key) => String(key).toLowerCase());
  if (!traitList) return "";

  if (!Array.isArray(traitList) && typeof traitList === "object") {
    for (const [traitKey, directValue] of Object.entries(traitList)) {
      if (
        normalizedKeys.includes(String(traitKey).toLowerCase()) &&
        directValue !== undefined &&
        directValue !== null &&
        directValue !== ""
      ) {
        return directValue;
      }
    }
  }

  const rows = Array.isArray(traitList) ? traitList : Object.values(traitList);
  const found = rows.find((trait) => {
    const traitName = String(
      trait?.trait_type ||
        trait?.traitType ||
        trait?.key ||
        trait?.name ||
        trait?.type ||
        ""
    ).toLowerCase();
    return normalizedKeys.includes(traitName);
  });
  return found?.value ?? found?.display_value ?? found?.displayValue ?? "";
}

export function parseWeightMultiplier(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/x$/i, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function pickInventoryRows(payload) {
  const candidates = [
    payload?.data,
    payload?.items,
    payload?.cards,
    payload?.results,
    payload?.packCards,
    payload,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function pickAttrValue(attrs, keys) {
  const normalized = keys.map((key) => String(key).toLowerCase());
  const found = attrs.find((attr) =>
    normalized.includes(
      String(attr?.trait_type || attr?.traitType || attr?.key || "").toLowerCase()
    )
  );
  return found?.value ?? found?.display_value ?? "";
}

export function extractAuraInventoryItems(payload, { limit = Infinity } = {}) {
  const seen = new Set();
  const mapped = [];

  for (const row of pickInventoryRows(payload)) {
    const metadata = row?.metadata || row?.card?.metadata || row?.packCard?.metadata || {};
    const attrs = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
    const traitList =
      row?.traitList ||
      row?.traits ||
      metadata?.traitList ||
      metadata?.traits ||
      row?.card?.traitList ||
      row?.packCard?.traitList ||
      [];
    const name = String(
      row?.name || row?.title || metadata?.name || row?.card?.name || row?.packCard?.name || ""
    ).trim();
    const imagePath = toAbsImage(
      row?.image ||
        row?.imageUrl ||
        row?.image_url ||
        row?.imageURI ||
        row?.image_uri ||
        metadata?.image ||
        metadata?.image_url ||
        row?.card?.image ||
        row?.card?.imageUrl ||
        row?.packCard?.image
    );
    const uniqueKey = String(
      row?.id ||
        row?._id ||
        row?.tokenId ||
        row?.tokenID ||
        row?.mint ||
        row?.packCardId ||
        `${name}-${imagePath}`
    );
    if (!name || !imagePath || seen.has(uniqueKey)) continue;

    seen.add(uniqueKey);
    const upperName = name.toUpperCase();
    const isAuraSprite = AURA_SPRITE_NAMES.has(upperName);
    const collection = String(
      metadata?.collection ||
        metadata?.collectionName ||
        row?.collectionName ||
        row?.collection ||
        "aura collection"
    ).trim();
    const series = String(metadata?.series || row?.series || "beta").trim();
    const rarity = normalizeRarity(
      metadata?.rarity ?? row?.rarity ?? readTraitValue(traitList, ["rarity"])
    );
    const traitWeight = parseWeightMultiplier(
      readTraitValue(traitList, ["weight", "weightMultiplier", "weight multiplier"])
    );
    const weightMultiplier =
      traitWeight ??
      parseWeightMultiplier(metadata?.weight ?? row?.weight) ??
      getCapWeightMultiplier(imagePath);
    const spriteOverride = AURA_SPRITE_OVERRIDES_BY_NAME[upperName] || {};
    const spriteHints = isAuraSprite
      ? parseSpriteHints({
          columns:
            spriteOverride.columns ??
            metadata?.columns ??
            metadata?.cols ??
            metadata?.spriteColumns ??
            row?.columns ??
            pickAttrValue(attrs, ["columns", "cols", "spriteColumns", "sprite columns"]),
          rows:
            spriteOverride.rows ??
            metadata?.rows ??
            metadata?.spriteRows ??
            row?.rows ??
            pickAttrValue(attrs, ["rows", "spriteRows", "sprite rows"]),
          frameCount:
            spriteOverride.frameCount ??
            metadata?.frameCount ??
            metadata?.frames ??
            metadata?.spriteFrames ??
            row?.frameCount ??
            pickAttrValue(attrs, ["frameCount", "frames", "sprite frames", "spriteFrames"]),
          fps:
            spriteOverride.fps ??
            metadata?.fps ??
            metadata?.spriteFps ??
            row?.fps ??
            pickAttrValue(attrs, ["fps", "spriteFps", "sprite fps"]),
          zoom: spriteOverride.zoom ?? 1,
        })
      : null;

    mapped.push({
      id: `aura-${uniqueKey}`,
      uniqueKey,
      name,
      imagePath,
      collection,
      series,
      rarity,
      weightMultiplier,
      isAuraSprite,
      spriteHints,
      raw: row,
    });

    if (mapped.length >= limit) break;
  }

  return mapped;
}

export async function fetchAuraInventory({ sessionLike, limit = 48 } = {}) {
  const lookupValue = pickAuraLookupValue(sessionLike);
  if (!lookupValue) return [];

  const profileResponse = await fetch(
    `/api/aura-profile?username=${encodeURIComponent(lookupValue)}`
  );
  const profileJson = await profileResponse.json().catch(() => null);
  const profilePayload = profileJson?.data || profileJson;
  const profile = profilePayload?.user || profilePayload?.data || profilePayload || {};
  const userId = String(profile?.id || profile?._id || profile?.userId || "").trim();
  if (!profileResponse.ok || !userId) return [];

  const inventoryResponse = await fetch(
    `/api/aura-inventory?userId=${encodeURIComponent(
      userId
    )}&condensed=true&ownedOnly=true&packType=all&limit=200&page=1`
  );
  const inventoryJson = await inventoryResponse.json().catch(() => null);
  if (!inventoryResponse.ok) return [];

  return extractAuraInventoryItems(inventoryJson?.data || inventoryJson, { limit });
}
