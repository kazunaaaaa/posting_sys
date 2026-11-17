// 貼り付けたエリア表（Excel・スプレッドシートからのコピー）を読み取り、町丁目に照合する
//   例: 都道府県 / 市区町村 / 町丁目名 / 一般世帯数 / 配布予定数（列の順番・有無は自由）
//   表の上の1セルだけの行（例「坂戸市北峰183-2」）は中心地の住所として扱う
import { allMunicipalities } from './estat.js';
import { getTowns } from './towns.js';
import { townLabel } from './exportArea.js';

const PREF_RE = /^(北海道|東京都|京都府|大阪府|.{2,3}県)$/;
const PREF_PREFIX_RE = /^(北海道|東京都|京都府|大阪府|.{2,3}?県)(.+)$/;
const NUM_RE = /^[-+]?[0-9０-９,，]+(\.[0-9]+)?$/;

const nfkc = (s) => String(s ?? '').normalize('NFKC').trim();
const toNum = (s) => {
  const n = Number(nfkc(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// 見出しの判定
function headerRole(cell) {
  const c = nfkc(cell);
  if (/都道府県/.test(c)) return 'pref';
  if (/市区町村|市町村|自治体/.test(c)) return 'city';
  if (/町丁|町名|丁目|エリア名|地区|地域|住所/.test(c)) return 'town';
  if (/配布|部数/.test(c)) return 'copies';
  if (/世帯/.test(c)) return 'households';
  return null;
}

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(',')) return line.split(',');
  return line.trim().split(/\s{2,}|\s+(?=[0-9０-９])/); // 空白区切り（町名の中の空白は残す）
}

/**
 * @returns {{ rows: Array<{line:number, pref:string, city:string, town:string, households:number|null, copies:number|null}>, address: string|null, columns: object|null }}
 */
export function parseAreaTable(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let columns = null;
  let address = null;
  const rows = [];
  let lastPref = '', lastCity = '';
  lines.forEach((raw, idx) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw).map(nfkc);
    const filled = cells.filter(Boolean);
    if (!filled.length) return;

    // 見出し行
    const roles = cells.map(headerRole);
    if (roles.filter(Boolean).length >= 2 && !cells.some((c) => NUM_RE.test(c))) {
      columns = {};
      roles.forEach((r, i) => { if (r && columns[r] == null) columns[r] = i; });
      return;
    }
    // 表より上の1セルだけの行 → 住所
    if (!rows.length && !columns && filled.length === 1 && !NUM_RE.test(filled[0])) {
      address = address || filled[0];
      return;
    }
    if (filled.length === 1 && !rows.length && columns) { address = address || filled[0]; return; }

    let pref = '', city = '', town = '', households = null, copies = null;
    if (columns && columns.town != null) {
      pref = cells[columns.pref] || '';
      city = cells[columns.city] || '';
      town = cells[columns.town] || '';
      households = columns.households != null ? toNum(cells[columns.households]) : null;
      copies = columns.copies != null ? toNum(cells[columns.copies]) : null;
    } else {
      // 見出しなし: 数字の列 = 世帯数・部数、文字の列 = 都道府県・市区町村・町丁目
      const nums = [], texts = [];
      for (const c of cells) {
        if (!c) continue;
        if (NUM_RE.test(c)) nums.push(toNum(c)); else texts.push(c);
      }
      if (texts.length && PREF_RE.test(texts[0])) pref = texts.shift();
      if (texts.length >= 2) { city = texts[0]; town = texts[1]; } else town = texts[0] || '';
      households = nums[0] ?? null;
      copies = nums[1] ?? null;
    }
    // 「埼玉県坂戸市」のように1セルに入っている場合
    const m = city.match(PREF_PREFIX_RE);
    if (!pref && m && /[市区町村郡]/.test(m[2])) { pref = m[1]; city = m[2]; }
    if (!town) return;
    if (/^(合計|計|小計|総計)$/.test(town)) return;
    pref = pref || (city ? '' : lastPref);
    city = city || lastCity;
    if (pref) lastPref = pref;
    if (city) lastCity = city;
    rows.push({ line: idx + 1, pref, city, town, households, copies });
  });
  return { rows, address, columns };
}

// ---- 市区町村の特定 ----
const cityKey = (s) => nfkc(s).replace(/\s+/g, '').replace(/ヶ/g, 'ケ');

