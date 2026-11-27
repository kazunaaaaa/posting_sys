// 所得（平均所得・所得指数）と、Excel「AI分析レポート」シートの検証（e-Statはモック）
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'income-test-'));
process.env.TOWN_CACHE_DIR = tmp;
process.env.ESTAT_APP_ID = 'TESTAPP';

const CITY = '14213';
const T = (n) => `${CITY}00${n}001`; // 町丁目コード（11桁）
const TOWNS = [1, 2, 3, 4, 5].map((n) => T(n));

// --- モックの e-Stat ---
const calls = [];
const meta = (objs) => ({ GET_META_INFO: { RESULT: { STATUS: 0 }, METADATA_INF: { CLASS_INF: { CLASS_OBJ: objs } } } });
const area = { '@id': 'area', CLASS: [{ '@code': CITY, '@name': '大和市' }, ...TOWNS.map((c) => ({ '@code': c, '@name': c })), { '@code': `${CITY}0010`, '@name': '大字（上位集計）' }] };
const time = { '@id': 'time', CLASS: [{ '@code': '2020000000', '@name': '2020年' }] };
const METAS = {
  // 社会・人口統計体系（市区町村）
  '0000020203': meta([
    { '@id': 'cat01', CLASS: [{ '@code': 'C120110', '@name': 'C120110_課税対象所得' }, { '@code': 'C120120', '@name': 'C120120_納税義務者数（所得割）' }, { '@code': 'A1101', '@name': 'A1101_総人口' }] },
    { '@id': 'area', CLASS: [{ '@code': CITY, '@name': '神奈川県 大和市' }] },
    { '@id': 'time', CLASS: [{ '@code': '2021100000', '@name': '2021年度' }, { '@code': '2022100000', '@name': '2022年度' }] },
  ]),
  OCC: meta([
    { '@id': 'tab', CLASS: [{ '@code': '020', '@name': '就業者数' }] },
    { '@id': 'cat01', CLASS: [{ '@code': '0', '@name': '総数' }, { '@code': 'A', '@name': 'A 管理的職業従事者' }, { '@code': 'B', '@name': 'B 専門的・技術的職業従事者' }, { '@code': 'C', '@name': 'C 事務従事者' }] },
    { '@id': 'cat02', CLASS: [{ '@code': '0', '@name': '総数（男女別）' }, { '@code': '1', '@name': '男' }] },
    area, time,
  ]),
  OWN: meta([
    { '@id': 'cat01', CLASS: [{ '@code': '0', '@name': '総数' }, { '@code': '1', '@name': '持ち家' }, { '@code': '2', '@name': '民営の借家' }] },
    area, time,
  ]),
  FAM: meta([
    { '@id': 'cat01', CLASS: [{ '@code': '0', '@name': '総数' }, { '@code': '1', '@name': '夫婦と子供から成る世帯' }, { '@code': '2', '@name': '単独世帯' }, { '@code': '3', '@name': 'その他' }] },
    area, time,
  ]),
};
// 町丁目ごとの値（1 が最も高所得っぽい、5 が最も低い）
const SHARE = { // [管理専門, 持ち家, 夫婦子, 単独]
  [T(1)]: [0.45, 0.85, 0.40, 0.15], [T(2)]: [0.35, 0.70, 0.32, 0.25], [T(3)]: [0.28, 0.55, 0.28, 0.33],
  [T(4)]: [0.22, 0.45, 0.22, 0.42], [T(5)]: [0.15, 0.25, 0.15, 0.60],
};
function values(id, u) {
  const out = [];
  const allowed = (k) => { const v = u.searchParams.get(k); return v ? v.split(',') : null; };
  const c1 = allowed('cdCat01');
  const push = (o) => { if (!c1 || c1.includes(o['@cat01'])) out.push(o); };
  if (id === '0000020203') {
    push({ '@cat01': 'C120110', '@area': CITY, '@time': '2021100000', $: '300000000' });
    push({ '@cat01': 'C120120', '@area': CITY, '@time': '2021100000', $: '100000' });
    push({ '@cat01': 'C120110', '@area': CITY, '@time': '2022100000', $: '360000000' }); // 千円
    push({ '@cat01': 'C120120', '@area': CITY, '@time': '2022100000', $: '100000' });
    return out;
  }
  for (const c of TOWNS) {
    const [wc, own, fam, single] = SHARE[c];
    const base = { '@area': c, '@time': '2020000000' };
    if (id === 'OCC') {
      if (u.searchParams.get('cdCat02') !== '0' || u.searchParams.get('cdTab') !== '020') throw new Error('他の分類は総数に固定されるべき');
      push({ ...base, '@cat01': '0', $: '1000' }); push({ ...base, '@cat01': 'A', $: String(wc * 300) }); push({ ...base, '@cat01': 'B', $: String(wc * 700) }); push({ ...base, '@cat01': 'C', $: '200' });
    }
    if (id === 'OWN') { push({ ...base, '@cat01': '0', $: '500' }); push({ ...base, '@cat01': '1', $: String(own * 500) }); push({ ...base, '@cat01': '2', $: '10' }); }
    if (id === 'FAM') { push({ ...base, '@cat01': '0', $: '400' }); push({ ...base, '@cat01': '1', $: String(fam * 400) }); push({ ...base, '@cat01': '2', $: String(single * 400) }); }
  }
  // 上位集計（大字）は比較から除かれるべき
  if (id === 'OWN') { push({ '@area': `${CITY}0010`, '@time': '2020000000', '@cat01': '0', $: '9999' }); push({ '@area': `${CITY}0010`, '@time': '2020000000', '@cat01': '1', $: '1' }); }
  return out;
}
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const ep = u.pathname.split('/').pop();
  calls.push(`${ep}:${u.searchParams.get('statsDataId') || u.searchParams.get('searchWord') || ''}`);
  const ok = (j) => ({ ok: true, json: async () => j });
  if (ep === 'getStatsList') {
    const w = u.searchParams.get('searchWord') || '';
    const id = /職業/.test(w) ? 'OCC' : /所有/.test(w) ? 'OWN' : /家族類型/.test(w) ? 'FAM' : null;
    const title = { OCC: '職業（大分類）別就業者数', OWN: '住宅の所有の関係別一般世帯数', FAM: '世帯の家族類型別一般世帯数' }[id];
    const tables = id ? [{ '@id': id, TITLE: { $: `${title}－町丁・字等` }, STATISTICS_NAME: '令和2年国勢調査 小地域集計 神奈川県', SURVEY_DATE: '202010' }] : [];
    return ok({ GET_STATS_LIST: { RESULT: { STATUS: 0 }, DATALIST_INF: { TABLE_INF: tables } } });
  }
  if (ep === 'getMetaInfo') return ok(METAS[u.searchParams.get('statsDataId')]);
  if (ep === 'getStatsData') {
    return ok({ GET_STATS_DATA: { RESULT: { STATUS: 0 }, STATISTICAL_DATA: { DATA_INF: { VALUE: values(u.searchParams.get('statsDataId'), u) } } } });
  }
  throw new Error('unexpected ' + ep);
};

