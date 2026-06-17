import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
} from "viem";
import { base } from "viem/chains";
import { BASE_RPC_URL, isRpcRateLimitError, wait } from "./base-rpc.js";
import { getWalletSession } from "./wallet-access.jsx";

export const VIBE_MARKET_COLLECTION_ADDRESS =
  "0x9a978dc37923f4eb0796531d30c1e0602d966161";
export const VIBE_MARKET_TOKEN_ADDRESS =
  "0x0ceb884db37967058b0e3d57d516b2f3f226431b";

const VIBE_MARKET_API_URL = "https://build.vibechain.com/vibe/boosterbox";
const BASE_CHAIN_ID = 8453;
const NAUGHTY_ROBOTS_PACK_IMAGE =
  "https://vibechain.com/api/proxy?url=https%3A%2F%2Fimagedelivery.net%2Fg4iQ0bIzMZrjFMgjAnSGfw%2F7d777c7a-5820-4df2-3560-dd2579167800%2Fpublic";
const DEFAULT_PACK_INFO = { imagePath: NAUGHTY_ROBOTS_PACK_IMAGE };
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
    type: "event",
    name: "BoosterDropsMinted",
    inputs: [
      { indexed: true, name: "minter", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "startTokenId", type: "uint256" },
      { indexed: false, name: "endTokenId", type: "uint256" },
    ],
  },
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
    name: "mintWithToken",
    stateMutability: "payable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "tokensPerMint",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellForEth",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "minPayoutSize", type: "uint256" },
    ],
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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTokenSellQuote",
    stateMutability: "view",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];
const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});
const listeners = new Set();
const optimisticUnopenedPacks = new Map();
const optimisticOpenedItems = new Map();
const optimisticRemovedTokenIds = new Set();

let state = {
  status: "idle",
  walletAddress: "",
  collectionName: "vibe.market",
  items: [],
  unopenedPacks: [],
  packInfo: DEFAULT_PACK_INFO,
  tokenBalance: null,
  tokenBalanceFormatted: "",
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

async function readContractWithRetry(args, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await publicClient.readContract(args);
    } catch (error) {
      lastError = error;
      if (!isRpcRateLimitError(error) || attempt === attempts - 1) {
        throw error;
      }
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function mergeOptimisticState(items, unopenedPacks) {
  const mergedItems = [
    ...optimisticOpenedItems.values(),
    ...items.filter(
      (item) =>
        !optimisticRemovedTokenIds.has(item.tokenId) &&
        !optimisticOpenedItems.has(item.tokenId)
    ),
  ];
  const mergedPacks = [
    ...optimisticUnopenedPacks.values(),
    ...unopenedPacks.filter(
      (item) =>
        !optimisticRemovedTokenIds.has(item.tokenId) &&
        !optimisticUnopenedPacks.has(item.tokenId) &&
        !optimisticOpenedItems.has(item.tokenId)
    ),
  ];
  return { items: mergedItems, unopenedPacks: mergedPacks };
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
      value:
        String(attribute.trait_type).toLowerCase() === "wear" &&
        Number.isFinite(Number(attribute.value))
          ? Number(attribute.value).toFixed(1)
          : String(attribute.value),
      displayType: attribute.display_type ? String(attribute.display_type) : "",
    }));
}

