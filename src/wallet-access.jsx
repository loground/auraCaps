import "@rainbow-me/rainbowkit/styles.css";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectButton,
  RainbowKitProvider,
  connectorsForWallets,
  darkTheme,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  phantomWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { useAccount, useConnectorClient, useSwitchChain } from "wagmi";

const BASE_RPC_URL = "https://mainnet.base.org";
const WALLET_DISCONNECTED_KEY = "aura-caps:wallet-disconnected";
const ACCESS_THEMES = ["hell", "heaven", "jungle-bay", "bankr"];
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        phantomWallet,
        rainbowWallet,
        coinbaseWallet,
        walletConnectWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: "AURA CAPS",
    appDescription: "Physics cap battles on Base",
    appUrl: window.location.origin,
    appIcon: `${window.location.origin}/favicon.svg`,
    projectId: projectId || "WALLETCONNECT_PROJECT_ID_NOT_CONFIGURED",
  }
);

const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  storage: null,
  transports: {
    [base.id]: http(BASE_RPC_URL),
  },
});
const queryClient = new QueryClient();

let walletSession = null;
let walletRoot = null;
let walletRootElement = null;
let walletControlVisible = false;
let openConnectModal = null;
let pendingWalletSessionAnnouncement = 0;
let lastAnnouncedWalletSessionKey = "";

function getWalletSessionKey(session) {
  return [
    session?.mode || "guest",
    session?.address || "",
    session?.chainId || "",
    session?.provider ? "provider" : "no-provider",
  ].join(":");
}

function createWalletSessionEvent(detail) {
  if (typeof CustomEvent === "function") {
    return new CustomEvent("caps:wallet-session", { detail });
  }
  const event = document.createEvent("CustomEvent");
  event.initCustomEvent("caps:wallet-session", false, false, detail);
  return event;
}

function announceWalletSession() {
  const sessionKey = getWalletSessionKey(walletSession);
  if (sessionKey === lastAnnouncedWalletSessionKey) {
    return;
  }
  window.clearTimeout(pendingWalletSessionAnnouncement);
  pendingWalletSessionAnnouncement = window.setTimeout(() => {
    const currentKey = getWalletSessionKey(walletSession);
    if (currentKey === lastAnnouncedWalletSessionKey) {
      return;
    }
    lastAnnouncedWalletSessionKey = currentKey;
    window.dispatchEvent(createWalletSessionEvent(walletSession));
  }, 0);
}

function setWalletSession(nextSession) {
  const previousKey = getWalletSessionKey(walletSession);
  walletSession = nextSession;
  if (getWalletSessionKey(walletSession) !== previousKey) {
    announceWalletSession();
  }
}

function setWalletDisconnected(disconnected) {
  if (disconnected) {
    window.localStorage.setItem(WALLET_DISCONNECTED_KEY, "true");
  } else {
    window.localStorage.removeItem(WALLET_DISCONNECTED_KEY);
  }
}

function shouldReconnectWalletOnMount() {
  return window.localStorage.getItem(WALLET_DISCONNECTED_KEY) !== "true";
}

wagmiConfig.subscribe(
  (configState) => configState.status,
  (status, previousStatus) => {
    if (status === "connected") {
      setWalletDisconnected(false);
      return;
    }
    if (
      status === "disconnected" &&
      (previousStatus === "connected" || walletSession?.mode === "wallet")
    ) {
      setWalletDisconnected(true);
      setWalletSession({ mode: "guest", address: null, chainId: null, provider: null });
    }
  }
);

function getRainbowTheme() {
  if (document.body.classList.contains("theme-heaven")) {
    return lightTheme({ accentColor: "#4389ca", borderRadius: "small" });
  }
  if (document.body.classList.contains("theme-jungle-bay")) {
    return lightTheme({ accentColor: "#57924f", borderRadius: "small" });
  }
  if (document.body.classList.contains("theme-bankr")) {
    return lightTheme({ accentColor: "#7a5ee6", borderRadius: "small" });
  }
  return darkTheme({ accentColor: "#ff7047", borderRadius: "small" });
}

function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getErrorMessage(error) {
  if (error?.message?.toLowerCase().includes("user rejected")) {
    return "Connection cancelled. Try again or continue as a guest.";
  }
  return error?.message || "Could not connect wallet. Please try again.";
}

function ModalRegistrar({ open }) {
  useEffect(() => {
    openConnectModal = open;
    return () => {
      if (openConnectModal === open) {
        openConnectModal = null;
      }
    };
  }, [open]);

  return null;
}

