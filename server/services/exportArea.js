// 配布部数表（エリア表）Excel の生成
// 手本: 【エリア表】_<店舗名>様_<案件名>_<部数>部エリア（シート「2万部エリア」形式）
//   B:市区町村名 C:町丁目名 D:世帯数 E:配布予定数(=ROUNDDOWN(D*カバー率,-1)) F:備考 / 右側(G4〜)に地図画像
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import { DISTRIBUTION_RATE, distributionFor } from './distribution.js';

const FONT = { name: 'ＭＳ Ｐゴシック', size: 11 };
const THIN = { style: 'thin' };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

const KANJI = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function kanjiToNumber(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch in KANJI) cur = cur * 10 + KANJI[ch];
    else return null;
  }
  return total + cur;
}

// 「南林間一丁目」→「南林間(1)」、丁目の無い町名はそのまま
export function townLabel(name) {
  const m = String(name).match(/^(.*?)([0-9０-９]+|[〇一二三四五六七八九十]+)丁目$/);
  if (!m) return name;
  const digits = m[2].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const n = kanjiToNumber(digits);
  return n == null ? name : `${m[1]}(${n})`;
}

// 「相模原市 南区」→「相模原市南区」
export function cityLabel(city) {
  return String(city || '').replace(/\s+/g, '');
}

export function copiesLabel(n) {
  return n >= 10000 && n % 1000 === 0 ? `${n / 10000}万部` : `${n}部`;
}

function sheetNameFor(copies) {
  const name = `${copiesLabel(copies)}エリア`;
  return name.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
}

export function titleFor({ storeName, projectName, copies }) {
  const parts = ['【エリア表】'];
  if (storeName) parts.push(/様$/.test(storeName) ? storeName : `${storeName}様`);
  if (projectName) parts.push(projectName);
  parts.push(`${copies}部エリア`);
  return parts.join('_');
}

/**
 * @param {object} p
 * @param {Array<{city:string, town:string, households:number}>} p.rows
 * @param {number} [p.coverRate]
 * @param {string} [p.storeName]
 * @param {string} [p.projectName]
 * @param {number} [p.targetCopies]  「10,000部追加」などの目標部数（タイトル・シート名に使用）
 * @param {string} [p.mapImage]      data:image/png;base64,...
 * @param {{width:number,height:number}} [p.mapSize]
 */