function getBoxRarity(box) {
  const rarityName = String(box.rarityName || "").trim();
  if (rarityName && rarityName !== "NOT_ASSIGNED") {
    return rarityName
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  const rawRarity = Number(box.rarity);
  return RARITY_NAMES[rawRarity] || "Unknown";
}

function isUnopenedBox(box) {
  const status = String(box.status || "").toLowerCase();
  const rarityName = String(box.rarityName || "").toUpperCase();
  return (
    status === "minted" &&
    Number(box.rarity || 0) === 0 &&
    (!rarityName || rarityName === "NOT_ASSIGNED") &&
    !box.openedTxHash
  );
}

function getBoxAttributes(box, rarity) {
  const metadataAttributes = normalizeAttributes(box.metadata?.attributes).filter(
    (attribute) =>
      attribute.traitType.toLowerCase() !== "rarity" &&
      attribute.traitType.toLowerCase() !== "status" &&
      attribute.traitType.toLowerCase() !== "wear" &&
      attribute.traitType.toLowerCase() !== "foil"
  );
  const wear = box.metadata?.wear ?? getAttribute(box.metadata?.attributes, "wear");
  const foil = box.metadata?.foil ?? getAttribute(box.metadata?.attributes, "foil");
  return [
    { traitType: "Rarity", value: rarity },
    ...metadataAttributes,
    ...(wear !== undefined && wear !== null && Number.isFinite(Number(wear))
      ? [{ traitType: "Wear", value: Number(wear).toFixed(1) }]
      : []),
    ...(foil !== undefined && foil !== null
      ? [{ traitType: "Foil", value: String(foil) }]
      : []),
  ];
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
  const rarity = getBoxRarity(box);
  const collectionName =
    game?.nftName ||
    game?.tokenName ||
    box.contract?.nftName ||
    box.contractDetails?.nftName ||
    "vibe.market";
  const offer = offers?.[String(rarity).toLowerCase()] || null;
  const value = formatValue(box, game, offer);
  const imagePath = normalizeImageUrl(
    box.metadata?.originalImageUrl ||
      box.metadata?.imageUrl ||
      box.metadata?.image ||
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
    details: String(rarity),
    description: box.metadata?.description || game?.description || "",
    attributes: getBoxAttributes(box, rarity),
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
    imagePath: normalizeImageUrl(
      game?.packImage || game?.featuredImageUrl || game?.imageUrl || NAUGHTY_ROBOTS_PACK_IMAGE
    ),
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
      if (
        box.metadata?.originalImageUrl ||
        box.metadata?.imageUrl ||
        box.metadata?.image
      ) {
        enriched[index] = box;
        continue;
      }
      try {
        const metadata = await fetchJson(
          `/metadata/${encodeURIComponent(slug)}/${encodeURIComponent(tokenId)}`
        );
        enriched[index] = { ...box, metadata: { ...metadata, ...box.metadata } };
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
  const decimals = await readContractWithRetry({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  }).catch(() => 18);
  const uniqueFunctions = [...new Set(Object.values(OFFER_FUNCTIONS))];
  const results = [];
  for (const functionName of uniqueFunctions) {
    const raw = await readContractWithRetry({
      address: VIBE_MARKET_COLLECTION_ADDRESS,
      abi: DROP_ABI,
      functionName,
    });
    const ethQuote = await readContractWithRetry({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "getTokenSellQuote",
      args: [raw],
    }).catch(() => null);
    results.push([
      functionName,
      {
        raw,
        formatted: formatUnits(raw, decimals),
        ethQuote,
        ethFormatted: ethQuote === null ? "" : formatEther(ethQuote),
      },
    ]);
  }
  const byFunction = Object.fromEntries(results);
  return Object.fromEntries(
    Object.entries(OFFER_FUNCTIONS).map(([rarity, functionName]) => [
      rarity,
      byFunction[functionName],
    ])
  );
}

async function loadPackInfo(game) {
  const tokenAddress = game?.tokenAddress || VIBE_MARKET_TOKEN_ADDRESS;
  const mintPrice = await readContractWithRetry({
    address: VIBE_MARKET_COLLECTION_ADDRESS,
    abi: DROP_ABI,
    functionName: "getMintPrice",
    args: [1n],
  });
  const entropyFee = await readContractWithRetry({
    address: VIBE_MARKET_COLLECTION_ADDRESS,
    abi: DROP_ABI,
    functionName: "getEntropyFee",
  });
  const tokensPerMint = await readContractWithRetry({
    address: VIBE_MARKET_COLLECTION_ADDRESS,
    abi: DROP_ABI,
    functionName: "tokensPerMint",
  });
  const tokenDecimals = await readContractWithRetry({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  const sellPriceEth = await readContractWithRetry({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "getTokenSellQuote",
    args: [tokensPerMint],
  }).catch(() => null);
  return {
    imagePath: normalizeImageUrl(
      game?.packImage || game?.featuredImageUrl || game?.imageUrl || NAUGHTY_ROBOTS_PACK_IMAGE
    ),
    mintPrice,
    mintPriceEth: formatEther(mintPrice),
    tokensPerMint,
    tokensPerMintFormatted: formatUnits(tokensPerMint, tokenDecimals),
    tokenDecimals,
    tokenAddress,
    sellPriceEth,
    sellPriceEthFormatted: sellPriceEth === null ? "" : formatEther(sellPriceEth),
    entropyFee,
    entropyFeeEth: formatEther(entropyFee),
  };
}

async function refreshTokenBalance(walletAddress) {
  if (!walletAddress) return;
  const decimals = state.packInfo?.tokenDecimals ?? 18;
  const tokenAddress = state.packInfo?.tokenAddress || VIBE_MARKET_TOKEN_ADDRESS;
  let balance = null;
  for (let attempt = 0; attempt < 3 && balance === null; attempt += 1) {
    balance = await readContractWithRetry({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }).catch(() => null);
  }
  if (balance === null) return;
  setState({
    tokenBalance: balance,
    tokenBalanceFormatted: formatUnits(balance, decimals),
  });
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function buyVibeMarketPack(currency = "eth", amount = 1) {
  const session = requireWalletSession("buying a pack");
  const packAmount = BigInt(Math.max(1, Math.floor(Number(amount) || 1)));
  const mintPrice =
    packAmount === 1n && state.packInfo?.mintPrice
      ? state.packInfo.mintPrice
      : await readContractWithRetry({
          address: VIBE_MARKET_COLLECTION_ADDRESS,
          abi: DROP_ABI,
          functionName: "getMintPrice",
          args: [packAmount],
        });
  const payWithToken = currency === "nr";
  const tokenCost = (state.packInfo?.tokensPerMint || 0n) * packAmount;
  if (
    payWithToken &&
    state.tokenBalance !== null &&
    tokenCost > 0n &&
    state.tokenBalance < tokenCost
  ) {
    throw new Error("Your wallet does not have enough NR to buy this pack.");
  }
  const bufferedMintPrice = (mintPrice * 102n) / 100n;
  const { hash, receipt } = await sendDropTransaction(
    session,
    payWithToken ? "mintWithToken" : "mint",
    [packAmount],
    payWithToken ? 0n : bufferedMintPrice
  );
  const mintedLog = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: DROP_ABI, data: log.data, topics: log.topics });
      } catch {
        return null;
      }
    })
    .find((log) => log?.eventName === "BoosterDropsMinted");
  const startTokenId = mintedLog?.args?.startTokenId;
  const endTokenId = mintedLog?.args?.endTokenId;
  if (startTokenId !== undefined && endTokenId !== undefined) {
    const game = {
      nftName: state.collectionName,
      tokenName: state.collectionName,
      tokenAddress: VIBE_MARKET_TOKEN_ADDRESS,
      packImage: state.packInfo?.imagePath,
    };
    const newPacks = [];
    for (let tokenId = startTokenId; tokenId <= endTokenId; tokenId += 1n) {
      newPacks.push(normalizeUnopenedPack({ tokenId }, game, newPacks.length));
    }
    setState({
      unopenedPacks: [
        ...newPacks,
        ...state.unopenedPacks.filter(
          (pack) => !newPacks.some((newPack) => newPack.tokenId === pack.tokenId)
        ),
      ],
    });
    for (const pack of newPacks) {
      optimisticUnopenedPacks.set(pack.tokenId, pack);
      optimisticRemovedTokenIds.delete(pack.tokenId);
    }
  }
  await refreshTokenBalance(session.address).catch(() => {});
  return hash;
}

async function resolveOpenedPack(pack, rarityInfo) {
  const rarity = RARITY_NAMES[Number(rarityInfo.rarity)] || "Unknown";
  let revealedItem = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const [metadata, tokenResponse] = await Promise.all([
        fetchJson(`/metadata/naughty-robots/${encodeURIComponent(pack.tokenId)}`).catch(
          () => null
        ),
        fetchJson(
          `/?tokenId=${encodeURIComponent(pack.tokenId)}&contractAddress=${VIBE_MARKET_COLLECTION_ADDRESS}&chainId=${BASE_CHAIN_ID}&includeMetadata=true&includeContractDetails=true`
        ).catch(() => null),
      ]);
      const tokenBox = tokenResponse?.boosterBox || tokenResponse?.box || null;
      const resolvedMetadata = tokenBox?.metadata || metadata;
      const imagePath = normalizeImageUrl(
        resolvedMetadata?.originalImageUrl ||
          resolvedMetadata?.imageUrl ||
          resolvedMetadata?.image ||
          ""
      );
      const metadataStatus = String(
        tokenBox?.status || getAttribute(resolvedMetadata?.attributes, "status") || ""
      )
        .toLowerCase()
        .replaceAll("_", " ");
      const metadataRarity = String(
        tokenBox?.rarityName || getAttribute(resolvedMetadata?.attributes, "rarity") || ""
      ).toLowerCase();
      const isRevealedMetadata =
        metadataStatus.includes("rarity assigned") &&
        metadataRarity &&
        metadataRarity !== "unopened";
      if (isRevealedMetadata && imagePath && imagePath !== pack.imagePath) {
        revealedItem = normalizeBox(
          {
            tokenId: pack.tokenId,
            rarity: Number(rarityInfo.rarity),
            rarityName: rarity,
            status: "rarity_assigned",
            metadata: resolvedMetadata,
          },
          {
            nftName: pack.collection,
            tokenName: pack.collection,
            tokenAddress: pack.tokenAddress,
            tokenSymbol: "NR",
          },
          {},
          0
        );
        break;
      }
    } catch {
      // Token metadata can trail the onchain entropy callback briefly.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  if (!revealedItem) {
    throw new Error(
      "Pack opened successfully. The revealed card artwork is still processing and will appear shortly."
    );
  }
  return { tokenId: String(pack.tokenId), rarity, item: revealedItem };
}

