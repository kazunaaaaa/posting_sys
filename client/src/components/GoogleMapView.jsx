import { useEffect, useRef } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps.js';

function scoreColor(score) {
  if (score == null) return '#e5007e';
  const hue = (score / 100) * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

export default function GoogleMapView({ apiKey, center, zoom, polygons, points, competitors, onToggle }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const polysRef = useRef([]);
  const pointsRef = useRef([]);
  const markersRef = useRef([]);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    let alive = true;
    loadGoogleMaps(apiKey).then((maps) => {
      if (!alive || mapRef.current) return;
      mapRef.current = new maps.Map(ref.current, {
        center: center || { lat: 35.68, lng: 139.76 },
        zoom: zoom || 11,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      });
      draw();
    });
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

    if ((polygons.length || points.length) && !mapRef.current.__fittedKey) {
      const key = polygons.map((p) => p.code).join(',') + '|' + points.length;
      if (key !== mapRef.current.__lastFitKey) { map.fitBounds(bounds); mapRef.current.__lastFitKey = key; }
    }
  }

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [polygons, points, competitors]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
