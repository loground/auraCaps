export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

export const BASE_RPC_URL =
  String(import.meta.env?.VITE_BASE_RPC_URL || "").trim() || DEFAULT_BASE_RPC_URL;

export function isRpcRateLimitError(error) {
  const text = [
    error?.details,
    error?.shortMessage,
    error?.message,
    error?.cause?.details,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("rate limit") || text.includes("429");
}

export function wait(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