export async function openVibeMarketPacks(packs) {
  const selectedPacks = (Array.isArray(packs) ? packs : [packs]).filter((pack) => pack?.tokenId);
  const session = requireWalletSession("opening packs");
  if (selectedPacks.length === 0) {
    throw new Error("Select at least one pack to open.");
  }
  const tokenIds = selectedPacks.map((pack) => BigInt(pack.tokenId));
  const entropyFee =
    state.packInfo?.entropyFee ??
    (await readContractWithRetry({
      address: VIBE_MARKET_COLLECTION_ADDRESS,
      abi: DROP_ABI,
      functionName: "getEntropyFee",
    }));
  const { hash } = await sendDropTransaction(session, "open", [tokenIds], entropyFee);

  const rarityByTokenId = new Map();
  for (let attempt = 0; attempt < 45 && rarityByTokenId.size < selectedPacks.length; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    await Promise.all(
      selectedPacks.map(async (pack) => {
        if (rarityByTokenId.has(String(pack.tokenId))) return;
        try {
          const rarityInfo = await readContractWithRetry({
            address: VIBE_MARKET_COLLECTION_ADDRESS,
            abi: DROP_ABI,
            functionName: "getTokenRarity",
            args: [BigInt(pack.tokenId)],
          });
          if (Number(rarityInfo.rarity) > 0 && rarityInfo.randomValue > 0n) {
            rarityByTokenId.set(String(pack.tokenId), rarityInfo);
          }
        } catch {
          // Pyth entropy fulfills asynchronously.
        }
      })
    );
  }
  if (rarityByTokenId.size === 0) {
    throw new Error("The packs were opened, but rarity is still being revealed. Refresh shortly.");
  }

  setState({
    unopenedPacks: state.unopenedPacks.filter(
      (item) => !selectedPacks.some((pack) => String(pack.tokenId) === item.tokenId)
    ),
  });
  for (const pack of selectedPacks) {
    optimisticUnopenedPacks.delete(String(pack.tokenId));
  }

  const results = [];
  for (const pack of selectedPacks) {
    const rarityInfo = rarityByTokenId.get(String(pack.tokenId));
    if (!rarityInfo) continue;
    const result = await resolveOpenedPack(pack, rarityInfo);
    results.push(result);
    optimisticOpenedItems.set(result.item.tokenId, result.item);
  }
  if (results.length > 0) {
    setState({
      items: [
        ...results.map((result) => result.item),
        ...state.items.filter(
          (item) => !results.some((result) => result.tokenId === String(item.tokenId))
        ),
      ],
    });
  }
  return {
    hash,
    results,
    tokenId: results[0]?.tokenId,
    rarity: results[0]?.rarity || "Unknown",
    item: results[0]?.item || null,
  };
}

