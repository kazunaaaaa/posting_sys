// 配布部数の算出ルール（アプリ全体・配布部数表で共通）
//   配布部数 = 世帯数 × カバー率(70%) を 10部単位で切り捨て
//   ＝ Excel の =ROUNDDOWN(世帯数*カバー率,-1) と同じ結果
export const DISTRIBUTION_RATE = 0.7;

export function distributionFor(households, rate = DISTRIBUTION_RATE) {
  if (households == null) return null;
  return Math.floor((households * rate) / 10 + 1e-9) * 10;
}
