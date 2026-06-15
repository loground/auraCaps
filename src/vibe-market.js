import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
} from "viem";
import { base } from "viem/chains";
import { getWalletSession } from "./wallet-access.jsx";

export const VIBE_MARKET_COLLECTION_ADDRESS =
  "0x9a978dc37923f4eb0796531d30c1e0602d966161";
export const VIBE_MARKET_TOKEN_ADDRESS =
  "0x0ceb884db37967058b0e3d57d516b2f3f226431b";

const VIBE_MARKET_API_URL = "https://build.vibechain.com/vibe/boosterbox";
const BASE_CHAIN_ID = 8453;
const RARITY_NAMES = ["Unknown", "Common", "Rare", "Epic", "Legendary", "Mythic"];
const OFFER_FUNCTIONS = {
  common: "COMMON_OFFER",
  uncommon: "COMMON_OFFER",
  rare: "RARE_OFFER",
  epic: "EPIC_OFFER",
  "super rare": "EPIC_OFFER",
  legendary: "LEGENDARY_OFFER",
  mythic: "MYTHIC_OFFER",
};
const DROP_ABI = [
  {
    type: "function",
    name: "sellAndClaimOffer",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "open",
    stateMutability: "payable",
    inputs: [{ name: "tokenIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getMintPrice",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getEntropyFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTokenRarity",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "rarityInfo",
        type: "tuple",
        components: [
          { name: "rarity", type: "uint8" },
          { name: "randomValue", type: "uint256" },
          { name: "tokenSpecificRandomness", type: "bytes32" },
        ],
      },
    ],
  },
  ...["COMMON_OFFER", "RARE_OFFER", "EPIC_OFFER", "LEGENDARY_OFFER", "MYTHIC_OFFER"].map(
    (name) => ({
      type: "function",
      name,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
    })
  ),
];
const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
];
const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});
const listeners = new Set();

let state = {
  status: "idle",
  walletAddress: "",
  collectionName: "vibe.market",
  items: [],
  unopenedPacks: [],
  packInfo: null,
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

function normalizeAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .filter((attribute) => attribute?.trait_type && attribute?.value !== undefined)
    .map((attribute) => ({
      traitType: String(attribute.trait_type),
      value: String(attribute.value),
      displayType: attribute.display_type ? String(attribute.display_type) : "",
    }));
}

function formatValue(box, game, offer) {
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
  if (offer?.formatted) {
    return `${offer.formatted} ${game?.tokenSymbol || ""}`.trim();
  }
  return "Not available";
}

function normalizeBox(box, game, offers, index) {
  const rawRarity = Number(box.rarity);
  const rarity =
    getAttribute(box.metadata?.attributes, "rarity") ||
    RARITY_NAMES[rawRarity] ||
    "Unknown";
  const collectionName =
    game?.nftName ||
    game?.tokenName ||
    box.contract?.nftName ||
    box.contractDetails?.nftName ||
    "vibe.market";
  const offer = offers?.[String(rarity).toLowerCase()] || null;
  const value = formatValue(box, game, offer);
  const imagePath = normalizeImageUrl(
    box.metadata?.image ||
      box.metadata?.imageUrl ||
      game?.imageUrl ||
      game?.packImage ||
      ""
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
    offer,
    details: `Rarity ${rarity} • Value ${value}`,
    description: box.metadata?.description || game?.description || "",
    attributes: normalizeAttributes(box.metadata?.attributes),
    externalUrl: box.metadata?.external_url || "",
    animationUrl: box.metadata?.animation_url || "",
    filterGroup: "vibe-market",
    series: "vibe.market",
    centerCrop: true,
    contractAddress: VIBE_MARKET_COLLECTION_ADDRESS,
    tokenAddress: game?.tokenAddress || VIBE_MARKET_TOKEN_ADDRESS,
  };
}