export async function openVibeMarketPack(pack) {
  if (!pack?.tokenId) {
    throw new Error("This pack does not have a valid token ID.");
  }
  return openVibeMarketPacks([pack]);
}

export async function sellVibeMarketCap(item, currency = "nr", minEthPayout = 0n) {
  const session = requireWalletSession("selling a cap");
  if (!item?.tokenId) {
    throw new Error("This cap does not have a valid vibe.market token ID.");
  }

  const { hash } =
    currency === "eth"
      ? await sendDropTransaction(session, "sellForEth", [
          BigInt(item.tokenId),
          session.address,
          minEthPayout,
        ])
      : await sendDropTransaction(session, "sellAndClaimOffer", [BigInt(item.tokenId)]);
  setState({
    items: state.items.filter((ownedItem) => ownedItem.tokenId !== String(item.tokenId)),
    unopenedPacks: state.unopenedPacks.filter(
      (ownedItem) => ownedItem.tokenId !== String(item.tokenId)
    ),
  });
  optimisticRemovedTokenIds.add(String(item.tokenId));
  optimisticUnopenedPacks.delete(String(item.tokenId));
  optimisticOpenedItems.delete(String(item.tokenId));
  await refreshTokenBalance(session.address).catch(() => {});
  return hash;
}

export async function sellVibeMarketPack(item, currency = "nr") {
  const minEthPayout =
    currency === "eth" && state.packInfo?.sellPriceEth
      ? (state.packInfo.sellPriceEth * 95n) / 100n
      : 0n;
  return sellVibeMarketCap(item, currency, minEthPayout);
}

