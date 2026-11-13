import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps.js';

function scoreColor(score) {
  if (score == null) return '#e5007e';
  const hue = (score / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

export default function GoogleMapView({
  apiKey, center, zoom, polygons, points, competitors, circles = [], onToggle, onApi, onCircleChange,
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const polysRef = useRef([]);
  const pointsRef = useRef([]);
  const markersRef = useRef([]);
  const circlesRef = useRef({}); // id -> google.maps.Circle
  const geocoderRef = useRef(null);
  const [loadError, setLoadError] = useState(false);
  const onToggleRef = useRef(onToggle);
  const onCircleChangeRef = useRef(onCircleChange);
  onToggleRef.current = onToggle;
  onCircleChangeRef.current = onCircleChange;

  useEffect(() => {
    let alive = true;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (!alive || mapRef.current) return;
        mapRef.current = new maps.Map(ref.current, {
          center: center || { lat: 35.68, lng: 139.76 },
          zoom: zoom || 11,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
          gestureHandling: 'greedy',
        });
        geocoderRef.current = new maps.Geocoder();
        // 地図操作APIを親へ公開
        onApi?.({
          getCenter: () => {
            const c = mapRef.current.getCenter();
            return { lat: c.lat(), lng: c.lng() };
          },
          panTo: (ll, z) => { mapRef.current.panTo(ll); if (z) mapRef.current.setZoom(z); },
          geocode: (address) =>
            new Promise((resolve, reject) => {
              geocoderRef.current.geocode({ address, region: 'jp' }, (res, status) => {
                if (status === 'OK' && res[0]) {
                  const loc = res[0].geometry.location;
                  resolve({ lat: loc.lat(), lng: loc.lng(), formatted: res[0].formatted_address });
                } else reject(new Error(status));
              });
            }),
        });
        draw();
        drawCircles();
      })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  function clear(ref) { ref.current.forEach((o) => o.setMap(null)); ref.current = []; }

  function draw() {
    const maps = window.google?.maps;
    if (!maps || !mapRef.current) return;
    const map = mapRef.current;
    clear(polysRef); clear(pointsRef); clear(markersRef);
    const bounds = new maps.LatLngBounds();
    let hasBounds = false;

    for (const p of polygons) {
      const paths = p.rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
      paths.flat().forEach((pt) => { bounds.extend(pt); hasBounds = true; });
      const poly = new maps.Polygon({
        paths, map,
        strokeColor: p.best ? '#1d4ed8' : p.selected ? '#e5007e' : '#9ca3af',
        strokeWeight: p.best ? 4 : p.selected ? 2.4 : 1,
        strokeOpacity: 0.85,
        fillColor: p.score != null ? scoreColor(p.score) : '#e5007e',
        fillOpacity: p.selected ? (p.score != null ? 0.5 : 0.28) : 0.12,
      });
      poly.addListener('click', () => onToggleRef.current(p.code));
      const info = new maps.InfoWindow();
      poly.addListener('mouseover', () => {
        if (!p.center) return;
        info.setPosition({ lat: p.center.lat, lng: p.center.lng });
        const hh = p.households != null ? `世帯 ${p.households.toLocaleString()}<br>配布 ${p.distribution?.toLocaleString()}部` : '世帯数: e-Stat接続で取得';
        info.setContent(`<div style="font-size:12px"><b>${p.label}</b><br>${hh}${p.score != null ? `<br>スコア ${p.score}点` : ''}</div>`);
        info.open(map);
      });
      poly.addListener('mouseout', () => info.close());
      polysRef.current.push(poly);
    }

    for (const p of points) {
      const marker = new maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map,
        icon: { path: maps.SymbolPath.CIRCLE, scale: p.selected ? 7 : 5,
          fillColor: p.selected ? '#e5007e' : '#ffffff', fillOpacity: 1, strokeColor: '#e5007e', strokeWeight: 1.6 },
        title: p.label,
      });
      marker.addListener('click', () => onToggleRef.current(p.code));
      pointsRef.current.push(marker);
      if (!hasBounds) { bounds.extend({ lat: p.lat, lng: p.lng }); }
    }

    for (const c of competitors) {
      const marker = new maps.Marker({
        position: { lat: c.lat, lng: c.lng }, map,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#7c3aed', fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 1.3 },
        title: `${c.name}${c.rating ? ` ★${c.rating}` : ''}`,
      });
      markersRef.current.push(marker);
    }

    if ((polygons.length || points.length)) {
      const key = polygons.map((p) => p.code).join(',') + '|' + points.length;
      if (key !== mapRef.current.__lastFitKey) { map.fitBounds(bounds); mapRef.current.__lastFitKey = key; }
    }
  }

  // 円の描画・同期（移動/半径変更可）
  function drawCircles() {
    const maps = window.google?.maps;
    if (!maps || !mapRef.current) return;
    const seen = new Set();
    for (const c of circles) {
      seen.add(c.id);
      let circle = circlesRef.current[c.id];
      if (!circle) {
        circle = new maps.Circle({
          map: mapRef.current, center: { lat: c.lat, lng: c.lng }, radius: c.radiusKm * 1000,
          strokeColor: '#e5007e', strokeWeight: 2, fillColor: '#e5007e', fillOpacity: 0.08,
          editable: true, draggable: true, clickable: false,
        });
        const sync = () => {
          const ctr = circle.getCenter();
          onCircleChangeRef.current?.(c.id, { lat: ctr.lat(), lng: ctr.lng(), radiusKm: circle.getRadius() / 1000 });
        };
        circle.addListener('center_changed', sync);
        circle.addListener('radius_changed', sync);
        circlesRef.current[c.id] = circle;
      } else {
        circle.setCenter({ lat: c.lat, lng: c.lng });
        circle.setRadius(c.radiusKm * 1000);
      }
    }
    // 削除された円を除去
    for (const id of Object.keys(circlesRef.current)) {
      if (!seen.has(id)) { circlesRef.current[id].setMap(null); delete circlesRef.current[id]; }
    }
  }

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [polygons, points, competitors]);
  useEffect(() => { drawCircles(); /* eslint-disable-next-line */ }, [circles]);

  if (loadError) {
    return (
      <div className="mapempty" style={{ flexDirection: 'column', gap: 8, padding: 24, textAlign: 'center' }}>
        <b>Google Mapsの読み込みに失敗しました</b>
        <span style={{ fontSize: 13 }}>
          GOOGLE_MAPS_API_KEY を確認してください（Maps JavaScript API の有効化・課金設定・リファラ制限）。
        </span>
      </div>
    );
  }
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
