const BASE_CHAIN_ID = 8453;
const BASE_RPC_URL = "https://mainnet.base.org";

let walletProvider = null;
let walletSession = null;
const ACCESS_THEMES = ["hell", "heaven", "jungle-bay", "bankr"];

function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getErrorMessage(error) {
  if (error?.message?.toLowerCase().includes("user rejected")) {
    return "Connection cancelled. Try again or continue as a guest.";
  }
  return error?.message || "Could not connect wallet. Please try again.";
}

function getWalletConnectModalTheme() {
  if (document.body.classList.contains("theme-heaven")) {
    return {
      themeMode: "light",
      themeVariables: {
        "--wcm-accent-color": "#4389ca",
        "--wcm-background-color": "#d9ecfb",
      },
    };
  }
  if (document.body.classList.contains("theme-jungle-bay")) {
    return {
      themeMode: "light",
      themeVariables: {
        "--wcm-accent-color": "#57924f",
        "--wcm-background-color": "#ecf7cb",
      },
    };
  }
  if (document.body.classList.contains("theme-bankr")) {
    return {
      themeMode: "light",
      themeVariables: {
        "--wcm-accent-color": "#7a5ee6",
        "--wcm-background-color": "#e8e4dc",
      },
    };
  }
  return {
    themeMode: "dark",
    themeVariables: {
      "--wcm-accent-color": "#ff7047",
      "--wcm-background-color": "#170807",
    },
  };
}

export async function connectBaseWallet() {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    console.error(
      "WalletConnect is not configured. Add VITE_WALLETCONNECT_PROJECT_ID to .env.local."
    );
    throw new Error("Wallet connection is temporarily unavailable. Please try again later.");
  }

  if (!walletProvider) {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    walletProvider = await EthereumProvider.init({
      projectId,
      chains: [BASE_CHAIN_ID],
      rpcMap: { [BASE_CHAIN_ID]: BASE_RPC_URL },
      showQrModal: true,
      metadata: {
        name: "AURA CAPS",
        description: "Physics cap battles on Base",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.svg`],
      },
      qrModalOptions: getWalletConnectModalTheme(),
    });
  }

  if (!walletProvider.connected || walletProvider.accounts.length === 0) {
    await walletProvider.connect({ chains: [BASE_CHAIN_ID] });
  }

  if (
    walletProvider.chainId !== BASE_CHAIN_ID ||
    walletProvider.accounts.length === 0
  ) {
    await walletProvider.disconnect();
    throw new Error("Connect a wallet account on Base Mainnet to continue.");
  }

  walletSession = {
    mode: "wallet",
    address: walletProvider.accounts[0],
    chainId: BASE_CHAIN_ID,
    provider: walletProvider,
  };

  return walletSession;
}

export function getWalletSession() {
  return walletSession;
}

export function setWalletAccessTheme(theme) {
  for (const option of ACCESS_THEMES) {
    document.body.classList.toggle(`theme-${option}`, option === theme);
  }
}

export function mountWalletConnectButton() {
  const control = document.createElement("div");
  control.className = "wallet-connect-control";
  control.innerHTML = `
    <button class="wallet-connect-btn" type="button">Connect wallet</button>
    <p class="wallet-connect-status" aria-live="polite"></p>
  `;
  document.body.classList.add("wallet-connect-active");
  document.body.appendChild(control);

  const button = control.querySelector(".wallet-connect-btn");
  const status = control.querySelector(".wallet-connect-status");

  const syncButton = () => {
    const session = getWalletSession();
    const isConnected = session?.mode === "wallet" && session.address;
    button.textContent = isConnected
      ? shortenAddress(session.address)
      : "Connect wallet";
    button.classList.toggle("connected", Boolean(isConnected));
    button.disabled = Boolean(isConnected);
    button.setAttribute(
      "aria-label",
      isConnected ? `Connected wallet ${session.address} on Base` : "Connect wallet on Base"
    );
  };

  const onConnect = async () => {
    button.disabled = true;
    button.textContent = "Connecting...";
    status.classList.remove("error", "visible");

    try {
      await connectBaseWallet();
      status.textContent = "Connected on Base";
      status.classList.add("visible");
      syncButton();
      window.setTimeout(() => status.classList.remove("visible"), 2400);
    } catch (error) {
      syncButton();
      status.textContent = getErrorMessage(error);
      status.classList.add("error", "visible");
    }
  };

  button.addEventListener("click", onConnect);
  syncButton();

  return () => {
    button.removeEventListener("click", onConnect);
    control.remove();
    document.body.classList.remove("wallet-connect-active");
  };
}

export function showInitialAccessModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "access-modal";
    overlay.innerHTML = `
      <div class="access-modal-backdrop"></div>
      <section class="access-panel" role="dialog" aria-modal="true" aria-labelledby="accessTitle">
        <span class="access-kicker">AURA CAPS</span>
        <h1 id="accessTitle">Choose how to play</h1>
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
        <p id="accessStatus" class="access-status" aria-live="polite">
          Connect Phantom or another wallet. Base Mainnet only.
        </p>
      </section>
    `;

    document.body.appendChild(overlay);

    const walletButton = overlay.querySelector("#accessWalletBtn");
    const guestButton = overlay.querySelector("#accessGuestBtn");
    const status = overlay.querySelector("#accessStatus");

    const finish = (session) => {
      overlay.remove();
      resolve(session);
    };

    guestButton.addEventListener(
      "click",
      () => {
        walletSession = { mode: "guest", address: null, chainId: null, provider: null };
        finish(walletSession);
      },
      { once: true }
    );

    walletButton.addEventListener("click", async () => {
      walletButton.disabled = true;
      guestButton.disabled = true;
      walletButton.textContent = "Connecting...";
      status.classList.remove("error");
      status.textContent = "Open your wallet and approve the Base connection.";

      try {
        const session = await connectBaseWallet();
        walletButton.textContent = `Connected ${shortenAddress(session.address)}`;
        status.textContent = "Connected on Base. Entering the arena...";
        finish(session);
      } catch (error) {
        walletButton.disabled = false;
        guestButton.disabled = false;
        walletButton.textContent = "Connect wallet";
        status.classList.add("error");
        status.textContent = getErrorMessage(error);
      }
    });
  });
}