export async function sellVibeMarketPacks(items, currency = "nr") {
  const selectedItems = (Array.isArray(items) ? items : [items]).filter((item) => item?.tokenId);
  if (selectedItems.length === 0) {
    throw new Error("Select at least one pack to sell.");
  }
  const hashes = [];
  for (const item of selectedItems) {
    hashes.push(await sellVibeMarketPack(item, currency));
  }
  return hashes;
}

export function getVibeMarketState() {
  return state;
}

export function subscribeVibeMarketState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearVibeMarketOptimisticState() {
  optimisticUnopenedPacks.clear();
  optimisticOpenedItems.clear();
  optimisticRemovedTokenIds.clear();
}

export function markVibeMarketTokensRemoved(tokenIds) {
  const ids = (Array.isArray(tokenIds) ? tokenIds : [tokenIds])
    .map((tokenId) => String(tokenId || "").trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return;
  }
  setState({
    items: state.items.filter((item) => !ids.includes(String(item.tokenId))),
    unopenedPacks: state.unopenedPacks.filter((item) => !ids.includes(String(item.tokenId))),
  });
  for (const tokenId of ids) {
    optimisticRemovedTokenIds.add(tokenId);
    optimisticUnopenedPacks.delete(tokenId);
    optimisticOpenedItems.delete(tokenId);
  }
}

export async function loadVibeMarketCollectionForWallet(
  walletAddress,
  { force = false, resetOptimistic = false } = {}
) {
  const normalizedAddress = walletAddress?.toLowerCase() || "";
  if (resetOptimistic) {
    clearVibeMarketOptimisticState();
  }
  if (!normalizedAddress) {
    clearVibeMarketOptimisticState();
    setState({
      status: "idle",
      walletAddress: "",
      collectionName: "vibe.market",
      items: [],
      unopenedPacks: [],
      packInfo: DEFAULT_PACK_INFO,
      tokenBalance: null,
      tokenBalanceFormatted: "",
      error: "",
    });
    return state;
  }

  if (!force && state.walletAddress === normalizedAddress && state.status === "loaded") {
    return state;
  }
  if (!force && activeRequest?.walletAddress === normalizedAddress) {
    return activeRequest.promise;
  }

  const preserveCurrentItems = !resetOptimistic && state.walletAddress === normalizedAddress;
  setState({
    status: "loading",
    walletAddress: normalizedAddress,
    items: preserveCurrentItems ? state.items : [],
    unopenedPacks: preserveCurrentItems ? state.unopenedPacks : [],
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
      const unopenedBoxes = ownedBoxes.filter(isUnopenedBox);
      const openedBoxes = ownedBoxes.filter((box) => !isUnopenedBox(box));
      const [boxes, offers, packInfo] = await Promise.all([
        enrichBoxesWithMetadata(openedBoxes, game?.slug || "naughty-robots"),
        loadSellOffers(game).catch((error) => {
          console.warn("Could not load vibe.market sell offers", error);
          return {};
        }),
        loadPackInfo(game).catch((error) => {
          console.warn("Could not load vibe.market pack pricing", error);
          return DEFAULT_PACK_INFO;
        }),
      ]);
      let tokenBalance = null;
      for (let attempt = 0; attempt < 3 && tokenBalance === null; attempt += 1) {
        tokenBalance = await readContractWithRetry({
          address: game?.tokenAddress || VIBE_MARKET_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [normalizedAddress],
        }).catch(() => null);
      }
      const items = boxes
        .map((box, index) => normalizeBox(box, game, offers, index))
        .filter((item) => item.imagePath);
      const unopenedPacks = unopenedBoxes
        .map((box, index) => normalizeUnopenedPack(box, game, index))
        .filter((item) => item.imagePath);
      const optimisticState = mergeOptimisticState(items, unopenedPacks);
      const nextState = {
        status: "loaded",
        walletAddress: normalizedAddress,
        collectionName: game?.nftName || game?.tokenName || "vibe.market",
        items: optimisticState.items,
        unopenedPacks: optimisticState.unopenedPacks,
        packInfo,
        tokenBalance,
        tokenBalanceFormatted:
          tokenBalance === null
            ? ""
            : formatUnits(tokenBalance, packInfo?.tokenDecimals ?? 18),
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
      const optimisticState = mergeOptimisticState([], []);
      setState({
        status: "error",
        walletAddress: normalizedAddress,
        items: optimisticState.items,
        unopenedPacks: optimisticState.unopenedPacks,
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
