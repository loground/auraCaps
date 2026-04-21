const CAP_WEIGHT_BY_PATH = {
  "/caps/1.webp": 0.88,
  "/caps/2.webp": 1.06,
  "/caps/3.webp": 0.95,
  "/caps/4.webp": 1.12,
  "/caps/5.webp": 0.9,
  "/caps/6.webp": 1.08,
  "/caps/7.webp": 0.98,
  "/caps/8.webp": 1.15,
  "/caps/9.webp": 0.93,

  "/caps/jb/jbcap1.webp": 0.92,
  "/caps/jbcap2.webp": 1.1,
  "/caps/jb/jbcap3.webp": 0.97,
  "/caps/jb/jbcap4.webp": 1.05,
  "/caps/jb/jbcap5.webp": 0.89,
  "/caps/jb/jbcap6.webp": 1.14,

  "/caps/slammer1.png": 1.35,
  "/caps/slammer2.png": 1.5,
  "/caps/slammer3.png": 2.2,
};

export function getCapWeightMultiplier(path) {
  if (!path || typeof path !== "string") {
    return 1;
  }
  return CAP_WEIGHT_BY_PATH[path] ?? 1;
}