function normalizeUnopenedPack(box, game, index) {
  const tokenId = String(box.tokenId ?? index + 1);
  const collectionName = game?.nftName || game?.tokenName || "vibe.market";
  return {
    id: `vibe-pack-${VIBE_MARKET_COLLECTION_ADDRESS}-${tokenId}`,
    number: tokenId,
    tokenId,
    name: `${collectionName} Pack #${tokenId}`,
    imagePath: normalizeImageUrl(game?.packImage || game?.featuredImageUrl || game?.imageUrl || ""),
    collection: collectionName,
    subtitle: "Unopened pack",
    details: "Open this pack to reveal its cap.",
    description: game?.description || "",
    attributes: [{ traitType: "Status", value: "Unopened" }],
    filterGroup: "vibe-market",
    series: "vibe.market",
    centerCrop: false,
    itemType: "unopened-pack",
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

async function enrichBoxesWithMetadata(boxes, slug) {
  if (!slug || boxes.length === 0) return boxes;

  const enriched = new Array(boxes.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(6, boxes.length) }, async () => {
    while (nextIndex < boxes.length) {
      const index = nextIndex;
      nextIndex += 1;
      const box = boxes[index];
      const tokenId = box.tokenId ?? index + 1;
      try {
        const metadata = await fetchJson(
          `/metadata/${encodeURIComponent(slug)}/${encodeURIComponent(tokenId)}`
        );
        enriched[index] = { ...box, metadata: { ...box.metadata, ...metadata } };
      } catch (error) {
        console.warn(`Could not load vibe.market metadata for token ${tokenId}`, error);
        enriched[index] = box;
      }
    }
  });
  await Promise.all(workers);
  return enriched;
}

async function loadSellOffers(game) {
  const tokenAddress = game?.tokenAddress || VIBE_MARKET_TOKEN_ADDRESS;
  const decimals = await publicClient
    .readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    })
    .catch(() => 18);
  const uniqueFunctions = [...new Set(Object.values(OFFER_FUNCTIONS))];
  const results = await Promise.all(
    uniqueFunctions.map(async (functionName) => {
      const raw = await publicClient.readContract({
        address: VIBE_MARKET_COLLECTION_ADDRESS,
        abi: DROP_ABI,
        functionName,
      });
      return [functionName, { raw, formatted: formatUnits(raw, decimals) }];
    })
  );
  const byFunction = Object.fromEntries(results);
  return Object.fromEntries(
    Object.entries(OFFER_FUNCTIONS).map(([rarity, functionName]) => [
      rarity,
      byFunction[functionName],
    ])
  );
}

async function loadPackInfo(game) {
  const [mintPrice, entropyFee] = await Promise.all([
    publicClient.readContract({
      address: VIBE_MARKET_COLLECTION_ADDRESS,
      abi: DROP_ABI,
      functionName: "getMintPrice",
      args: [1n],
    }),
    publicClient.readContract({
      address: VIBE_MARKET_COLLECTION_ADDRESS,
      abi: DROP_ABI,
      functionName: "getEntropyFee",
    }),
  ]);
  return {
    imagePath: normalizeImageUrl(game?.packImage || game?.featuredImageUrl || game?.imageUrl || ""),
    mintPrice,
    mintPriceEth: formatEther(mintPrice),
    entropyFee,
    entropyFeeEth: formatEther(entropyFee),
  };
}

function requireWalletSession(action) {
  const session = getWalletSession();
  if (session?.mode !== "wallet" || !session.address || !session.provider?.request) {
    throw new Error(`Connect your wallet on Base before ${action}.`);
  }
  return session;
}