/** 都道府県名（任意）と市区町村名 → 市区町村コード（政令市は区の一覧） */
export function resolveCity(pref, city) {
  const list = allMunicipalities();
  const ck = cityKey(city);
  if (!ck) return { codes: [], error: '市区町村名がありません' };
  let cands = list.filter((m) => cityKey(m.city) === ck);
  // 区だけ（「南区」）や、政令市の名前だけ（「横浜市」→全区）
  if (!cands.length) cands = list.filter((m) => cityKey(m.city).endsWith(ck) && /区$/.test(ck));
  if (pref) cands = cands.filter((m) => m.pref === nfkc(pref));
  if (!cands.length) return { codes: [], error: `市区町村「${pref}${city}」が見つかりません` };
  // 同名が複数の都道府県にある（府中市など）
  const prefs = [...new Set(cands.map((m) => m.pref))];
  const note = prefs.length > 1 ? `「${city}」は${prefs.join('・')}にあります（${prefs[0]}として読み込み。都道府県の列を入れると確実です）` : null;
  cands = cands.filter((m) => m.pref === prefs[0]);
  const out = [];
  for (const m of cands) {
    const wards = list.filter((w) => w.code !== m.code && w.pref === m.pref && cityKey(w.city).startsWith(cityKey(m.city)) && /区$/.test(w.city));
    if (wards.length) out.push(...wards); else out.push(m);
  }
  return { codes: [...new Set(out.map((m) => m.code))], name: `${cands[0].pref}${cands[0].city}`, note };
}

// ---- 町丁目名の照合 ----
// 「南林間一丁目」「南林間1丁目」「南林間(1)」「南林間１」→ 同じキー
export function townKey(name, { loose = false } = {}) {
  let s = nfkc(name).replace(/\s+/g, '');
  s = s.replace(/^(大字|字)/, '');
  s = townLabel(s);                                  // 〇丁目 → (n)
  s = s.replace(/^(.*?[^0-9])([0-9]+)$/, '$1($2)');   // 末尾の数字 → (n)
  s = s.replace(/[（]/g, '(').replace(/[）]/g, ')');
  if (loose) s = s.replace(/[ヶケが]/g, 'ケ').replace(/[ノの之]/g, 'の').replace(/[ツっ]/g, 'つ').replace(/[ー－‐]/g, '-');
  return s;
}

/**
 * 貼り付けた行を町丁目に照合する
 * @returns {{ matched: Array<{line, input, codes, names, households, copies}>, unmatched: Array<{line,input,reason}>, cityCodes: string[], notes: string[] }}
 */
export async function matchAreaTable(rows, { loadTowns = getTowns } = {}) {
  const notes = [];
  const unmatched = [];
  // 市区町村ごとにまとめる
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.pref}|${r.city}`;
    if (!groups.has(key)) groups.set(key, { pref: r.pref, city: r.city, rows: [] });
    groups.get(key).rows.push(r);
  }
  const matched = [];
  const cityCodes = new Set();
  for (const g of groups.values()) {
    const rc = resolveCity(g.pref, g.city);
    if (rc.note) notes.push(rc.note);
    if (!rc.codes.length) { for (const r of g.rows) unmatched.push({ line: r.line, input: `${r.city} ${r.town}`, reason: rc.error }); continue; }
    const towns = [];
    for (const code of rc.codes) {
      try { towns.push(...(await loadTowns(code)).towns); cityCodes.add(code); }
      catch (e) { notes.push(`${rc.name}（${code}）の町丁目を読み込めませんでした: ${e.message}`); }
    }
    if (!towns.length) { for (const r of g.rows) unmatched.push({ line: r.line, input: `${r.city} ${r.town}`, reason: '町丁目データを読み込めませんでした' }); continue; }

    const index = (loose) => {
      const m = new Map();
      for (const t of towns) {
        for (const k of new Set([townKey(t.name, { loose }), townKey(townLabel(t.name), { loose })])) {
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(t);
        }
      }
      return m;
    };
    const exact = index(false), loose = index(true);
    const pick = (r) => {
      const k = townKey(r.town), kl = townKey(r.town, { loose: true });
      return exact.get(k) || loose.get(kl) || null;
    };

    // 1回目: 完全一致（表記ゆれ込み）
    const used = new Set();
    const pending = [];
    for (const r of g.rows) {
      const hit = pick(r);
      if (hit) { hit.forEach((t) => used.add(t.code)); matched.push(entry(r, hit)); }
      else pending.push(r);
    }
    // 2回目: 丁目の無い町名（「泉町」）→ 他の行で指定されていない丁目すべて（「泉町(1)」など）
    for (const r of pending) {
      const base = townKey(r.town, { loose: true });
      const chome = towns.filter((t) => !used.has(t.code) && townKey(townLabel(t.name), { loose: true }).startsWith(`${base}(`));
      if (chome.length) { chome.forEach((t) => used.add(t.code)); matched.push(entry(r, chome)); }
      else unmatched.push({ line: r.line, input: `${r.city} ${r.town}`, reason: `${rc.name}に該当する町丁目がありません` });
    }
  }
  matched.sort((a, b) => a.line - b.line);
  unmatched.sort((a, b) => a.line - b.line);
  const names = new Map(allMunicipalities().map((m) => [m.code, m.city.replace(/\s+/g, '')]));
  return { matched, unmatched, cityCodes: [...cityCodes], cities: [...cityCodes].map((code) => ({ code, name: names.get(code) || code })), notes: [...new Set(notes)] };
}

function entry(r, towns) {
  return {
    line: r.line,
    input: `${r.city} ${r.town}`.trim(),
    codes: towns.map((t) => t.code),
    names: towns.map((t) => t.name),
    households: r.households,
    copies: r.copies,
    estatHouseholds: towns.reduce((s, t) => s + (t.households || 0), 0),
  };
}
