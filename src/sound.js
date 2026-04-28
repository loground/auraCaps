const DEFAULT_POOL_SIZE = 4;
const pools = new Map();
let unlocked = false;

function createAudio(path) {
  const audio = new Audio(path);
  audio.preload = "auto";
  audio.load();
  return audio;
}

export function preloadSounds(paths, poolSize = DEFAULT_POOL_SIZE) {
  for (const path of paths) {
    if (!path || pools.has(path)) {
      continue;
    }
    const pool = Array.from({ length: poolSize }, () => createAudio(path));
    pools.set(path, { pool, index: 0 });
  }
}

export function unlockSounds() {
  if (unlocked) {
    return;
  }
  unlocked = true;

  for (const { pool } of pools.values()) {
    const audio = pool[0];
    if (!audio) {
      continue;
    }
    const previousMuted = audio.muted;
    const previousVolume = audio.volume;
    audio.muted = true;
    audio.volume = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = previousMuted;
          audio.volume = previousVolume;
        })
        .catch(() => {
          audio.muted = previousMuted;
          audio.volume = previousVolume;
        });
    } else {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
      audio.volume = previousVolume;
    }
  }
}

export function playSound(path, volume = 0.8) {
  if (!path) {
    return;
  }

  if (!pools.has(path)) {
    preloadSounds([path]);
  }

  const entry = pools.get(path);
  if (!entry?.pool?.length) {
    return;
  }

  const audio = entry.pool[entry.index % entry.pool.length];
  entry.index = (entry.index + 1) % entry.pool.length;

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch {
    // Ignore browser playback restrictions.
  }
}
