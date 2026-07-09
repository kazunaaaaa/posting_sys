import { useMemo, useState } from 'react';

// Google Maps キー未設定時のフォールバック簡易地図（SVG）。
// 緯度経度を等距離近似でスクリーン座標へ投影し、ポリゴンと競合を描画する。
function scoreColor(score) {
  if (score == null) return '#e5007e';
  const hue = (score / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

export default function SvgMapView({
  areas,
  selected,
  competitors,
  scoreByCode,
  bestCode,
  businessIcon,
  onToggle,
}) {
  const [hover, setHover] = useState(null);
  const W = 900;
  const H = 640;
  const pad = 40;

  const { project, bounds } = useMemo(() => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const a of areas) {
      for (const [lng, lat] of a.polygon) {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    }
    const latMid = (minLat + maxLat) / 2;
    const cosLat = Math.cos((latMid * Math.PI) / 180);
    const spanX = (maxLng - minLng) * cosLat || 1;
    const spanY = maxLat - minLat || 1;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    const project = (lng, lat) => ({
      x: offX + (lng - minLng) * cosLat * scale,
      y: H - (offY + (lat - minLat) * scale),
    });
    return { project, bounds: { minLng, minLat, maxLng, maxLat } };
  }, [areas]);

  if (!areas.length) return <div style={{ padding: 40 }}>エリア読み込み中…</div>;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#eef2f5' }}>
      <div className="svgmap-badge">デモ地図（Google Maps キー未設定）</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%' }}
      >
        {areas.map((a) => {
          const pts = a.polygon.map(([lng, lat]) => project(lng, lat));
          const d = pts.map((p) => `${p.x},${p.y}`).join(' ');
          const isSel = selected.includes(a.code);
          const score = scoreByCode?.[a.code];
          const isBest = a.code === bestCode;
          const c = project(a.center.lng, a.center.lat);
          return (
            <g key={a.code} onClick={() => onToggle(a.code)} style={{ cursor: 'pointer' }}
               onMouseEnter={() => setHover(a.code)} onMouseLeave={() => setHover(null)}>
              <polygon
                points={d}
                fill={score != null ? scoreColor(score) : '#e5007e'}
                fillOpacity={isSel ? (score != null ? 0.55 : 0.32) : hover === a.code ? 0.2 : 0.08}
                stroke={isBest ? '#1d4ed8' : isSel ? '#e5007e' : '#9ca3af'}
                strokeWidth={isBest ? 4 : isSel ? 2.5 : 1}
              />
              <text x={c.x} y={c.y} textAnchor="middle" fontSize="12" fontWeight="600" fill="#111" pointerEvents="none">
                {a.name}
              </text>
              {score != null && (
                <text x={c.x} y={c.y + 15} textAnchor="middle" fontSize="11" fill="#1d4ed8" fontWeight="700" pointerEvents="none">
                  {score}点
                </text>
              )}
            </g>
          );
        })}
        {competitors.map((c) => {
          const p = project(c.lng, c.lat);
          return (
            <g key={c.id}>
              <circle cx={p.x} cy={p.y} r={6} fill="#7c3aed" fillOpacity="0.85" stroke="#fff" strokeWidth="1.5">
                <title>{`${c.name}${c.rating ? ` ★${c.rating}` : ''}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        const a = areas.find((x) => x.code === hover);
        return (
          <div className="svgmap-tooltip">
            <b>{a.name}</b><br />世帯 {a.households.toLocaleString()} / 配布 {a.distribution.toLocaleString()}部
          </div>
        );
      })()}
    </div>
  );
}
