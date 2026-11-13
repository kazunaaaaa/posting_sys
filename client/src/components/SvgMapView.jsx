import { useEffect, useMemo, useState } from 'react';
import { COLORS, BARRIER_STYLE } from '../lib/colors.js';

// Google Maps キー未設定時のフォールバック簡易地図（SVG）。
// polygons(複数リング) + points(候補重心) + competitors + circles(範囲円) を等距離近似で投影。
function scoreColor(score) {
  if (score == null) return COLORS.selFill;
  const hue = (score / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

export default function SvgMapView({
  polygons, points, competitors, circles = [], pin = null, pinLabel = '', barriers = [], businessIcon, onToggle, onApi, emptyHint,
}) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 640, pad = 44;

  const proj = useMemo(() => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const acc = (lng, lat) => {
      minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat);
    };
    for (const p of polygons) for (const ring of p.rings) for (const [lng, lat] of ring) acc(lng, lat);
    for (const p of points) acc(p.lng, p.lat);
    for (const c of competitors) acc(c.lng, c.lat);
    for (const c of circles) acc(c.lng, c.lat);
    if (pin) acc(pin.lng, pin.lat);
    if (!Number.isFinite(minLng)) return null;
    const latMid = (minLat + maxLat) / 2;
    const cosLat = Math.cos((latMid * Math.PI) / 180);
    const spanX = (maxLng - minLng) * cosLat || 0.01;
    const spanY = maxLat - minLat || 0.01;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    const project = (lng, lat) => ({
      x: offX + (lng - minLng) * cosLat * scale,
      y: H - (offY + (lat - minLat) * scale),
    });
    const mToPx = scale / 111320; // メートル→ピクセル（緯度基準の近似）
    return { project, mToPx, center: { lat: latMid, lng: (minLng + maxLng) / 2 } };
  }, [polygons, points, competitors, circles, pin]);

  // 地図API（中心取得）を親へ公開。SVGは住所ジオコーディング非対応。
  useEffect(() => {
    onApi?.({
      getCenter: () => proj?.center ?? { lat: 35.68, lng: 139.76 },
      panTo: () => {},
      geocode: null,
    });
  }, [proj, onApi]);

  if (!proj) return <div className="mapempty">{emptyHint || 'エリアを選択してください'}</div>;
  const { project, mToPx } = proj;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#eef2f5' }}>
      <div className="svgmap-badge">デモ地図（Google Maps キー未設定）</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {points.map((p) => {
          const s = project(p.lng, p.lat);
          return (
            <g key={'pt-' + p.code} onClick={() => onToggle(p.code)} style={{ cursor: 'pointer' }}
               onMouseEnter={() => setHover({ ...p, kind: 'pt' })} onMouseLeave={() => setHover(null)}>
              <circle cx={s.x} cy={s.y} r={p.selected ? 7 : 5}
                fill={p.selected ? COLORS.selFill : '#fff'} stroke={COLORS.selStroke} strokeWidth="1.6" />
            </g>
          );
        })}
        {polygons.map((p) => {
          const isSel = p.selected;
          const c = p.center ? project(p.center.lng, p.center.lat) : null;
          return (
            <g key={'pg-' + p.code} onClick={() => onToggle(p.code)} style={{ cursor: 'pointer' }}
               onMouseEnter={() => setHover({ ...p, kind: 'pg' })} onMouseLeave={() => setHover(null)}>
              {p.rings.map((ring, i) => (
                <polygon key={i}
                  points={ring.map(([lng, lat]) => { const s = project(lng, lat); return `${s.x},${s.y}`; }).join(' ')}
                  fill={p.score != null ? scoreColor(p.score) : COLORS.selFill}
                  fillOpacity={isSel ? (p.score != null ? 0.55 : 0.45) : 0.03}
                  stroke={p.best ? '#1d4ed8' : isSel ? COLORS.selStroke : COLORS.baseStroke}
                  strokeOpacity={isSel || p.best ? 1 : 0.7}
                  strokeWidth={p.best ? 4 : isSel ? 2 : polygons.length > 60 ? 0.6 : 1} />
              ))}
              {c && (isSel || p.best || polygons.length <= 60) && (
                <>
                  <text x={c.x} y={c.y} textAnchor="middle" fontSize="12" fontWeight="600" fill="#111" pointerEvents="none">{p.label}</text>
                  {p.score != null && <text x={c.x} y={c.y + 15} textAnchor="middle" fontSize="11" fill="#1d4ed8" fontWeight="700" pointerEvents="none">{p.score}点</text>}
                </>
              )}
            </g>
          );
        })}
        {/* 分断線（川・道路・線路） */}
        {barriers.map((b, i) => {
          const st = BARRIER_STYLE[b.type] || BARRIER_STYLE.primary;
          return (
            <polyline key={'bar-' + i} pointerEvents="none" fill="none"
              points={b.coords.map(([lng, lat]) => { const q = project(lng, lat); return `${q.x},${q.y}`; }).join(' ')}
              stroke={st.color} strokeWidth={st.weight * 0.8} strokeOpacity="0.85" strokeDasharray={st.dashed ? '5 4' : undefined} />
          );
        })}
        {/* 範囲円 */}
        {circles.map((c) => {
          const s = project(c.lng, c.lat);
          return (
            <circle key={'cir-' + c.id} cx={s.x} cy={s.y} r={Math.max(4, c.radiusKm * 1000 * mToPx)}
              fill={COLORS.circle} fillOpacity="0.04" stroke={COLORS.circle} strokeWidth="2.5" pointerEvents="none" />
          );
        })}
        {competitors.map((c) => {
          const s = project(c.lng, c.lat);
          return (
            <circle key={c.id} cx={s.x} cy={s.y} r={5.5} fill="#7c3aed" fillOpacity="0.85" stroke="#fff" strokeWidth="1.3">
              <title>{`${c.name}${c.rating ? ` ★${c.rating}` : ''}`}</title>
            </circle>
          );
        })}
        {/* 中心地のピン */}
        {pin && (() => {
          const s = project(pin.lng, pin.lat);
          return (
            <g pointerEvents="none">
              <path d={`M ${s.x} ${s.y} C ${s.x - 2} ${s.y - 10} ${s.x - 9} ${s.y - 13} ${s.x - 9} ${s.y - 19} A 9 9 0 1 1 ${s.x + 9} ${s.y - 19} C ${s.x + 9} ${s.y - 13} ${s.x + 2} ${s.y - 10} ${s.x} ${s.y} Z`}
                fill={COLORS.pin} stroke="#7f1010" strokeWidth="1.2" />
              <circle cx={s.x} cy={s.y - 19} r="3.4" fill="#7f1010" />
              {pinLabel && <text x={s.x} y={s.y + 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="#111"
                stroke="#fff" strokeWidth="3" paintOrder="stroke">{pinLabel}</text>}
            </g>
          );
        })()}
      </svg>
      {hover && (
        <div className="svgmap-tooltip">
          <b>{hover.fullName || hover.label || hover.name}</b>
          {hover.households != null && <><br />世帯 {hover.households.toLocaleString()} / 配布 {hover.distribution?.toLocaleString()}部</>}
          {hover.households == null && hover.kind && <><br />世帯数: e-Stat接続で取得</>}
        </div>
      )}
    </div>
  );
}
