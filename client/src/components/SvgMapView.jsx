import { useMemo, useState } from 'react';

// Google Maps キー未設定時のフォールバック簡易地図（SVG）。
// polygons(複数リング) + points(クリック可能な候補重心) + competitors を等距離近似で投影。
function scoreColor(score) {
  if (score == null) return '#e5007e';
  const hue = (score / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

export default function SvgMapView({ polygons, points, competitors, businessIcon, onToggle, emptyHint }) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 640, pad = 44;

  const project = useMemo(() => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const acc = (lng, lat) => {
      minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat);
    };
    for (const p of polygons) for (const ring of p.rings) for (const [lng, lat] of ring) acc(lng, lat);
    for (const p of points) acc(p.lng, p.lat);
    for (const c of competitors) acc(c.lng, c.lat);
    if (!Number.isFinite(minLng)) return null;
    const latMid = (minLat + maxLat) / 2;
    const cosLat = Math.cos((latMid * Math.PI) / 180);
    const spanX = (maxLng - minLng) * cosLat || 0.01;
    const spanY = maxLat - minLat || 0.01;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    return (lng, lat) => ({
      x: offX + (lng - minLng) * cosLat * scale,
      y: H - (offY + (lat - minLat) * scale),
    });
  }, [polygons, points, competitors]);

  if (!project) {
    return <div className="mapempty">{emptyHint || 'エリアを選択してください'}</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#eef2f5' }}>
      <div className="svgmap-badge">デモ地図（Google Maps キー未設定）</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {/* 候補ポイント（クリックで選択） */}
        {points.map((p) => {
          const s = project(p.lng, p.lat);
          return (
            <g key={'pt-' + p.code} onClick={() => onToggle(p.code)} style={{ cursor: 'pointer' }}
               onMouseEnter={() => setHover({ ...p, kind: 'pt' })} onMouseLeave={() => setHover(null)}>
              <circle cx={s.x} cy={s.y} r={p.selected ? 7 : 5}
                fill={p.selected ? '#e5007e' : '#fff'} stroke="#e5007e" strokeWidth="1.6" />
            </g>
          );
        })}
        {/* ポリゴン */}
        {polygons.map((p) => {
          const isSel = p.selected;
          const c = p.center ? project(p.center.lng, p.center.lat) : null;
          return (
            <g key={'pg-' + p.code} onClick={() => onToggle(p.code)} style={{ cursor: 'pointer' }}
               onMouseEnter={() => setHover({ ...p, kind: 'pg' })} onMouseLeave={() => setHover(null)}>
              {p.rings.map((ring, i) => (
                <polygon key={i}
                  points={ring.map(([lng, lat]) => { const s = project(lng, lat); return `${s.x},${s.y}`; }).join(' ')}
                  fill={p.score != null ? scoreColor(p.score) : '#e5007e'}
                  fillOpacity={isSel ? (p.score != null ? 0.55 : 0.3) : 0.12}
                  stroke={p.best ? '#1d4ed8' : isSel ? '#e5007e' : '#9ca3af'}
                  strokeWidth={p.best ? 4 : isSel ? 2.4 : 1} />
              ))}
              {c && (
                <>
                  <text x={c.x} y={c.y} textAnchor="middle" fontSize="12" fontWeight="600" fill="#111" pointerEvents="none">{p.label}</text>
                  {p.score != null && <text x={c.x} y={c.y + 15} textAnchor="middle" fontSize="11" fill="#1d4ed8" fontWeight="700" pointerEvents="none">{p.score}点</text>}
                </>
              )}
            </g>
          );
        })}
        {/* 競合 */}
        {competitors.map((c) => {
          const s = project(c.lng, c.lat);
          return (
            <circle key={c.id} cx={s.x} cy={s.y} r={5.5} fill="#7c3aed" fillOpacity="0.85" stroke="#fff" strokeWidth="1.3">
              <title>{`${c.name}${c.rating ? ` ★${c.rating}` : ''}`}</title>
            </circle>
          );
        })}
      </svg>
      {hover && (
        <div className="svgmap-tooltip">
          <b>{hover.label || hover.name}</b>
          {hover.households != null && <><br />世帯 {hover.households.toLocaleString()} / 配布 {hover.distribution?.toLocaleString()}部</>}
          {hover.households == null && hover.kind && <><br />世帯数: e-Stat接続で取得</>}
        </div>
      )}
    </div>
  );
}
