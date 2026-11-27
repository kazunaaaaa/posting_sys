// 顧客データ（CSV）の読み取り。ファイルはブラウザの中だけで読み、サーバーへは住所（都道府県・住所）だけを送る。
// 氏名・電話番号・生年月日などは送らない・保存しない。

/** ファイルの文字コード（UTF-8 / Shift_JIS）を判定して文字列に */
export function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** CSV（引用符・改行入りセル対応）/ タブ区切り → 2次元配列 */
export function parseCsv(text) {
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const find = (header, res) => {
  for (const re of res) { const i = header.findIndex((h) => re.test(h.trim())); if (i >= 0) return i; }
  return -1;
};

/** 見出しから列を判定 */
export function detectColumns(header) {
  const cols = {
    pref: find(header, [/^都道府県(名)?$/]),
    address: find(header, [/^住所$/, /^(住所|所在地)[（(]?(全体|フル)?[)）]?$/, /^address$/i, /^所在地$/]),
    parts: ['住所1', '住所2', '住所3'].map((n) => header.findIndex((h) => h.trim() === n)).filter((i) => i >= 0),
    city: find(header, [/^市区町村(名)?$/]),
    town: find(header, [/^(町名|町域|番地|町丁目)/]),
    age: find(header, [/^年齢$/]),
    birth: find(header, [/生年月日/]),
    gender: find(header, [/^性別$/]),
    withdrawn: find(header, [/退会(手続き)?日/, /解約日/]),
    store: find(header, [/^(メンバー)?所属店舗名$/, /店舗名/]),
  };
  cols.ok = cols.address >= 0 || cols.parts.length > 0 || cols.city >= 0;
  return cols;
}

function ageFrom(birth) {
  const m = String(birth || '').normalize('NFKC').match(/(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (!m) return null;
  const b = new Date(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}

/** 行 → 顧客（i は元の行番号＝見出しが1行目） */
export function extractCustomers(rows, cols) {
  const out = [];
  rows.slice(1).forEach((r, k) => {
    const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    let address = get(cols.address);
    if (!address && cols.parts.length) address = cols.parts.map(get).join('');
    if (!address && cols.city >= 0) address = get(cols.city) + get(cols.town);
    if (!address) return;
    const ageCol = Number(get(cols.age));
    const g = get(cols.gender);
    out.push({
      i: k + 2,
      pref: get(cols.pref),
      address,
      age: Number.isFinite(ageCol) && get(cols.age) !== '' ? ageCol : ageFrom(get(cols.birth)),
      gender: /^(女|女性|f|female)$/i.test(g) ? 'female' : /^(男|男性|m|male)$/i.test(g) ? 'male' : null,
      withdrawn: !!get(cols.withdrawn),
      store: get(cols.store),
    });
  });
  return out;
}

/** 照合結果 → 町丁目ごとの人数（丁目が分からない顧客は、その町の丁目に均等に割り振る） */
export function aggregate(customers, match) {
  const byI = new Map((match?.results || []).map((r) => [r.i, r]));
  const byCode = {};
  let chome = 0, town = 0;
  const unmatched = [];
  for (const c of customers) {
    const r = byI.get(c.i);
    if (!r || !r.codes?.length) { unmatched.push({ i: c.i, text: `${c.pref}${c.address}`.replace(/[0-9０-９].*$/, ''), reason: r?.reason || '未照合' }); continue; }
    if (r.level === 'chome') chome++; else town++;
    for (const code of r.codes) byCode[code] = (byCode[code] || 0) + 1 / r.codes.length;
  }
  const markers = Object.entries(byCode).map(([code, n]) => {
    const t = match.towns[code];
    return { code, count: +n.toFixed(1), lat: t.lat, lng: t.lng, name: t.name, city: t.city, households: t.households };
  }).sort((a, b) => b.count - a.count);
  return { byCode, markers, total: customers.length, matched: chome + town, chome, town, unmatched };
}

function distKm(a, b) {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, a.lat - b.lat) * 111.32;
}

/** ピンからの距離で、顧客の p% が入る半径（町丁目の中心で近似） */
export function radiusPercentiles(markers, pin, ps = [0.5, 0.8, 0.9]) {
  if (!pin || !markers.length) return null;
  const list = markers.map((m) => ({ d: distKm(pin, m), n: m.count })).sort((a, b) => a.d - b.d);
  const total = list.reduce((s, x) => s + x.n, 0);
  const out = {};
  for (const p of ps) {
    let cum = 0;
    for (const x of list) { cum += x.n; if (cum >= total * p - 1e-9) { out[p] = Math.max(0.1, Math.ceil(x.d * 10) / 10); break; } }
  }
  return out;
}

/** 顧客の年齢から、ターゲット年齢（中央の80%を5歳単位で）と性別の傾向 */
export function suggestProfile(customers) {
  const ages = customers.map((c) => c.age).filter((a) => Number.isFinite(a)).sort((a, b) => a - b);
  if (ages.length < 5) return null;
  const q = (p) => ages[Math.min(ages.length - 1, Math.floor(p * (ages.length - 1)))];
  const min = Math.floor(q(0.1) / 5) * 5, max = Math.ceil((q(0.9) + 1) / 5) * 5 - 1;
  const g = customers.filter((c) => c.gender);
  const f = g.filter((c) => c.gender === 'female').length;
  const sex = g.length >= 5 ? (f / g.length >= 0.8 ? 'female' : f / g.length <= 0.2 ? 'male' : 'all') : null;
  return { ageMin: min, ageMax: max, median: q(0.5), count: ages.length, sex, genderKnown: g.length };
}
