// AI最適エリア作成（隣接・分断・ターゲット・目標部数）のテスト
import { buildAdjacency, buildOptimalArea } from '../services/optimizeArea.js';
import { parseOverpass, crossings, indexBarriers } from '../services/barriers.js';
import { countInBands, normalizeProfile, nationalShare } from '../services/demographics.js';
import { parseAgeBand, detectAgeSexClasses, fetchTownAgeSex } from '../services/estatClient.js';

let pass = 0, fail = 0;
const ok = (label, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${cond ? '' : ' → ' + info}`); cond ? pass++ : fail++; };

// 格子状の町丁目（約360m四方・各500部）。列 river の位置は「水面」で町丁目が無い（＝隣接しない）
const W = 0.004, H = 0.0034, X0 = 139.40, Y0 = 35.50;
function grid({ cols = 12, rows = 10, riverCol = null, dist = () => 500 } = {}) {
  const towns = [];
  for (let c = 0; c < cols; c++) {
    if (c === riverCol) continue;
    for (let r = 0; r < rows; r++) {
      const x = X0 + c * W, y = Y0 + r * H;
      const ring = [[x, y], [x, y + H], [x + W, y + H], [x + W, y], [x, y]];
      towns.push({ code: `T${String(c).padStart(2, '0')}${String(r).padStart(2, '0')}`, name: `c${c}r${r}`, col: c, row: r,
        polygon: ring, polygons: [ring], center: { lat: y + H / 2, lng: x + W / 2 }, distribution: dist(c, r) });
    }
  }
  return towns;
}
const cellCenter = (c, r) => ({ lat: Y0 + r * H + H / 2, lng: X0 + c * W + W / 2 });

// 1) 隣接
const g = grid({ riverCol: 6 });
const adj = buildAdjacency(g);
ok('格子の隣接: 中央の区画は上下左右と接する', [...adj.get('T0303')].sort().join(',') === ['T0203', 'T0302', 'T0304', 'T0403'].sort().join(','), [...adj.get('T0303')].join(','));
ok('川（水面の列）をはさむ区画は隣接しない', !adj.get('T0503').has('T0703'));

// 2) 目標部数に近い・まとまり・川を越えない
const pin = cellCenter(5, 4); // 川のすぐ西
const r1 = buildOptimalArea({ towns: g, pin, targetCopies: 10000 });
ok('目標10,000部 → 10,000部（500部×20区画）', r1.sum === 10000, r1.sum);
ok('ピンのある区画から開始', r1.startCode === 'T0504', r1.startCode);
const sel1 = new Set(r1.codes);
ok('川の東側（7列目以降）は選ばない', g.filter((t) => t.col > 6 && sel1.has(t.code)).length === 0,
  g.filter((t) => t.col > 6 && sel1.has(t.code)).map((t) => t.code).join(','));
// 連結性（飛び地なし）
const reach = new Set([r1.codes[0]]); const st = [r1.codes[0]];
while (st.length) { const c = st.pop(); for (const n of adj.get(c)) if (sel1.has(n) && !reach.has(n)) { reach.add(n); st.push(n); } }
ok('飛び地のない、まとまったエリア', reach.size === sel1.size, `${reach.size}/${sel1.size}`);

// 3) 線路（横方向・row 4 と 5 の間）を越えにくい
const railY = Y0 + 5 * H; // ピン(row4)のすぐ北
const overpass = { elements: [
  { type: 'way', tags: { railway: 'rail', name: 'テスト線' }, geometry: [{ lat: railY, lon: X0 - 0.01 }, { lat: railY, lon: X0 + 0.06 }] },
  { type: 'way', tags: { railway: 'rail', name: 'テスト線' }, geometry: [{ lat: railY + 0.00003, lon: X0 - 0.01 }, { lat: railY + 0.00003, lon: X0 + 0.06 }] }, // 複線
  { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: Y0, lon: X0 }, { lat: Y0 + 0.01, lon: X0 }] },
] };
const barriers = parseOverpass(overpass);
ok('Overpass解析: 線路2本を採用・生活道路は除外', barriers.length === 2 && barriers.every((b) => b.type === 'railway'), JSON.stringify(barriers.map((b) => b.type)));
const cx = crossings(pin, cellCenter(5, 7), indexBarriers(barriers));
ok('複線（同じ名前）は1本として数える', cx.types.length === 1 && cx.weight === 1.5, JSON.stringify(cx));
const g2 = grid({ cols: 12, rows: 12 });
const pin2 = cellCenter(5, 4);
const noBar = buildOptimalArea({ towns: g2, pin: pin2, targetCopies: 10000 });
const withBar = buildOptimalArea({ towns: g2, pin: pin2, targetCopies: 10000, barriers });
const north = (r) => g2.filter((t) => t.row >= 5 && r.codes.includes(t.code)).length;
ok('線路の向こう側(北)の区画が減る', north(withBar) < north(noBar), `なし${north(noBar)} → あり${north(withBar)}`);
ok('分断で除外した区画を説明に含める', withBar.skippedByBarrier.length > 0 && withBar.skippedByBarrier[0].barriers.includes('テスト線'), JSON.stringify(withBar.skippedByBarrier[0]));

// 4) ターゲットの多い側へ寄る
const targets = {};
for (const t of g2) targets[t.code] = { target: t.col <= 5 ? 300 : 60, rate: t.col <= 5 ? 0.3 : 0.06 };
const tgt = buildOptimalArea({ towns: g2, pin: cellCenter(5, 6), targetCopies: 10000, targets });
const west = tgt.codes.filter((c) => +c.slice(1, 3) <= 5).length;
ok('ターゲットの多い西側を多く選ぶ', west > tgt.codes.length * 0.65, `${west}/${tgt.codes.length}`);
ok('ターゲット合計を返す', tgt.targetTotal > 0, tgt.targetTotal);

// 5) 端数のある部数でも目標に近づける（入れ替えの仕上げ）
const g3 = grid({ dist: (c, r) => 300 + ((c * 7 + r * 13) % 9) * 110 });
const r3 = buildOptimalArea({ towns: g3, pin: cellCenter(3, 4), targetCopies: 10000 });
ok('目標10,000部の±5%以内', Math.abs(r3.sum - 10000) <= 500, r3.sum);

// 6) ターゲット人数の計算
const bands = [{ min: 0, max: 4, m: 50, f: 50 }, { min: 5, max: 9, m: 60, f: 40 }, { min: 10, max: 14, m: 30, f: 30 }, { min: 85, max: 120, m: 10, f: 30 }];
ok('6〜15歳: 5〜9歳の4/5 + 10〜14歳', Math.round(countInBands(bands, { ageMin: 6, ageMax: 15 }).target) === 80 + 60, countInBands(bands, { ageMin: 6, ageMax: 15 }).target);
ok('女性のみ', Math.round(countInBands(bands, { ageMin: 0, ageMax: 14, sex: 'female' }).target) === 120);
ok('85歳以上（以上区分）', Math.round(countInBands(bands, { ageMin: 85, ageMax: 120 }).target) === 40);
ok('プロフィール表記', normalizeProfile({ ageMin: 20, ageMax: 59, sex: 'female' }).label === '20〜59歳の女性', normalizeProfile({ ageMin: 20, ageMax: 59, sex: 'female' }).label);
const share = nationalShare({ ageMin: 65, ageMax: 120 });
ok('全国推計: 65歳以上は約29%', share > 0.27 && share < 0.31, share.toFixed(3));

// 7) e-Stat 小地域の分類判定
const meta = [
  { id: 'tab', name: '表章項目', classes: [{ '@code': '0010', '@name': '人口' }, { '@code': '0020', '@name': '平均年齢' }] },
  { id: 'cat01', name: '男女', classes: [{ '@code': '100', '@name': '総数' }, { '@code': '110', '@name': '男' }, { '@code': '120', '@name': '女' }] },
  { id: 'cat02', name: '年齢', classes: [
    { '@code': '00', '@name': '総数' },
    ...Array.from({ length: 20 }, (_, i) => ({ '@code': String(i + 1).padStart(2, '0'), '@name': `${i * 5}～${i * 5 + 4}歳` })),
    { '@code': '21', '@name': '100歳以上' }, { '@code': '30', '@name': '（再掲）15歳未満' }, { '@code': '31', '@name': '85歳以上' },
  ] },
  { id: 'area', name: '地域', classes: [{ '@code': '13122001001', '@name': '亀有１丁目' }] },
];
const det = detectAgeSexClasses(meta);
ok('男女の分類を判定', det.sex?.classId === 'cat01' && det.sex.male === '110' && det.sex.female === '120', JSON.stringify(det.sex));
ok('年齢5歳階級21区分（再掲・85歳以上の重複は除外）', det.age?.bands.length === 21 && !det.age.bands.some((b) => b.code === '31' || b.code === '30'), det.age?.bands.length);
ok('表章項目は「人口」', det.measure?.code === '0010', JSON.stringify(det.measure));
ok('年齢区分の解析', JSON.stringify(parseAgeBand('100歳以上')) === '[100,120]' && parseAgeBand('15～64歳') === null);

// 8) 年齢・男女別人口の取得（e-Stat 応答の模擬）
const VALUES = [];
for (const area of ['13122001001', '13122001002', '13123001001']) {
  for (const sx of ['110', '120']) {
    for (let i = 1; i <= 21; i++) VALUES.push({ '@tab': '0010', '@cat01': sx, '@cat02': String(i).padStart(2, '0'), '@area': area, '@time': '2020000000', $: String(sx === '110' ? 10 : 12) });
    VALUES.push({ '@tab': '0020', '@cat01': sx, '@cat02': '00', '@area': area, '@time': '2020000000', $: '45.1' }); // 平均年齢（除外）
  }
}
VALUES.push({ '@tab': '0010', '@cat01': '110', '@cat02': '05', '@area': '13122001002', '@time': '2020000000', $: '-' }); // 秘匿
meta[3].classes.push({ '@code': '13122001002', '@name': '亀有２丁目' }, { '@code': '13123001001', '@name': '他区' });
meta.push({ id: 'time', name: '時間軸', classes: { '@code': '2020000000', '@name': '2020年' } });
let calls = 0;
globalThis.fetch = async (url) => {
  const u = new URL(url); const ep = u.pathname.split('/').pop(); calls++;
  if (ep === 'getMetaInfo') return { ok: true, json: async () => ({ GET_META_INFO: { RESULT: { STATUS: 0 }, METADATA_INF: { CLASS_INF: { CLASS_OBJ: meta.map((o) => ({ '@id': o.id, '@name': o.name, CLASS: o.classes })) } } } }) };
  const q = Object.fromEntries(u.searchParams);
  const sexes = (q.cdCat01 || '').split(',');
  let vals = VALUES.filter((v) => (!q.cdTab || v['@tab'] === q.cdTab) && (!q.cdCat01 || sexes.includes(v['@cat01']))
    && (!q.cdAreaFrom || (v['@area'] >= q.cdAreaFrom && v['@area'] <= q.cdAreaTo)));
  const start = Number(q.startPosition || 1);
  const pageSize = 50; // ページ送りの確認用
  const page = vals.slice(start - 1, start - 1 + pageSize);
  const next = start - 1 + pageSize < vals.length ? start + pageSize : undefined;
  return { ok: true, json: async () => ({ GET_STATS_DATA: { RESULT: { STATUS: 0 }, STATISTICAL_DATA: { RESULT_INF: { NEXT_KEY: next }, DATA_INF: { VALUE: page } } } }) };
};
const ag = await fetchTownAgeSex('APP', 'T1', '13122');
ok('対象の区の町丁目だけ（他区は除外）', Object.keys(ag.towns).sort().join(',') === '13122001001,13122001002', Object.keys(ag.towns).join(','));
const t1 = ag.towns['13122001001'];
ok('21区分・男10/女12（平均年齢の行は混ざらない）', t1.bands.length === 21 && t1.bands.every((b) => b.m === 10 && b.f === 12), JSON.stringify(t1.bands[0]));
ok('秘匿値(-)は0として扱う', ag.towns['13122001002'].bands.find((b) => b.min === 20).m === 10, JSON.stringify(ag.towns['13122001002'].bands.find((b) => b.min === 20)));
ok('ページ送りで全件取得', calls > 2, calls);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
