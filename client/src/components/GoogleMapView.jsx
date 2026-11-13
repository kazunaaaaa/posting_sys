import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps.js';

function scoreColor(score) {
  if (score == null) return '#e5007e';
  const hue = (score / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

function polygonStyle(p) {
  return {
    strokeColor: p.best ? '#1d4ed8' : p.selected ? '#e5007e' : '#7b8494',
    strokeWeight: p.best ? 4 : p.selected ? 2.4 : 0.8,
    strokeOpacity: p.selected || p.best ? 0.95 : 0.6,
    fillColor: p.score != null ? scoreColor(p.score) : '#e5007e',
    fillOpacity: p.selected ? (p.score != null ? 0.5 : 0.35) : 0.06,
    zIndex: p.best ? 3 : p.selected ? 2 : 1,
  };
}

export default function GoogleMapView({
  apiKey, center, zoom, polygons, points, competitors, circles = [], onToggle, onApi, onCircleChange,
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const polyMapRef = useRef(new Map()); // code -> { poly, data }
  const pointsRef = useRef([]);
  const markersRef = useRef([]);
  const circlesRef = useRef({}); // id -> google.maps.Circle
  const infoRef = useRef(null);
  const geocoderRef = useRef(null);
  const [ready, setReady] = useState(false);
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
          clickableIcons: false,
        });
        geocoderRef.current = new maps.Geocoder();
        infoRef.current = new maps.InfoWindow({ disableAutoPan: true });
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
        setReady(true);
      })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // ポリゴン: コードごとに保持し、変化分のみ更新（数百区画でも軽快に）
  function syncPolygons() {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    const seen = new Set();
    const bounds = new maps.LatLngBounds();
    let hasBounds = false;

    for (const p of polygons) {
      seen.add(p.code);
      let entry = polyMapRef.current.get(p.code);
      if (!entry) {
        const paths = p.rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
        const poly = new maps.Polygon({ paths, map, ...polygonStyle(p) });
        entry = { poly, data: p };
        poly.addListener('click', () => onToggleRef.current(entry.data.code));
        poly.addListener('mouseover', () => {
          const d = entry.data;
          if (!d.center) return;
          const hh = d.households != null
            ? `世帯 ${d.households.toLocaleString()}<br>配布 ${d.distribution?.toLocaleString()}部`
            : '世帯数: e-Stat接続で取得';
          infoRef.current.setContent(
            `<div style="font-size:12px;line-height:1.5"><b>${d.label}</b><br>${hh}${d.score != null ? `<br>スコア ${d.score}点` : ''}</div>`
          );
          infoRef.current.setPosition({ lat: d.center.lat, lng: d.center.lng });
          infoRef.current.open(map);
        });
        poly.addListener('mouseout', () => infoRef.current.close());
        polyMapRef.current.set(p.code, entry);
      } else {
        const prev = entry.data;
        if (prev.selected !== p.selected || prev.score !== p.score || prev.best !== p.best) {
          entry.poly.setOptions(polygonStyle(p));
        }
        entry.data = p;
      }
      for (const ring of p.rings) for (const [lng, lat] of ring) { bounds.extend({ lat, lng }); hasBounds = true; }
    }
    for (const [code, entry] of polyMapRef.current) {
      if (!seen.has(code)) { entry.poly.setMap(null); polyMapRef.current.delete(code); }
    }

    // 読み込んだ区画の集合が変わったときだけ表示範囲を合わせる
    const fitKey = polygons.length ? `${polygons.length}:${polygons[0].code}:${polygons[polygons.length - 1].code}` : '';
    if (hasBounds && fitKey !== map.__fitKey) { map.fitBounds(bounds); map.__fitKey = fitKey; }
    return { bounds, hasBounds };
  }

  function syncMarkers() {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    pointsRef.current.forEach((m) => m.setMap(null));
    markersRef.current.forEach((m) => m.setMap(null));
    pointsRef.current = [];
    markersRef.current = [];

    const bounds = new maps.LatLngBounds();
    for (const p of points) {
      const marker = new maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map,
        icon: { path: maps.SymbolPath.CIRCLE, scale: p.selected ? 7 : 5,
          fillColor: p.selected ? '#e5007e' : '#ffffff', fillOpacity: 1, strokeColor: '#e5007e', strokeWeight: 1.6 },
        title: p.label,
      });
      marker.addListener('click', () => onToggleRef.current(p.code));
      pointsRef.current.push(marker);
      bounds.extend({ lat: p.lat, lng: p.lng });
    }
    // 候補点だけのとき（市区町村モードで未選択）は候補点に合わせる
    const ptKey = points.length && !polygons.length ? `pt:${points.length}:${points[0].code}` : '';
    if (ptKey && ptKey !== map.__ptKey) { map.fitBounds(bounds); map.__ptKey = ptKey; }

    for (const c of competitors) {
      const marker = new maps.Marker({
        position: { lat: c.lat, lng: c.lng }, map, zIndex: 10,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#7c3aed', fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 1.3 },
        title: `${c.name}${c.rating ? ` ★${c.rating}` : ''}`,
      });
      markersRef.current.push(marker);
    }
  }

  // 円の描画・同期（移動/半径変更可）
  function syncCircles() {
    const maps = window.google?.maps;
    if (!maps || !mapRef.current) return;
    const seen = new Set();
    for (const c of circles) {
      seen.add(c.id);
      let circle = circlesRef.current[c.id];
      if (!circle) {
        circle = new maps.Circle({
          map: mapRef.current, center: { lat: c.lat, lng: c.lng }, radius: c.radiusKm * 1000,
          strokeColor: '#e5007e', strokeWeight: 2, fillColor: '#e5007e', fillOpacity: 0.06,
          editable: true, draggable: true, clickable: false, zIndex: 5,
        });
        const sync = () => {
          const ctr = circle.getCenter();
          onCircleChangeRef.current?.(c.id, { lat: ctr.lat(), lng: ctr.lng(), radiusKm: +(circle.getRadius() / 1000).toFixed(2) });
        };
        circle.addListener('dragend', sync);
        circle.addListener('center_changed', sync); // 中心ハンドルでの移動
        circle.addListener('radius_changed', sync);
        circlesRef.current[c.id] = circle;
      } else {
        const ctr = circle.getCenter();
        if (Math.abs(ctr.lat() - c.lat) > 1e-9 || Math.abs(ctr.lng() - c.lng) > 1e-9) circle.setCenter({ lat: c.lat, lng: c.lng });
        if (Math.abs(circle.getRadius() - c.radiusKm * 1000) > 0.5) circle.setRadius(c.radiusKm * 1000);
      }
    }
    for (const id of Object.keys(circlesRef.current)) {
      if (!seen.has(id)) { circlesRef.current[id].setMap(null); delete circlesRef.current[id]; }
    }
  }

  useEffect(() => { if (ready) syncPolygons(); /* eslint-disable-next-line */ }, [ready, polygons]);
  useEffect(() => { if (ready) syncMarkers(); /* eslint-disable-next-line */ }, [ready, points, competitors, polygons.length]);
  useEffect(() => { if (ready) syncCircles(); /* eslint-disable-next-line */ }, [ready, circles]);

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
