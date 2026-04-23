function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const AURA_ORIGIN = "https://auramaxx.gg";
const AURA_SDK_URL = `${AURA_ORIGIN}/login-with-aura/sdk.js`;
const AURA_SESSION_KEY = "aura_session_v1";
const AURA_DEBUG_KEY = "aura_debug";
const AURA_LAST_LOOKUP_KEY = "aura_last_profile_lookup_v1";

function loadAuraSdk() {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.Aura) {
      resolve(window.Aura);
      return;
    }
    const existing = document.querySelector('script[data-aura-sdk="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Aura), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Aura SDK")),
        { once: true }
      );
      return;
    }
    const script = document.createElement("script");
    script.src = AURA_SDK_URL;
    script.async = true;
    script.dataset.auraSdk = "true";
    script.dataset.auraOrigin = AURA_ORIGIN;
    script.onload = () => resolve(window.Aura);
    script.onerror = () => reject(new Error("Failed to load Aura SDK"));
    document.head.appendChild(script);
  });
}

function readStoredAuraSession() {
  try {
    const raw = window.localStorage.getItem(AURA_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const hasIdentity = Boolean(parsed?.connected || parsed?.walletAddress || parsed?.user);
    return hasIdentity
      ? {
          connected: true,
          walletAddress: parsed.walletAddress || "",
          user: parsed.user || null,
        }
      : null;
  } catch {
    return null;
  }
}

function auraDebugLog(...args) {
  try {
    if (window.__AURA_DEBUG__ === true) {
      console.log("[AURA][PROFILE]", ...args);
      return;
    }
    const enabled =
      window.localStorage.getItem(AURA_DEBUG_KEY) === "1" ||
      false;
    if (enabled) {
      console.log("[AURA][PROFILE]", ...args);
    }
  } catch {
    // Ignore logging failures.
  }
}

function pickLookupCandidates(auraSession) {
  const user = auraSession?.user || {};
  const candidates = [];
  const push = (value, type) => {
    const v = String(value || "").trim();
    if (!v) return;
    if (!candidates.some((c) => c.value === v && c.type === type)) {
      candidates.push({ value: v, type });
    }
  };

  push(user.username, "lookup");
  push(user.handle, "lookup");
  push(auraSession?.walletAddress, "lookup");
  push(user.walletAddress, "lookup");
  push(user.primaryWallet, "lookup");
  push(user.id, "userId");
  push(user._id, "userId");
  push(user.userId, "userId");

  return candidates;
}

function renderInitialProfile(app) {
  app.innerHTML = `
    <div class="profile-screen">
      <button id="profileBackBtn" class="back-btn" type="button">back</button>
      <h2>Profile</h2>
      <div class="profile-card">
        <label for="profileLookupInput" class="profile-status">Username or wallet</label>
        <div class="profile-lookup-row">
          <input id="profileLookupInput" class="profile-lookup-input" type="text" placeholder="aura-user or 0x..." />
          <button id="profileLookupBtn" class="theme-btn" type="button">Load Profile</button>
        </div>
      </div>
      <div id="profileCard" class="profile-card">
        <p class="profile-status">Loading Aura profile...</p>
      </div>
    </div>
  `;
}

function renderProfileError(container, message) {
  container.innerHTML = `
    <p class="profile-status">${escapeHtml(message)}</p>
  `;
}

function renderProfileData(container, profile) {
  const avatar =
    profile.avatar ||
    profile.avatarUrl ||
    profile.profileImage ||
    profile.image ||
    "";
  const displayName =
    profile.displayName || profile.name || profile.username || "Unknown";
  const username = profile.username || profile.handle || "";
  const bio = profile.bio || profile.description || "No bio available.";
  const wallet =
    profile.primaryWallet ||
    profile.walletAddress ||
    profile.wallet ||
    profile.address ||
    "";
  const followers = profile.followersCount ?? profile.followers ?? "—";
  const following = profile.followingCount ?? profile.following ?? "—";
  const discord = profile.discordVerified ?? profile.discord?.verified;
  const xVerified = profile.xVerified ?? profile.twitterVerified;
  const userId = profile.id || profile._id || profile.userId || "—";

  container.innerHTML = `
    <div class="profile-header">
      ${
        avatar
          ? `<img class="profile-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(displayName)} avatar" />`
          : `<div class="profile-avatar placeholder">AURA</div>`
      }
      <div class="profile-title-block">
        <h3>${escapeHtml(displayName)}</h3>
        <p class="profile-username">${username ? `@${escapeHtml(username)}` : "No username"}</p>
      </div>
    </div>
    <p class="profile-bio">${escapeHtml(bio)}</p>
    <div class="profile-meta-grid">
      <div class="profile-meta-item"><span>User ID</span><strong>${escapeHtml(userId)}</strong></div>
      <div class="profile-meta-item"><span>Wallet</span><strong>${escapeHtml(wallet || "—")}</strong></div>
      <div class="profile-meta-item"><span>Followers</span><strong>${escapeHtml(followers)}</strong></div>
      <div class="profile-meta-item"><span>Following</span><strong>${escapeHtml(following)}</strong></div>
      <div class="profile-meta-item"><span>X Verified</span><strong>${xVerified ? "yes" : "no"}</strong></div>
      <div class="profile-meta-item"><span>Discord Verified</span><strong>${discord ? "yes" : "no"}</strong></div>
    </div>
  `;
}

export function mountProfileScreen({ app, onBack, auraSession }) {
  renderInitialProfile(app);
  const backBtn = app.querySelector("#profileBackBtn");
  const profileCard = app.querySelector("#profileCard");
  const profileLookupInput = app.querySelector("#profileLookupInput");
  const profileLookupBtn = app.querySelector("#profileLookupBtn");
  backBtn?.addEventListener("click", onBack);

  let aborted = false;
  let inFlight = false;

  const callLookupApi = async (value) => {
    const v = String(value || "").trim();
    if (!v) return null;
    const url = `https://api.auramaxx.gg/api/users/lookup?username=${encodeURIComponent(v)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = await response.json();
    return json?.user || json?.data || json || null;
  };

  const loadProfileByValue = async (value) => {
    const lookupValue = String(value || "").trim();
    if (!lookupValue || inFlight) {
      return false;
    }
    inFlight = true;
    renderProfileError(profileCard, "Loading Aura profile...");
    try {
      const profile = await callLookupApi(lookupValue);
      if (profile && typeof profile === "object" && !aborted) {
        renderProfileData(profileCard, profile);
        try {
          window.localStorage.setItem(AURA_LAST_LOOKUP_KEY, lookupValue);
        } catch {
          // Ignore storage errors.
        }
        return true;
      }
      if (!aborted) {
        renderProfileError(profileCard, "No profile found for this username/wallet.");
      }
      return false;
    } catch {
      if (!aborted) {
        renderProfileError(profileCard, "Could not load Aura profile right now.");
      }
      return false;
    } finally {
      inFlight = false;
    }
  };

  const run = async () => {
    const storedSession = readStoredAuraSession();
    auraDebugLog("storedSession", storedSession);
    let sdkSession = null;
    try {
      const Aura = await loadAuraSdk();
      auraDebugLog("Aura SDK loaded", Object.keys(Aura || {}));
      if (typeof Aura?.getSession === "function") {
        const session = await Aura.getSession();
        auraDebugLog("Aura.getSession()", session);
        const walletAddress =
          session?.walletAddress ||
          session?.user?.address ||
          session?.user?.walletAddress ||
          "";
        if (session?.user || walletAddress || session?.connected || session?.authenticated) {
          sdkSession = {
            connected: true,
            walletAddress,
            user: session?.user || null,
          };
        }
      }
      if (!sdkSession && typeof Aura?.getCurrentUser === "function") {
        const user = await Aura.getCurrentUser();
        auraDebugLog("Aura.getCurrentUser()", user);
        const walletAddress =
          user?.address ||
          user?.walletAddress ||
          (Array.isArray(user?.addresses) ? user.addresses[0] : "") ||
          "";
        if (user || walletAddress) {
          sdkSession = {
            connected: true,
            walletAddress,
            user: user || null,
          };
        }
      }
      if (!sdkSession && typeof Aura?.getUser === "function") {
        const user = await Aura.getUser();
        auraDebugLog("Aura.getUser()", user);
        const walletAddress =
          user?.address ||
          user?.walletAddress ||
          (Array.isArray(user?.addresses) ? user.addresses[0] : "") ||
          "";
        if (user || walletAddress) {
          sdkSession = {
            connected: true,
            walletAddress,
            user: user || null,
          };
        }
      }
    } catch {
      auraDebugLog("Aura SDK/profile read failed");
      // Ignore SDK fetch/read errors and fallback to stored session.
    }

    const effectiveSession = sdkSession || storedSession || auraSession || null;
    auraDebugLog("effectiveSession", effectiveSession);
    const bootLookup =
      effectiveSession?.user?.username ||
      effectiveSession?.user?.handle ||
      effectiveSession?.walletAddress ||
      effectiveSession?.user?.walletAddress ||
      effectiveSession?.user?.address ||
      (() => {
        try {
          return window.localStorage.getItem(AURA_LAST_LOOKUP_KEY) || "";
        } catch {
          return "";
        }
      })();
    if (profileLookupInput && !profileLookupInput.value) {
      profileLookupInput.value = bootLookup || "";
    }

    if (bootLookup) {
      const ok = await loadProfileByValue(bootLookup);
      if (ok) {
        return;
      }
    }

    if (!aborted && effectiveSession?.user) {
      renderProfileData(profileCard, effectiveSession.user);
      return;
    }
    const candidates = pickLookupCandidates(effectiveSession);
    auraDebugLog("lookup candidates", candidates);

    if (candidates.length === 0) {
      if (!aborted) {
        renderProfileError(
          profileCard,
          "No Aura username, wallet, or user id found. Connect with Aura first."
        );
      }
      return;
    }

    for (const candidate of candidates) {
      try {
        const url =
          candidate.type === "userId"
            ? `https://api.auramaxx.gg/api/users/${encodeURIComponent(candidate.value)}`
            : `https://api.auramaxx.gg/api/users/lookup?username=${encodeURIComponent(
                candidate.value
              )}`;
        const response = await fetch(url);
        auraDebugLog("profile fetch", { url, ok: response.ok, status: response.status });
        if (!response.ok) {
          continue;
        }
        const json = await response.json();
        auraDebugLog("profile fetch json", json);
        const profile = json?.user || json?.data || json;
        if (!profile || typeof profile !== "object") {
          continue;
        }
        if (!aborted) {
          renderProfileData(profileCard, profile);
        }
        return;
      } catch {
        // try next candidate
      }
    }

    if (!aborted && effectiveSession?.user) {
      renderProfileData(profileCard, effectiveSession.user);
      return;
    }

    if (!aborted) {
      renderProfileError(
        profileCard,
        "Could not load Aura profile right now."
      );
    }
  };
  run();

  const onLookup = () => loadProfileByValue(profileLookupInput?.value || "");
  profileLookupBtn?.addEventListener("click", onLookup);
  profileLookupInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      onLookup();
    }
  });

  return () => {
    aborted = true;
    backBtn?.removeEventListener("click", onBack);
    profileLookupBtn?.removeEventListener("click", onLookup);
  };
}