const { fetchSmallAreaShare, findMunicipalIncomeTable, fetchMunicipalIncome } = await import('../services/estatClient.js');
const { incomeIndexes, levelOf, computeIncome, computeMunicipalIncome } = await import('../services/income.js');
const { scoreAreas } = await import('../services/scoring.js');
const { buildOptimalArea } = await import('../services/optimizeArea.js');
const { buildAreaWorkbook, REPORT_SHEET_NAME } = await import('../services/exportArea.js');
const { default: AdmZip } = await import('adm-zip');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log('[平均所得（実データ）]');
const t = await findMunicipalIncomeTable('X');
check('社会・人口統計体系の課税対象所得・納税義務者数を検出', t.id === '0000020203' && t.incomeCode === 'C120110' && t.taxpayerCode === 'C120120', JSON.stringify(t));
const mi = await fetchMunicipalIncome('X', t, CITY);
check('最新年度で 課税対象所得(千円)×1000 ÷ 納税義務者数', mi.avgIncomeYen === 3600000 && mi.year === '2022', JSON.stringify(mi));

console.log('[町丁目の割合]');
const occ = await fetchSmallAreaShare('X', 'OCC', CITY, { numerator: [/^管理的職業/, /^専門的・技術的職業/] });
check('管理職＋専門職の割合（複数区分の合計 ÷ 総数）', Math.abs(occ.shares[T(1)] - 0.45) < 1e-9 && Math.abs(occ.shares[T(5)] - 0.15) < 1e-9, JSON.stringify(occ.shares));
const own = await fetchSmallAreaShare('X', 'OWN', CITY, { numerator: [/^持ち家/] });
check('持ち家率', Math.abs(own.shares[T(1)] - 0.85) < 1e-9);

console.log('[所得指数]');
check('段階の境界', levelOf(1.2) === '高い' && levelOf(1.05) === 'やや高い' && levelOf(1) === '平均' && levelOf(0.9) === 'やや低い' && levelOf(0.7) === '低い' && levelOf(null) === '—');
const idx = incomeIndexes(['a', 'b', 'c'], { own: { a: 0.9, b: 0.5, c: 0.1 }, single: { a: 0.1, b: 0.3, c: 0.5 } });
check('持ち家が多く単身が少ないほど高い', idx.a.index > idx.b.index && idx.b.index > idx.c.index);
check('平均的な町丁目は 1.00 付近', Math.abs(idx.b.index - 1) < 0.01);
check('範囲 0.6〜1.6', Object.values(idx).every((v) => v.index >= 0.6 && v.index <= 1.6));
const none = incomeIndexes(['a', 'b'], {});
check('指標が無ければ null・「—」', none.a.index === null && none.a.level === '—');

