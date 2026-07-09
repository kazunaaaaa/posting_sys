// 幾何ユーティリティ（ポリゴン内包判定・面積・重心・距離）

// 点がポリゴン内にあるか（ray casting）。polygon: [[lng,lat], ...]
export function pointInPolygon(lng, lat, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Haversine距離(m)
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ポリゴン重心（単純平均でなく面積重心）
export function centroid(polygon) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const f = xj * yi - xi * yj;
    area += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  area *= 0.5;
  if (area === 0) {
    const avg = polygon.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return { lng: avg[0] / polygon.length, lat: avg[1] / polygon.length };
  }
  return { lng: cx / (6 * area), lat: cy / (6 * area) };
}

// ポリゴンのおおよその面積(km^2)。緯度補正あり。
export function areaKm2(polygon) {
  const lat0 = centroid(polygon).lat;
  const mPerDegLat = 111132;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    area += xi * mPerDegLng * (yj * mPerDegLat) - xj * mPerDegLng * (yi * mPerDegLat);
  }
  return Math.abs(area / 2) / 1e6;
}

// バウンディングボックス
export function bbox(polygon) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of polygon) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}
