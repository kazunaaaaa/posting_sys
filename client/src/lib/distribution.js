// 配布部数 = 世帯数 × カバー率 を10部単位で切り捨て（サーバーの distribution.js・Excel の ROUNDDOWN と同じ）
export const DEFAULT_RATE = 0.7;

export function distributionFor(households, rate = DEFAULT_RATE) {
  if (households == null) return null;
  return Math.floor((households * rate) / 10 + 1e-9) * 10;
}

export function withRate(area, rate) {
  return area.households == null ? area : { ...area, distribution: distributionFor(area.households, rate) };
}

// 入力欄の％ → 0〜1（1〜100％の範囲に収める）
export function rateFromPercent(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(100, n) / 100;
}