async function sendDropTransaction(session, functionName, args, value = 0n) {
  const transaction = {
    from: session.address,
    to: VIBE_MARKET_COLLECTION_ADDRESS,
    data: encodeFunctionData({ abi: DROP_ABI, functionName, args }),
  };
  if (value > 0n) {
    transaction.value = `0x${value.toString(16)}`;
  }
  const hash = await session.provider.request({
    method: "eth_sendTransaction",
    params: [transaction],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function buyVibeMarketPack() {
  const session = requireWalletSession("buying a pack");
  const mintPrice =
    state.packInfo?.mintPrice ??
    (await publicClient.readContract({
      address: VIBE_MARKET_COLLECTION_ADDRESS,
      abi: DROP_ABI,
      functionName: "getMintPrice",
      args: [1n],
    }));
  const bufferedMintPrice = (mintPrice * 102n) / 100n;
  const hash = await sendDropTransaction(session, "mint", [1n], bufferedMintPrice);
  await loadVibeMarketCollectionForWallet(session.address, { force: true });
  return hash;
}

export async function openVibeMarketPack(pack) {
  const session = requireWalletSession("opening a pack");
  if (!pack?.tokenId) {
    throw new Error("This pack does not have a valid token ID.");
  }
  const tokenId = BigInt(pack.tokenId);
  const entropyFee =
    state.packInfo?.entropyFee ??
    (await publicClient.readContract({
      address: VIBE_MARKET_COLLECTION_ADDRESS,
      abi: DROP_ABI,
      functionName: "getEntropyFee",
    }));
  const hash = await sendDropTransaction(session, "open", [[tokenId]], entropyFee);

  let rarityInfo = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    try {
      rarityInfo = await publicClient.readContract({
        address: VIBE_MARKET_COLLECTION_ADDRESS,
        abi: DROP_ABI,
        functionName: "getTokenRarity",
        args: [tokenId],
      });
      break;
    } catch {
      // Pyth entropy fulfills asynchronously.
    }
  }
  if (!rarityInfo) {
    throw new Error("The pack was opened, but its rarity is still being revealed. Refresh shortly.");
  }
  let revealedItem = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await loadVibeMarketCollectionForWallet(session.address, { force: true });
    revealedItem = state.items.find((item) => item.tokenId === String(pack.tokenId)) || null;
    if (revealedItem) {
      break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  return {
    hash,
    tokenId: String(pack.tokenId),
    rarity: RARITY_NAMES[Number(rarityInfo.rarity)] || "Unknown",
    item: revealedItem,
  };
}

export async function sellVibeMarketCap(item) {
  const session = requireWalletSession("selling a cap");
  if (!item?.tokenId) {
    throw new Error("This cap does not have a valid vibe.market token ID.");
  }

  const hash = await session.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: session.address,
        to: item.contractAddress || VIBE_MARKET_COLLECTION_ADDRESS,
        data: encodeFunctionData({
          abi: DROP_ABI,
          functionName: "sellAndClaimOffer",
          args: [BigInt(item.tokenId)],
        }),
      },
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await loadVibeMarketCollectionForWallet(session.address, { force: true });
  return hash;
}

export function getVibeMarketState() {
  return state;
}

export function subscribeVibeMarketState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadVibeMarketCollectionForWallet(walletAddress, { force = false } = {}) {
  const normalizedAddress = walletAddress?.toLowerCase() || "";
  if (!normalizedAddress) {
    setState({
      status: "idle",
      walletAddress: "",
      collectionName: "vibe.market",
      items: [],
      unopenedPacks: [],
      packInfo: null,
      error: "",
    });
    return state;
  }

  if (!force && state.walletAddress === normalizedAddress && state.status === "loaded") {
    return state;
  }
  if (activeRequest?.walletAddress === normalizedAddress) {
    return activeRequest.promise;
  }

  setState({
    status: "loading",
    walletAddress: normalizedAddress,
    items: [],
    unopenedPacks: [],
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
    .then(async ([contractResponse, ownerResponse]) => {
      const game =
        contractResponse?.contractInfo ||
        contractResponse?.game ||
        ownerResponse?.boxes?.[0]?.contract ||
        ownerResponse?.boosterBoxes?.[0]?.contractDetails ||
        {};
      const returnedTokenAddress = game?.tokenAddress?.toLowerCase();
      if (returnedTokenAddress && returnedTokenAddress !== VIBE_MARKET_TOKEN_ADDRESS) {
        console.warn("Vibe Market collection returned an unexpected token contract", {
          expected: VIBE_MARKET_TOKEN_ADDRESS,
          received: returnedTokenAddress,
        });
      }
      const ownedBoxes = Array.isArray(ownerResponse?.boxes)
        ? ownerResponse.boxes
        : Array.isArray(ownerResponse?.boosterBoxes)
          ? ownerResponse.boosterBoxes
          : [];
      const unopenedBoxes = ownedBoxes.filter(
        (box) => String(box.status || "").toLowerCase() === "minted"
      );
      const openedBoxes = ownedBoxes.filter(
        (box) => String(box.status || "").toLowerCase() !== "minted"
      );
      const [boxes, offers, packInfo] = await Promise.all([
        enrichBoxesWithMetadata(openedBoxes, game?.slug || "naughty-robots"),
        loadSellOffers(game).catch((error) => {
          console.warn("Could not load vibe.market sell offers", error);
          return {};
        }),
        loadPackInfo(game).catch((error) => {
          console.warn("Could not load vibe.market pack pricing", error);
          return null;
        }),
      ]);
      const items = boxes
        .map((box, index) => normalizeBox(box, game, offers, index))
        .filter((item) => item.imagePath);
      const unopenedPacks = unopenedBoxes
        .map((box, index) => normalizeUnopenedPack(box, game, index))
        .filter((item) => item.imagePath);
      const nextState = {
        status: "loaded",
        walletAddress: normalizedAddress,
        collectionName: game?.nftName || game?.tokenName || "vibe.market",
        items,
        unopenedPacks,
        packInfo,
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
        unopenedPacks: [],
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
