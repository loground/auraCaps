export const VIBE_MARKET_COLLECTION_ADDRESS =
  "0x9a978dc37923f4eb0796531d30c1e0602d966161";
export const VIBE_MARKET_TOKEN_ADDRESS =
  "0x0ceb884db37967058b0e3d57d516b2f3f226431b";

const VIBE_MARKET_API_URL = "https://build.vibechain.com/vibe/boosterbox";
const BASE_CHAIN_ID = 8453;
const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Super Rare", "Legendary"];
const listeners = new Set();

let state = {
  status: "idle",
  walletAddress: "",
  collectionName: "vibe.market",
  items: [],
  error: "",
};
let activeRequest = null;

function emitState() {
  for (const listener of listeners) {
    listener(state);
  }
}

function setState(nextState) {
  state = { ...state, ...nextState };
  emitState();
}

function normalizeImageUrl(url) {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  }
  return url;
}

function getAttribute(attributes, name) {
  const match = attributes?.find(
    (attribute) => attribute?.trait_type?.toLowerCase() === name.toLowerCase()
  );
  return match?.value;
}

function formatValue(box, game) {
  const directValue =
    box.value ??
    box.estimatedValue ??
    box.offerAmount ??
    box.sellPrice ??
    box.price;
  const metadataValue =
    getAttribute(box.metadata?.attributes, "value") ||
    getAttribute(box.metadata?.attributes, "price");
  if (directValue !== undefined && directValue !== null && directValue !== "") {
    return `${directValue} ${game?.tokenSymbol || ""}`.trim();
  }
  if (metadataValue !== undefined && metadataValue !== null && metadataValue !== "") {
    return String(metadataValue);
  }
  return "Not available";
}

function normalizeBox(box, game, index) {
  const rawRarity = Number(box.rarity);
  const rarity =
    getAttribute(box.metadata?.attributes, "rarity") ||
    RARITY_NAMES[rawRarity] ||
    "Unknown";
  const collectionName =
    game?.nftName || game?.tokenName || box.contractDetails?.nftName || "vibe.market";
  const value = formatValue(box, game);
  const imagePath = normalizeImageUrl(
    box.metadata?.image || game?.imageUrl || game?.packImage || ""
  );
  const tokenId = String(box.tokenId ?? index + 1);

  return {
    id: `vibe-${VIBE_MARKET_COLLECTION_ADDRESS}-${tokenId}`,
    number: tokenId,
    tokenId,
    name: box.metadata?.name || `${collectionName} #${tokenId}`,
    imagePath,
    collection: collectionName,
    subtitle: collectionName,
    rarity: String(rarity),
    value,
    details: `Rarity ${rarity} • Value ${value}`,
    filterGroup: "vibe-market",
    series: "vibe.market",
    centerCrop: true,
    contractAddress: VIBE_MARKET_COLLECTION_ADDRESS,
    tokenAddress: game?.tokenAddress || VIBE_MARKET_TOKEN_ADDRESS,
  };
}

async function fetchJson(path) {
  const apiKey = import.meta.env.VITE_VIBE_MARKET_API_KEY?.trim();
  const response = await fetch(`${VIBE_MARKET_API_URL}${path}`, {
    headers: apiKey ? { "API-KEY": apiKey } : undefined,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    if (!apiKey && response.status === 429) {
      throw new Error(
        "Vibe Market requires an API key. Add VITE_VIBE_MARKET_API_KEY to .env.local."
      );
    }
    throw new Error(body?.message || `Vibe Market request failed (${response.status})`);
  }
  return body;
}

export function getVibeMarketState() {
  return state;
}

export function subscribeVibeMarketState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadVibeMarketCollectionForWallet(walletAddress) {
  const normalizedAddress = walletAddress?.toLowerCase() || "";
  if (!normalizedAddress) {
    setState({
      status: "idle",
      walletAddress: "",
      collectionName: "vibe.market",
      items: [],
      error: "",
    });
    return state;
  }

  if (state.walletAddress === normalizedAddress && state.status === "loaded") {
    return state;
  }
  if (activeRequest?.walletAddress === normalizedAddress) {
    return activeRequest.promise;
  }

  setState({
    status: "loading",
    walletAddress: normalizedAddress,
    items: [],
    error: "",
  });

  const contractPath = `/contractAddress/${VIBE_MARKET_COLLECTION_ADDRESS}?chainId=${BASE_CHAIN_ID}`;
  const ownerParams = new URLSearchParams({
    contractAddress: VIBE_MARKET_COLLECTION_ADDRESS,
    chainId: String(BASE_CHAIN_ID),
    includeMetadata: "true",
    includeContractDetails: "true",
    limit: "100",
  });
  const promise = Promise.all([
    fetchJson(contractPath),
    fetchJson(`/owner/${normalizedAddress}?${ownerParams}`),
  ])
    .then(([contractResponse, ownerResponse]) => {
      const game = contractResponse?.game || ownerResponse?.boosterBoxes?.[0]?.contractDetails || {};
      const returnedTokenAddress = game?.tokenAddress?.toLowerCase();
      if (returnedTokenAddress && returnedTokenAddress !== VIBE_MARKET_TOKEN_ADDRESS) {
        console.warn("Vibe Market collection returned an unexpected token contract", {
          expected: VIBE_MARKET_TOKEN_ADDRESS,
          received: returnedTokenAddress,
        });
      }
      const boxes = Array.isArray(ownerResponse?.boosterBoxes)
        ? ownerResponse.boosterBoxes
        : [];
      const items = boxes
        .map((box, index) => normalizeBox(box, game, index))
        .filter((item) => item.imagePath);
      const nextState = {
        status: "loaded",
        walletAddress: normalizedAddress,
        collectionName: game?.nftName || game?.tokenName || "vibe.market",
        items,
        error: "",
      };
      console.log("Vibe Market wallet collection", {
        collection: game,
        ownedTokens: boxes,
        caps: items,
      });
      setState(nextState);
      return state;
    })
    .catch((error) => {
      console.error("Could not load Vibe Market wallet collection", error);
      setState({
        status: "error",
        walletAddress: normalizedAddress,
        items: [],
        error: error?.message || "Could not load Vibe Market collection.",
      });
      return state;
    })
    .finally(() => {
      if (activeRequest?.promise === promise) {
        activeRequest = null;
      }
    });

  activeRequest = { walletAddress: normalizedAddress, promise };
  return promise;
}