const towns = TOWNS.map((code, i) => ({ code, cityCode: CITY, city: '大和市', name: `町${i + 1}`, households: 1000, distribution: 700, center: { lat: 35.47, lng: 139.46 + i * 0.004 } }));
const inc = await computeIncome(towns);
check('町丁目の所得指数: 1 > 3 > 5', inc.byCode[T(1)].index > inc.byCode[T(3)].index && inc.byCode[T(3)].index > inc.byCode[T(5)].index, JSON.stringify(inc.byCode));
check('4指標すべて使用', inc.byCode[T(1)].used.length === 4, inc.byCode[T(1)].used.join(','));
check('推計の印', inc.byCode[T(1)].estimated === true);
check('市区町村の平均所得も返す', inc.municipal[CITY]?.avgIncomeYen === 3600000);
check('エラーなし', !inc.errors.length, inc.errors.join(' / '));
check('キャッシュ保存', fs.existsSync(path.join(tmp, 'income', `${CITY}.json`)));
const before = calls.length;
await computeIncome(towns);
check('2回目はe-Statに問い合わせない', calls.length === before);

const mu = await computeMunicipalIncome([CITY]);
check('市区町村モード: 平均所得の比 = 1.00（1市のみ）', mu.byCode[CITY].index === 1 && mu.byCode[CITY].estimated === false);

console.log('[スコア・最適エリア]');
const plain = scoreAreas(towns, [], { income: inc.byCode });
check('所得層 指定なし: 重みに所得なし・各エリアに所得指数は表示', plain.weights.income == null && plain.areas.every((a) => a.incomeIndex != null));
const hi = scoreAreas(towns, [], { income: inc.byCode, incomePref: 'high' });
const lo = scoreAreas(towns, [], { income: inc.byCode, incomePref: 'low' });
check('重みの合計 = 1', Math.abs(Object.values(hi.weights).reduce((s, v) => s + v, 0) - 1) < 1e-9);
check('高め: 最適 = 町1', hi.best.code === T(1), hi.best.code);
check('低め: 最適 = 町5', lo.best.code === T(5), lo.best.code);
check('所得ランキング（高め）先頭 = 町1', hi.incomeRanking[0].code === T(1));

// 最適エリア: ピンは町3、隣接は帯状（1-2-3-4-5）。1区画分の部数 → 高めなら2（4より所得が高い）
const sq = (x) => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]].map(([a, b]) => [139.46 + a * 0.004, 35.47 + b * 0.004]);
const strip = towns.map((tw, i) => ({ ...tw, polygon: sq(i), center: { lat: 35.472, lng: 139.462 + i * 0.004 } }));
const pin = strip[2].center;
const optHi = buildOptimalArea({ towns: strip, pin, targetCopies: 1400, income: inc.byCode, incomePref: 'high' });
const optLo = buildOptimalArea({ towns: strip, pin, targetCopies: 1400, income: inc.byCode, incomePref: 'low' });
check('最適エリア 高め: 町3＋町2', optHi.codes.join() === [T(3), T(2)].join(), optHi.codes.join());
check('最適エリア 低め: 町3＋町4', optLo.codes.join() === [T(3), T(4)].join(), optLo.codes.join());
check('作成エリアの所得指数（部数加重）', optHi.incomeIndex > optLo.incomeIndex && optHi.incomePref === 'high');

console.log('[Excel AI分析レポート]');
const scoring = { ...hi, income: { municipal: [{ code: CITY, city: '大和市', ...inc.municipal[CITY] }], estimated: true } };
const out = await buildAreaWorkbook({
  rows: towns.map((tw) => ({ city: '大和市', town: tw.name, households: tw.households })),
  report: {
    generatedAt: '2026-11-13T10:00:00Z',
    conditions: { businessType: '美容室', target: '20〜59歳の女性', incomePref: 'high', targetCopies: 10000, center: '大和駅' },
    analysis: { scoring, explanation: { source: 'rule-based', text: '【最適エリア】町1\n【所得】平均所得 約360万円' }, quotes: { companyTotals: [{ name: 'A社', areas: 5, quote: 20000 }] } },
    optimize: { sum: 1400, targetCopies: 1400, areaCount: 2, maxDistanceKm: 0.4, incomeIndex: optHi.incomeIndex, incomePref: 'high', skippedByBarrier: [] },
  },
});
check('レポートシート名', out.reportSheetName === REPORT_SHEET_NAME);
const zip = new AdmZip(out.buffer);
const wbXml = zip.readAsText('xl/workbook.xml');
check('エリア表が1枚目・レポートが2枚目', /<sheet [^>]*name="3500部エリア"[^>]*\/>\s*<sheet [^>]*name="AI分析レポート"/.test(wbXml), wbXml.match(/<sheets>.*<\/sheets>/s)?.[0]);
const ss = zip.readAsText('xl/sharedStrings.xml');
for (const s of ['■ 分析条件', '高めを優先', '■ AIによる分析（ルールベース）', '【所得】平均所得 約360万円', '■ 所得指数が高いエリア', '■ エリア別スコア', '大和市 約360万円（2022年）', '所得指数（推計）']) {
  check(`レポートに「${s}」`, ss.includes(s));
}
check('配布会社の見積はレポートに載せない', !ss.includes('■ 配布会社の見積'));
const noRep = await buildAreaWorkbook({ rows: [{ city: '大和市', town: '町1', households: 100 }] });
check('report なしならシートは1枚', noRep.reportSheetName === null && !new AdmZip(noRep.buffer).readAsText('xl/workbook.xml').includes('AI分析レポート'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
