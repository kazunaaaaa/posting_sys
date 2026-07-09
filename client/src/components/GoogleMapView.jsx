import { useEffect, useRef } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps.js';

// スコアに応じた色（0-100） 赤(低)→黄→緑(高)
function scoreColor(score) {
  if (score == null) return '#f59e0b';
  const hue = (score / 100) * 120; // 0=red,120=green
  return `hsl(${hue}, 80%, 45%)`;
}

export default function GoogleMapView({
  apiKey,
  center,
  zoom,
  areas,
  selected,
  competitors,
  scoreByCode,
  bestCode,
  businessIcon,
  onToggle,
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const polysRef = useRef({});
  const markersRef = useRef([]);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  // 初期化
  useEffect(() => {
    let alive = true;
    loadGoogleMaps(apiKey).then((maps) => {
      if (!alive || mapRef.current) return;
      mapRef.current = new maps.Map(ref.current, {
        center,
        zoom,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      drawPolygons(maps);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  function drawPolygons(maps) {
    const map = mapRef.current;
    Object.values(polysRef.current).forEach((p) => p.setMap(null));
    polysRef.current = {};
    const bounds = new maps.LatLngBounds();
    for (const a of areas) {
      const path = a.polygon.map(([lng, lat]) => ({ lat, lng }));
      path.forEach((p) => bounds.extend(p));
      const poly = new maps.Polygon({
        paths: path,
        map,
        strokeColor: '#e5007e',
        strokeOpacity: 0.8,
        strokeWeight: 1.5,
        fillColor: '#e5007e',
        fillOpacity: 0.12,
      });
      poly.addListener('click', () => onToggleRef.current(a.code));
      const info = new maps.InfoWindow();
      poly.addListener('mouseover', () => {
        info.setPosition({ lat: a.center.lat, lng: a.center.lng });
        info.setContent(
          `<div style="font-size:12px"><b>${a.name}</b><br>世帯 ${a.households.toLocaleString()}<br>配布 ${a.distribution.toLocaleString()}部</div>`
        );
        info.open(map);
      });
      poly.addListener('mouseout', () => info.close());
      polysRef.current[a.code] = poly;
    }
    if (areas.length && !mapRef.current.__fitted) {
      map.fitBounds(bounds);
      mapRef.current.__fitted = true;
    }
    updateStyles();
  }

  function updateStyles() {
    for (const a of areas) {
      const poly = polysRef.current[a.code];
      if (!poly) continue;
      const isSel = selected.includes(a.code);
      const score = scoreByCode?.[a.code];
      const isBest = a.code === bestCode;
      poly.setOptions({
        fillColor: score != null ? scoreColor(score) : '#e5007e',
        fillOpacity: isSel ? (score != null ? 0.55 : 0.35) : 0.1,
        strokeColor: isBest ? '#1d4ed8' : isSel ? '#e5007e' : '#9ca3af',
        strokeWeight: isBest ? 4 : isSel ? 2.5 : 1,
      });
    }
  }

  // areas 変化時に再描画
  useEffect(() => {
    if (mapRef.current && window.google?.maps) drawPolygons(window.google.maps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  // 選択/スコア変化でスタイル更新
  useEffect(() => {
    if (mapRef.current) updateStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, scoreByCode, bestCode]);

  // 競合マーカー
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    const maps = window.google.maps;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    for (const c of competitors) {
      const marker = new maps.Marker({
        position: { lat: c.lat, lng: c.lng },
        map: mapRef.current,
        label: { text: businessIcon || '📍', fontSize: '16px' },
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#7c3aed',
          fillOpacity: 0.9,
          strokeColor: '#fff',
          strokeWeight: 1.5,
        },
        title: `${c.name}${c.rating ? ` ★${c.rating}` : ''}`,
      });
      markersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitors]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
