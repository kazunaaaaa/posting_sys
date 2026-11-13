// 配布部数の算出ルール（アプリ全体・配布部数表で共通）
//   配布部数 = 世帯数 × カバー率(70%) を 10部単位で切り捨て
//   ＝ Excel の =ROUNDDOWN(世帯数*カバー率,-1) と同じ結果
export const DISTRIBUTION_RATE = 0.7;

export function distributionFor(households, rate = DISTRIBUTION_RATE) {
  if (households == null) return null;
  return Math.floor((households * rate) / 10 + 1e-9) * 10;
}

// 画面で入力されたカバー率（0〜1。1〜100 の％で来ても受け付ける）。不正なら既定値
export function normalizeRate(v) {
  let r = Number(v);
  if (!Number.isFinite(r) || r <= 0) return DISTRIBUTION_RATE;
  if (r > 1) r /= 100;
  return r > 0 && r <= 1 ? r : DISTRIBUTION_RATE;
}

// エリアの配布部数をカバー率で計算し直す（元の配列は変更しない）
export function applyRate(areas, rate) {
  const r = normalizeRate(rate);
  return areas.map((a) => (a.households == null ? a : { ...a, distribution: distributionFor(a.households, r), distributionRate: r }));
}
