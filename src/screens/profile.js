function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

  if (!auraSession?.connected) {
    renderProfileError(
      profileCard,
      "Connect with Aura in main menu first to load profile data."
    );
  } else {
    const candidates = pickLookupCandidates(auraSession);
    if (candidates.length === 0) {
      renderProfileError(
        profileCard,
        "No Aura username, wallet, or user id found in current session."
      );
    } else {
      let aborted = false;
      const run = async () => {
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
        if (!aborted) {
          renderProfileError(
            profileCard,
            "Could not load Aura profile with current session identifiers."
          );
        }
      };
      run();
    }
  }

  return () => {
    backBtn?.removeEventListener("click", onBack);
  };
}
