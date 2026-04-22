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
  backBtn?.addEventListener("click", onBack);

  let aborted = false;
  const run = async () => {
    const storedSession = readStoredAuraSession();
    let sdkSession = null;
    try {
      const Aura = await loadAuraSdk();
      if (typeof Aura?.getSession === "function") {
        const session = await Aura.getSession();
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
      // Ignore SDK fetch/read errors and fallback to stored session.
    }

    const effectiveSession = sdkSession || storedSession || auraSession || null;
    if (!aborted && effectiveSession?.user) {
      renderProfileData(profileCard, effectiveSession.user);
    }
    const candidates = pickLookupCandidates(effectiveSession);

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
        if (!response.ok) {
          continue;
        }
        const json = await response.json();
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

  return () => {
    aborted = true;
    backBtn?.removeEventListener("click", onBack);
  };
}
