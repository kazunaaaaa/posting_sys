// e-Stat パースロジックの検証（fetchをモック）
import {
  detectHouseholdCode, detectAreaClassId, detectLatestTime, isMunicipalityCode,
  fetchMunicipalityHouseholds, getMeta,
} from '../services/estatClient.js';

// --- 現実的なメタ（CLASSは単一=オブジェクト, 複数=配列の両方を含める）---
const META = {
  GET_META_INFO: {
    RESULT: { STATUS: 0, ERROR_MSG: '正常に終了しました。' },
    METADATA_INF: { CLASS_INF: { CLASS_OBJ: [
      { '@id': 'tab', '@name': '表章項目', CLASS: [
        { '@code': '010', '@name': '人口', '@unit': '人' },
        { '@code': '020', '@name': '世帯数', '@unit': '世帯' },
      ]},
      { '@id': 'cat01', '@name': '男女', CLASS: [
        { '@code': '000', '@name': '総数' }, { '@code': '001', '@name': '男' }, { '@code': '002', '@name': '女' },
      ]},
      { '@id': 'area', '@name': '全国・都道府県・市区町村', CLASS: [
        { '@code': '00000', '@name': '全国' },
        { '@code': '01000', '@name': '北海道' },
        { '@code': '01101', '@name': '札幌市中央区' },
        { '@code': '12207', '@name': '松戸市' },
        { '@code': '13112', '@name': '世田谷区' },
      ]},
      // time は単一 → asArray のオブジェクト分岐を検証
      { '@id': 'time', '@name': '時間軸', CLASS: { '@code': '2020000000', '@name': '2020年' } },
    ]}},
  },
};

// 全VALUE（人口=010 と 世帯=020 が混在。世帯は各エリア1件、全国/都道府県も含む）
const ALL_VALUES = [
  { '@tab': '010', '@cat01': '000', '@area': '12207', '@time': '2020000000', $: '498232' },
  { '@tab': '020', '@cat01': '000', '@area': '00000', '@time': '2020000000', $: '55704949' }, // 全国(除外)
  { '@tab': '020', '@cat01': '000', '@area': '01000', '@time': '2020000000', $: '2477614' },  // 都道府県(除外)
  { '@tab': '020', '@cat01': '000', '@area': '01101', '@time': '2020000000', $: '135002' },
  { '@tab': '020', '@cat01': '000', '@area': '12207', '@time': '2020000000', $: '224620' },
  { '@tab': '020', '@cat01': '000', '@area': '13112', '@time': '2020000000', $: '486152' },
  { '@tab': '020', '@cat01': '000', '@area': '12207', '@time': '2015000000', $: '210000' }, // 旧年(除外されるべき)
];

globalThis.fetch = async (url) => {
  const u = new URL(url);
  const endpoint = u.pathname.split('/').pop();
  if (endpoint === 'getMetaInfo') return { ok: true, json: async () => META };
  if (endpoint === 'getStatsData') {
    const cdTab = u.searchParams.get('cdTab');
    const cdTime = u.searchParams.get('cdTime');
    // e-Stat はサーバー側で cd フィルタを適用する。モックも同様にフィルタ。
    const values = ALL_VALUES.filter((v) =>
      (!cdTab || v['@tab'] === cdTab) && (!cdTime || v['@time'] === cdTime));
    return { ok: true, json: async () => ({
      GET_STATS_DATA: { RESULT: { STATUS: 0 }, STATISTICAL_DATA: { DATA_INF: { VALUE: values } } },
    })};
  }
  throw new Error('unexpected endpoint ' + endpoint);
};

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` → got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const classObjs = await getMeta('APPID', 'TABLE');
eq('世帯数コード検出 = tab/020', detectHouseholdCode(classObjs), { classId: 'tab', code: '020', name: '世帯数', unit: '世帯' });
eq('地域分類ID = area', detectAreaClassId(classObjs), 'area');
eq('最新時間軸 = 2020', detectLatestTime(classObjs), '2020000000');
eq('isMunicipalityCode 全国除外', isMunicipalityCode('00000'), false);
eq('isMunicipalityCode 都道府県除外', isMunicipalityCode('01000'), false);
eq('isMunicipalityCode 政令区OK', isMunicipalityCode('01101'), true);
eq('isMunicipalityCode 市OK', isMunicipalityCode('12207'), true);

const { households, meta } = await fetchMunicipalityHouseholds('APPID', 'TABLE');
eq('松戸市 世帯数', households['12207'], 224620);
eq('札幌中央区 世帯数', households['01101'], 135002);
eq('世田谷区 世帯数', households['13112'], 486152);
eq('全国は除外', households['00000'], undefined);
eq('都道府県は除外', households['01000'], undefined);
eq('人口(tab=010)は混入しない', Object.values(households).includes(498232), false);
eq('旧年(2015)は最新フィルタで除外', households['12207'] === 224620, true);
eq('取得市区町村数 = 3', meta.municipalityCount, 3);
eq('配布部数(松戸 ×70%)', Math.round(households['12207'] * 0.7), 157234);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