export async function buildAreaWorkbook(p) {
  const rate = Number(p.coverRate) > 0 && Number(p.coverRate) <= 1 ? Number(p.coverRate) : DISTRIBUTION_RATE;
  const rows = (p.rows || []).filter((r) => r && r.households != null);
  if (!rows.length) throw new Error('出力するエリアがありません');

  const totalCopies = rows.reduce((s, r) => s + distributionFor(r.households, rate), 0);
  const copies = Number(p.targetCopies) > 0 ? Number(p.targetCopies) : totalCopies;
  const title = titleFor({ storeName: p.storeName, projectName: p.projectName, copies });

  // ターゲット（人数・占有率）があれば、合計部数の下に2行追加して見出し以降を2行下げる
  const tgt = p.target && Number(p.target.people) > 0 ? p.target : null;
  const extra = tgt ? 2 : 0;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'posting-sys';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetNameFor(copies), {
    views: [{ state: 'frozen', ySplit: 3 + extra }],
    pageSetup: {
      paperSize: 9, orientation: 'portrait',
      margins: { left: 0.7087, right: 0.7087, top: 0.748, bottom: 0.748, header: 0.315, footer: 0.315 },
    },
  });
  ws.properties.defaultRowHeight = 17;
  ws.columns = [
    { key: 'a', width: 2 }, { key: 'b', width: 17.7 }, { key: 'c', width: 18 },
    { key: 'd', width: 14.7 }, { key: 'e', width: 12.5 }, { key: 'f', width: 19.3 }, { key: 'g', width: 9 },
  ];

  const set = (addr, value, style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = FONT;
    c.alignment = { vertical: 'middle', ...(style.alignment || {}) };
    if (style.numFmt) c.numFmt = style.numFmt;
    if (style.border) c.border = BORDER;
    if (style.fill) c.fill = HEADER_FILL;
    return c;
  };

  // 1〜2行目: タイトル・カバー率・合計部数
  const head = 3 + extra;
  const first = head + 1;
  const last = first + rows.length - 1;
  const totalRow = last + 1;
  ws.mergeCells('B1:D1');
  set('B1', title, { alignment: { horizontal: 'left' } });
  set('E1', 'カバー率：', { alignment: { horizontal: 'right' } });
  set('F1', rate, { alignment: { horizontal: 'center' }, numFmt: '0.00%' });
  set('E2', '合計部数：', { alignment: { horizontal: 'right' } });
  set('F2', { formula: `E${totalRow}&"部"`, result: `${totalCopies}部` }, { alignment: { horizontal: 'center' }, numFmt: '#,##0' });

  // 3行目: 見出し
  // 3〜4行目（ターゲット指定時）: ターゲット人数・占有率（人口に占める割合）
  if (tgt) {
    ws.mergeCells('C3:E3');
    set('C3', `ターゲット（${tgt.label || '指定属性'}）：`, { alignment: { horizontal: 'right' } });
    set('F3', Math.round(Number(tgt.people)), { alignment: { horizontal: 'center' }, numFmt: '"約"#,##0"人"' });
    ws.mergeCells('C4:E4');
    set('C4', 'ターゲット占有率（人口比）：', { alignment: { horizontal: 'right' } });
    const share = Number(tgt.share);
    set('F4', Number.isFinite(share) && share > 0 ? share : null, { alignment: { horizontal: 'center' }, numFmt: '0.0%' });
    if (tgt.note) set('G3', tgt.note, { alignment: { horizontal: 'left' } }).font = { ...FONT, size: 9, color: { argb: 'FF7F7F7F' } };
  }

  // 見出し
  ws.getRow(head).height = 24;
  [['B', '市区町村名'], ['C', '町丁目名'], ['D', '世帯数'], ['E', '配布予定数'], ['F', '備考']].forEach(([col, v]) =>
    set(`${col}${head}`, v, { border: true, fill: true, alignment: { horizontal: col === 'F' ? 'left' : 'center' } }));

  // 4行目〜: エリア
  rows.forEach((r, i) => {
    const n = first + i;
    ws.getRow(n).height = 17;
    set(`B${n}`, cityLabel(r.city), { border: true });
    set(`C${n}`, townLabel(r.town), { border: true });
    set(`D${n}`, r.households, { border: true, numFmt: '#,##0' });
    set(`E${n}`, { formula: `ROUNDDOWN(D${n}*$F$1,-1)`, result: distributionFor(r.households, rate) },
      { border: true, numFmt: '#,##0_);[Red](#,##0)' });
    set(`F${n}`, r.note || null, { border: true, alignment: { horizontal: 'left' } });
  });

  // 合計行
  const hhTotal = rows.reduce((s, r) => s + r.households, 0);
  set(`D${totalRow}`, { formula: `SUM(D${first}:D${last})`, result: hhTotal }, { numFmt: '#,##0' });
  set(`E${totalRow}`, { formula: `SUM(E${first}:E${last})`, result: totalCopies }, { numFmt: '#,##0' });

  ws.pageSetup.printArea = `A1:F${totalRow + 1}`;

  // 地図画像（G4 起点、手本と同じく幅約1000px）
  const m = String(p.mapImage || '').match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (m) {
    const id = wb.addImage({ base64: m[2], extension: m[1] === 'jpeg' ? 'jpeg' : 'png' });
    const w = 1001;
    const ratio = p.mapSize?.width ? p.mapSize.height / p.mapSize.width : 809 / 1001;
    ws.addImage(id, { tl: { col: 6, row: head }, ext: { width: w, height: Math.round(w * ratio) } });
  }

  const reportSheet = p.report ? addReportSheet(wb, p.report, { title, totalCopies, rate }) : null;

  const buffer = fixDrawingAnchors(Buffer.from(await wb.xlsx.writeBuffer()));
  return { buffer, title, sheetName: ws.name, reportSheetName: reportSheet?.name || null, totalCopies, copies };
}

// ======================================================================
// AI分析レポート（エリア表とは別シート）
// report: { generatedAt, conditions:{businessType,target,incomePref,targetCopies,center,storeName},
//           analysis:{ scoring, explanation:{text,source,model}, quotes }, optimize:{...} }
// ======================================================================
export const REPORT_SHEET_NAME = 'AI分析レポート';
const BLUE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } };
const SOURCE_LABEL = { census: '国勢調査（町丁目の年齢・男女別人口）', mixed: '国勢調査＋一部は全国の年齢構成で推計', estimate: '全国の年齢構成による推計' };
const AXIS_LABEL = { reach: '到達（世帯数）', target: 'ターゲット', income: '所得層', opportunity: '競合機会', efficiency: '配布効率', cost: 'コスト' };
const INCOME_PREF_LABEL = { high: '高め', low: '低め' };

const num = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);

