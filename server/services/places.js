// 競合POI検索サービス
// 優先順: Google Places API (New) → OpenStreetMap Overpass(キー不要) → サンプル生成
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bbox, centroid, distanceMeters } from './geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let typesCache = null;
export function businessTypes() {
  if (!typesCache) {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'data', 'business-types.json'),
      'utf-8'
    );
    typesCache = JSON.parse(raw).categories;
  }
  return typesCache;
}

export function getBusinessType(id) {
  return businessTypes().find((t) => t.id === id);
}

function areaCenter(a) {
  return a.center ?? (a.polygon ? centroid(a.polygon) : { lat: a.lat, lng: a.lng });
}

function unionBbox(areas) {
  let b = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  for (const a of areas) {
    if (a.polygon) {
      const bb = bbox(a.polygon);
      b.minLng = Math.min(b.minLng, bb.minLng);
      b.minLat = Math.min(b.minLat, bb.minLat);
      b.maxLng = Math.max(b.maxLng, bb.maxLng);
      b.maxLat = Math.max(b.maxLat, bb.maxLat);
    } else {
      const c = areaCenter(a);
      // 重心のみの場合は約3km四方を仮定
      b.minLng = Math.min(b.minLng, c.lng - 0.03);
      b.minLat = Math.min(b.minLat, c.lat - 0.02);
      b.maxLng = Math.max(b.maxLng, c.lng + 0.03);
      b.maxLat = Math.max(b.maxLat, c.lat + 0.02);
    }
  }
  return b;
}

// ---- Google Places API (New): Nearby Search ----
async function fromGooglePlaces(bt, areas) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const b = unionBbox(areas);
  const center = { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
  const radius = Math.min(
    50000,
    distanceMeters(b.minLat, b.minLng, b.maxLat, b.maxLng) / 2 + 500
  );
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.formattedAddress',
      },
      body: JSON.stringify({
        includedTypes: bt.googlePlacesTypes,
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: center.lat, longitude: center.lng }, radius },
        },
        languageCode: 'ja',
      }),
    });
    if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return (json.places ?? []).map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? '(名称不明)',
      lat: p.location.latitude,
      lng: p.location.longitude,
      rating: p.rating ?? null,
      reviews: p.userRatingCount ?? null,
      address: p.formattedAddress ?? null,
      source: 'google',
    }));
  } catch (e) {
    console.warn('[places] google failed, fallback:', e.message);
    return null;
  }
}

// ---- OpenStreetMap Overpass API（キー不要フォールバック）----
async function fromOverpass(bt, areas) {
  const b = unionBbox(areas);
  const bboxStr = `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
  const parts = bt.overpass
    .map((t) => `nwr["${t.key}"="${t.value}"](${bboxStr});`)
    .join('\n');
  const query = `[out:json][timeout:25];(${parts});out center 60;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const json = await res.json();
    return (json.elements ?? [])
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) return null;
        return {
          id: `osm-${el.type}-${el.id}`,
          name: el.tags?.name ?? el.tags?.['name:ja'] ?? '(名称なし)',
          lat,
          lng,
          rating: null,
          reviews: null,
          address: el.tags?.['addr:full'] ?? null,
          source: 'osm',
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.warn('[places] overpass failed, fallback to sample:', e.message);
    return null;
  }
}

// ---- サンプル生成（オフライン/デモ用）----
// 業態IDとエリアから決定論的に競合を散布する。世帯密度が高いほど競合も多くする。
function sampleCompetitors(bt, areas) {
  const out = [];
  const seedBase = bt.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  for (const a of areas) {
    const c = areaCenter(a);
    const density = a.households || 3000;
    const count = Math.max(1, Math.round((density / 3000) * (2 + (seedBase % 3))));
    for (let i = 0; i < count; i++) {
      const seed = seedBase + a.code.charCodeAt(a.code.length - 1) + i * 7.3;
      const rand = (k) => {
        const x = Math.sin(seed * 51.13 + k * 27.7) * 43758.5453;
        return x - Math.floor(x);
      };
      out.push({
        id: `sample-${bt.id}-${a.code}-${i}`,
        name: `${bt.label.split('・')[0]} ${a.name}${i + 1}号店`,
        lat: +(c.lat + (rand(1) - 0.5) * 0.006).toFixed(6),
        lng: +(c.lng + (rand(2) - 0.5) * 0.008).toFixed(6),
        rating: +(3.2 + rand(3) * 1.7).toFixed(1),
        reviews: Math.round(5 + rand(4) * 180),
        address: `${a.pref}${a.city}${a.name}`,
        source: 'sample',
      });
    }
  }
  return out;
}

export async function searchCompetitors(businessTypeId, areas) {
  const bt = getBusinessType(businessTypeId);
  if (!bt) throw new Error(`unknown business type: ${businessTypeId}`);
  if (!areas.length) return { source: 'none', businessType: bt, competitors: [] };

  let competitors = await fromGooglePlaces(bt, areas);
  let source = 'google';
  if (!competitors) {
    competitors = await fromOverpass(bt, areas);
    source = 'osm';
  }
  if (!competitors || competitors.length === 0) {
    competitors = sampleCompetitors(bt, areas);
    source = 'sample';
  }
  return { source, businessType: bt, competitors };
}