function WalletBridge({ showControl }) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const switchingChainRef = useRef(false);
  const {
    data: connectorClient,
    error: connectorClientError,
  } = useConnectorClient({
    chainId: base.id,
    query: {
      enabled: isConnected && chainId === base.id,
      retry: false,
    },
  });

  useEffect(() => {
    if (!isConnected || !address || chainId === base.id || switchingChainRef.current) {
      return undefined;
    }
    switchingChainRef.current = true;
    switchChainAsync({ chainId: base.id })
      .catch((error) => {
        console.warn("Wallet is connected on the wrong chain. Switch to Base to continue.", error);
      })
      .finally(() => {
        switchingChainRef.current = false;
      });
    return undefined;
  }, [address, chainId, isConnected, switchChainAsync]);

  useEffect(() => {
    if (!isConnected || !address || chainId !== base.id) {
      setWalletSession({ mode: "guest", address: null, chainId: null, provider: null });
      return undefined;
    }

    setWalletSession({
      mode: "wallet",
      address,
      chainId: base.id,
      provider: connectorClient || null,
    });

    if (!connectorClient) {
      return undefined;
    }

    setWalletSession({
      mode: "wallet",
      address,
      chainId: base.id,
      provider: connectorClient,
    });
    return undefined;
  }, [address, chainId, connectorClient, isConnected]);

  useEffect(() => {
    if (connectorClientError) {
      if (connectorClientError.name === "ConnectorChainMismatchError") {
        return;
      }
      console.error("Could not access the connected wallet provider", connectorClientError);
    }
  }, [connectorClientError]);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal: openRainbowConnectModal,
      }) => {
        if (!showControl) {
          return <ModalRegistrar open={openRainbowConnectModal} />;
        }

        const connected = mounted && account && chain;
        const wrongNetwork = connected && chain.unsupported;
        const onClick = !connected
          ? openRainbowConnectModal
          : wrongNetwork
            ? openChainModal
            : openAccountModal;

        return (
          <>
            <ModalRegistrar open={openRainbowConnectModal} />
            <div
              className="wallet-connect-control"
              aria-hidden={!mounted}
              style={!mounted ? { visibility: "hidden" } : undefined}
            >
              <button
                className={`wallet-connect-btn${connected && !wrongNetwork ? " connected" : ""}`}
                type="button"
                onClick={onClick}
              >
                {wrongNetwork
                  ? "Switch to Base"
                  : connected
                    ? shortenAddress(account.address)
                    : "Connect wallet"}
              </button>
            </div>
          </>
        );
      }}
    </ConnectButton.Custom>
  );
}

function WalletApp({ showControl }) {
  const [bridgeReady, setBridgeReady] = useState(false);

  useEffect(() => {
    setBridgeReady(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={shouldReconnectWalletOnMount()}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={getRainbowTheme()} initialChain={base}>
          {bridgeReady ? <WalletBridge showControl={showControl} /> : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function renderWalletApp() {
  if (!walletRoot) {
    walletRootElement = document.createElement("div");
    walletRootElement.id = "wallet-root";
    document.body.appendChild(walletRootElement);
    walletRoot = createRoot(walletRootElement);
  }
  walletRoot.render(<WalletApp showControl={walletControlVisible} />);
}

export function openWalletPicker() {
  if (!projectId) {
    throw new Error(
      "Wallet connection is temporarily unavailable. Add VITE_WALLETCONNECT_PROJECT_ID."
    );
  }
  if (!walletRoot) {
    renderWalletApp();
  }
  window.setTimeout(() => openConnectModal?.(), 0);
}

export function getWalletSession() {
  return walletSession;
}

export function setWalletAccessTheme(theme) {
  for (const option of ACCESS_THEMES) {
    document.body.classList.toggle(`theme-${option}`, option === theme);
  }
  if (walletRoot) {
    renderWalletApp();
  }
}

export function mountWalletConnectButton() {
  walletControlVisible = true;
  document.body.classList.add("wallet-connect-active");
  renderWalletApp();

  return () => {
    walletControlVisible = false;
    document.body.classList.remove("wallet-connect-active");
    renderWalletApp();
  };
}

export function showInitialAccessModal() {
  renderWalletApp();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "access-modal";
    overlay.innerHTML = `
      <div class="access-modal-backdrop"></div>
      <section class="access-panel" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
        <span class="access-kicker">AURA CAPS</span>
        <h1 id="accessTitle">Collect and battle</h1>
        <p class="access-copy">
          Jump straight into the arena as a guest, or connect your wallet on Base.
        </p>
        <div class="access-actions">
          <button id="accessWalletBtn" class="access-wallet-btn" type="button">
            Connect wallet
          </button>
          <button id="accessGuestBtn" class="access-guest-btn" type="button">
            Play as guest
          </button>
        </div>
        <p id="accessStatus" class="access-status" aria-live="polite">Base Mainnet only.</p>
      </section>
    `;

    document.body.appendChild(overlay);

    const walletButton = overlay.querySelector("#accessWalletBtn");
    const guestButton = overlay.querySelector("#accessGuestBtn");
    const status = overlay.querySelector("#accessStatus");

    const finish = (session) => {
      window.removeEventListener("caps:wallet-session", onWalletSession);
      overlay.remove();
      resolve(session);
    };

    const onWalletSession = (event) => {
      if (event.detail?.mode === "wallet" && event.detail.address) {
        finish(event.detail);
      }
    };
    window.addEventListener("caps:wallet-session", onWalletSession);
    if (walletSession?.mode === "wallet" && walletSession.address) {
      finish(walletSession);
      return;
    }

    guestButton.addEventListener(
      "click",
      () => {
        setWalletSession({ mode: "guest", address: null, chainId: null, provider: null });
        finish(walletSession);
      },
      { once: true }
    );

    walletButton.addEventListener("click", () => {
      status.classList.remove("error");
      status.textContent = "Choose Phantom or another wallet, then approve Base.";
      try {
        openWalletPicker();
      } catch (error) {
        status.classList.add("error");
        status.textContent = getErrorMessage(error);
      }
    });
  });
}