export function addReportSheet(wb, report = {}, ctx = {}) {
  const ws = wb.addWorksheet(REPORT_SHEET_NAME, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
  ws.columns = [
    { width: 2 }, { width: 6 }, { width: 26 }, { width: 13 }, { width: 13 }, { width: 13 },
    { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 },
  ];
  const lastCol = 'J';
  let r = 1;
  const cell = (addr, value, st = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { ...FONT, ...(st.font || {}) };
    c.alignment = { vertical: 'middle', ...(st.alignment || {}) };
    if (st.numFmt) c.numFmt = st.numFmt;
    if (st.border) c.border = BORDER;
    if (st.fill) c.fill = st.fill;
    return c;
  };
  const heading = (text) => {
    r += 1;
    ws.mergeCells(`B${r}:${lastCol}${r}`);
    cell(`B${r}`, text, { font: { bold: true, size: 12, color: { argb: 'FF1F3864' } }, fill: BLUE_FILL });
    ws.getRow(r).height = 22;
    r += 1;
  };
  const kv = (k, v, numFmt) => {
    if (v == null || v === '') return;
    cell(`B${r}`, k, { font: { color: { argb: 'FF595959' } } });
    ws.mergeCells(`B${r}:C${r}`);
    ws.mergeCells(`D${r}:${lastCol}${r}`);
    cell(`D${r}`, v, { numFmt, alignment: { horizontal: 'left', wrapText: true } });
    r += 1;
  };
  const para = (text, { color } = {}) => {
    const lines = String(text || '').split(/\r?\n/).map((x) => x.trimEnd()).filter((x) => x.trim());
    for (const line of lines) {
      ws.mergeCells(`B${r}:${lastCol}${r}`);
      cell(`B${r}`, line, { alignment: { wrapText: true, vertical: 'top' }, font: color ? { color: { argb: color } } : {} });
      // 結合セルは自動で高さが変わらないので、文字数から行数を見積もる（全角1文字≒列幅1.9）
      const lines = Math.max(1, Math.ceil([...line].length / 62));
      ws.getRow(r).height = 17 * lines + 2;
      r += 1;
    }
  };
  // 表: cols = [{ header, key, width?(列数), numFmt, align }]
  const table = (cols, rows) => {
    const letters = 'BCDEFGHIJ';
    let ci = 0;
    const spans = cols.map((c) => { const from = letters[ci]; ci += c.span || 1; return { from, to: letters[ci - 1] }; });
    cols.forEach((c, i) => {
      if (spans[i].from !== spans[i].to) ws.mergeCells(`${spans[i].from}${r}:${spans[i].to}${r}`);
      cell(`${spans[i].from}${r}`, c.header, { border: true, fill: HEADER_FILL, alignment: { horizontal: 'center', wrapText: true } });
    });
    ws.getRow(r).height = 32;
    r += 1;
    for (const row of rows) {
      cols.forEach((c, i) => {
        if (spans[i].from !== spans[i].to) ws.mergeCells(`${spans[i].from}${r}:${spans[i].to}${r}`);
        const v = typeof c.value === 'function' ? c.value(row) : row[c.key];
        cell(`${spans[i].from}${r}`, v ?? '—', { border: true, numFmt: c.numFmt, alignment: { horizontal: c.align || (typeof v === 'number' ? 'right' : 'left') } });
        // 結合範囲の罫線
        if (spans[i].from !== spans[i].to) for (let k = letters.indexOf(spans[i].from) + 1; k <= letters.indexOf(spans[i].to); k++) ws.getCell(`${letters[k]}${r}`).border = BORDER;
      });
      r += 1;
    }
  };

  const cond = report.conditions || {};
  const scoring = report.analysis?.scoring || null;
  const totals = scoring?.totals || {};
  const opt = report.optimize || null;
  const generated = report.generatedAt ? new Date(report.generatedAt) : new Date();
  const fmtDate = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  ws.mergeCells(`B${r}:${lastCol}${r}`);
  cell(`B${r}`, `AI分析レポート ${ctx.title ? `― ${ctx.title}` : ''}`, { font: { bold: true, size: 14 } });
  ws.getRow(r).height = 26;
  r += 1;
  ws.mergeCells(`B${r}:${lastCol}${r}`);
  cell(`B${r}`, `作成日時: ${fmtDate(generated)}`, { font: { color: { argb: 'FF7F7F7F' }, size: 10 } });
  r += 1;

  heading('■ 分析条件');
  kv('業態', cond.businessType || '指定なし');
  kv('ターゲット属性', cond.target || '指定なし');
  kv('所得層', INCOME_PREF_LABEL[cond.incomePref] ? `${INCOME_PREF_LABEL[cond.incomePref]}を優先` : '指定なし');
  kv('目標部数', num(cond.targetCopies) ? `約${num(cond.targetCopies).toLocaleString()}部` : null);
  kv('中心地（📍）', cond.center || null);
  kv('カバー率', ctx.rate ? `${Math.round(ctx.rate * 100)}%（配布部数 = 世帯数 × カバー率、10部未満切り捨て）` : null);

  heading('■ サマリー');
  kv('エリア数', scoring?.areas?.length ?? null, '#,##0');
  kv('世帯数 合計', num(totals.households), '#,##0');
  kv('配布部数 合計', num(ctx.totalCopies ?? totals.distribution), '#,##0"部"');
  if (num(totals.target)) kv(`ターゲット（${scoring?.targetProfile?.label || '指定属性'}）`, `約${num(totals.target).toLocaleString()}人（${SOURCE_LABEL[scoring?.targetSource] || '推計'}）`);
  kv('競合店舗数', num(totals.competitors), '#,##0"件"');
  kv('想定配布コスト', num(totals.estimatedCost), '"約"#,##0"円"');
  if (scoring?.best) kv('最適エリア', `${townLabel(scoring.best.name)}（総合スコア ${scoring.best.score}点）`);
  const muni = scoring?.income?.municipal || [];
  if (muni.length) kv('平均所得（実データ）', muni.map((m) => `${m.city} 約${Math.round(m.avgIncomeYen / 10000).toLocaleString()}万円（${m.year}年）`).join('　'));
  if (opt) {
    const ix = num(opt.incomeIndex);
    kv('AI最適エリア', `${num(opt.sum)?.toLocaleString() ?? '—'}部（目標 約${num(opt.targetCopies)?.toLocaleString() ?? '—'}部）・${opt.areaCount ?? '—'}エリア・ピンから半径約${opt.maxDistanceKm ?? '—'}km${num(opt.targetTotal) ? `・ターゲット約${num(opt.targetTotal).toLocaleString()}人` : ''}${ix ? `・所得指数 ${ix.toFixed(2)}` : ''}`);
  }

  if (report.analysis?.explanation?.text) {
    heading(`■ AIによる分析${report.analysis.explanation.source === 'claude' ? '（Claude）' : '（ルールベース）'}`);
    para(report.analysis.explanation.text);
  }

  if (opt) {
    heading('■ AI最適エリアの作り方');
    const notes = [
      `ピンのある町丁目から、隣り合う町丁目へ順に広げました（飛び地なし${opt.islands ? `／やむを得ず${opt.islands}か所` : ''}）。`,
      '優先度 = 距離 ×（1 + 川・高速道路・国道・線路をまたぐ度合い）÷ ターゲット密度' + (INCOME_PREF_LABEL[opt.incomePref] ? `、所得指数が${INCOME_PREF_LABEL[opt.incomePref]}の町丁目を優先` : ''),
    ];
    if (opt.skippedByBarrier?.length) notes.push(`分断のため除外した近くの町丁目: ${opt.skippedByBarrier.slice(0, 8).map((x) => `${townLabel(x.name)}（${(x.barriers || []).slice(0, 2).join('・')}の向こう側）`).join('、')}`);
    if (opt.crossedBarriers?.length) notes.push(`部数を満たすためにまたいだもの: ${opt.crossedBarriers.slice(0, 6).join('、')}`);
    if (opt.barrierError) notes.push(`※ ${opt.barrierError}（川は町丁目の水面区画で考慮）`);
    para(notes.map((n) => `・${n}`).join('\n'));
  }

  if (scoring?.targetRanking?.length) {
    heading(`■ ターゲットが多いエリア（${scoring.targetProfile?.label || '指定属性'}）`);
    table([
      { header: '順位', value: (x) => x.rank, align: 'center' },
      { header: 'エリア', value: (x) => townLabel(x.name) },
      { header: 'ターゲット(人)', key: 'target', numFmt: '#,##0' },
      { header: '人口に占める割合', value: (x) => num(x.targetRate) != null ? x.targetRate / 100 : null, numFmt: '0.0%' },
      { header: '1部あたり(人)', key: 'targetPerCopy', numFmt: '0.00' },
    ], scoring.targetRanking.map((x, i) => ({ ...x, rank: i + 1 })));
  }

  if (scoring?.incomeRanking?.length && scoring.income?.estimated) {
    heading(`■ 所得指数が${scoring.incomePref === 'low' ? '低い' : '高い'}エリア（推計・市区町村平均 = 1.00）`);
    table([
      { header: '順位', value: (x) => x.rank, align: 'center' },
      { header: 'エリア', value: (x) => townLabel(x.name) },
      { header: '所得指数', key: 'incomeIndex', numFmt: '0.00' },
      { header: '水準', key: 'incomeLevel', align: 'center' },
    ], scoring.incomeRanking.map((x, i) => ({ ...x, rank: i + 1 })));
  }

  if (scoring?.areas?.length) {
    heading('■ エリア別スコア');
    const w = scoring.weights || {};
    para(`総合スコア = ${Object.entries(w).map(([k, v]) => `${AXIS_LABEL[k] || k}${Math.round(v * 100)}%`).join(' ＋ ')}（各軸は選択エリア内で0〜100点に換算）`, { color: 'FF595959' });
    const hasTarget = scoring.areas.some((a) => a.target != null);
    const hasIncome = scoring.areas.some((a) => a.incomeIndex != null);
    table([
      { header: '順位', value: (x) => x.rank, align: 'center' },
      { header: 'エリア', value: (x) => townLabel(x.name) },
      { header: '総合スコア', key: 'score', numFmt: '0' },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '配布部数', key: 'distribution', numFmt: '#,##0' },
      { header: '競合(件)', key: 'competitorCount', numFmt: '0' },
      ...(hasTarget ? [{ header: 'ターゲット(人)', key: 'target', numFmt: '#,##0' }] : []),
      ...(hasIncome ? [{ header: '所得指数', value: (x) => (x.incomeIndex != null ? `${x.incomeIndex.toFixed(2)} ${x.incomeLevel}` : null), align: 'center' }] : []),
      { header: '想定コスト(円)', key: 'estimatedCost', numFmt: '#,##0' },
    ], scoring.areas.map((x, i) => ({ ...x, rank: i + 1 })));
  }

  const companies = report.analysis?.quotes?.companyTotals || [];
  if (companies.length) {
    heading('■ 配布会社の見積（登録単価による概算）');
    table([
      { header: '会社', key: 'name', span: 2 },
      { header: '対応エリア数', key: 'areas', numFmt: '#,##0' },
      { header: '見積金額(円)', key: 'quote', numFmt: '#,##0' },
    ], companies);
  }

  heading('■ データの出典・注意');
  const notes = [
    '世帯数: 国勢調査（e-Stat）の町丁目・字別 世帯数。配布部数は世帯数×カバー率（10部未満切り捨て）。',
    scoring?.targetSource ? `ターゲット人数: ${SOURCE_LABEL[scoring.targetSource] || scoring.targetSource}。` : null,
    muni.length ? '平均所得: 総務省「市町村税課税状況等の調」由来の課税対象所得 ÷ 納税義務者数（e-Stat 社会・人口統計体系）。世帯年収ではありません。' : null,
    scoring?.income?.estimated && scoring.areas?.some((a) => a.incomeIndex != null)
      ? '所得指数（推計）: 国勢調査の「管理職・専門職の割合」「持ち家率」「夫婦と子どもの世帯の割合」「単身世帯の割合」から、市区町村内での相対的な高さを推計したもの（平均=1.00）。金額ではありません。'
      : null,
    '競合: Google Places（APIキー未設定時はサンプル）。分断要素: OpenStreetMap。',
    'AIの分析は判断材料です。実際の配布可否・単価は配布会社にご確認ください。',
  ].filter(Boolean);
  para(notes.map((n) => `・${n}`).join('\n'), { color: 'FF595959' });

  ws.pageSetup.printArea = `A1:${lastCol}${r}`;
  return ws;
}

// exceljs は <xdr:oneCellAnchor> に editAs 属性を付けるが、これは twoCellAnchor 専用で
// スキーマ違反（Excelの修復ダイアログや、他ツールで画像が読み飛ばされる原因）。出力後に取り除く。
export function fixDrawingAnchors(xlsxBuffer) {
  const zip = new AdmZip(xlsxBuffer);
  let changed = false;
  for (const e of zip.getEntries()) {
    if (!/^xl\/drawings\/drawing\d+\.xml$/.test(e.entryName)) continue;
    const xml = e.getData().toString('utf8');
    const fixed = xml.replace(/<xdr:oneCellAnchor\s+editAs="[^"]*"\s*>/g, '<xdr:oneCellAnchor>');
    if (fixed !== xml) { zip.updateFile(e.entryName, Buffer.from(fixed, 'utf8')); changed = true; }
  }
  return changed ? zip.toBuffer() : xlsxBuffer;
}
