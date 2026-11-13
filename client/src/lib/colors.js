// 地図の配色（Google Maps / SVGデモ地図で共通）
// 選択エリア=オレンジ、未選択の境界=青い細線、円=赤
export const COLORS = {
  selFill: '#f97316',
  selStroke: '#ea580c',
  baseStroke: '#2a89b8',
  circle: '#ef1c1c',
  pin: '#e11d1d',
};

// 分断線（川・道路・線路）の描き方
export const BARRIER_STYLE = {
  river:    { color: '#2563eb', weight: 4, dashed: false },
  motorway: { color: '#475569', weight: 4, dashed: false },
  trunk:    { color: '#64748b', weight: 3, dashed: false },
  primary:  { color: '#94a3b8', weight: 2, dashed: false },
  railway:  { color: '#111827', weight: 2.5, dashed: true },
};
