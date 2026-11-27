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
  const customerSheet = p.customerReport ? addCustomerReportSheet(wb, p.customerReport, { title, rate }) : null;

  const buffer = fixDrawingAnchors(Buffer.from(await wb.xlsx.writeBuffer()));
  return { buffer, title, sheetName: ws.name, reportSheetName: reportSheet?.name || null, customerSheetName: customerSheet?.name || null, totalCopies, copies };
}

// ======================================================================
// AI分析レポート（エリア表とは別シート）
// report: { generatedAt, conditions:{businessType,target,incomePref,targetCopies,center,storeName},
//           analysis:{ scoring, explanation:{text,source,model}, quotes }, optimize:{...} }
// ======================================================================
export const REPORT_SHEET_NAME = 'AI分析レポート';
const BLUE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } };
const SOURCE_LABEL = { census: '国勢調査（町丁目の年齢・男女別人口）', mixed: '国勢調査＋一部は全国の年齢構成で推計', estimate: '全国の年齢構成による推計' };
const AXIS_LABEL = { reach: '到達（世帯数）', target: 'ターゲット', income: '所得層', customer: '顧客実績', opportunity: '競合機会', efficiency: '配布効率', cost: 'コスト' };
const INCOME_PREF_LABEL = { high: '高め', low: '低め' };

const num = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);

function createReportSheet(wb, name) {
  const ws = wb.addWorksheet(name, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
  ws.columns = [
    { width: 2 }, { width: 6 }, { width: 26 }, { width: 13 }, { width: 13 }, { width: 13 },
    { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 },
  ];
  const lastCol = 'K';
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
    const letters = 'BCDEFGHIJK';
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
  const title = (text, sub) => {
    ws.mergeCells(`B${r}:${lastCol}${r}`);
    cell(`B${r}`, text, { font: { bold: true, size: 14 } });
    ws.getRow(r).height = 26;
    r += 1;
    if (sub) {
      ws.mergeCells(`B${r}:${lastCol}${r}`);
      cell(`B${r}`, sub, { font: { color: { argb: 'FF7F7F7F' }, size: 10 } });
      r += 1;
    }
  };
  const finish = () => { ws.pageSetup.printArea = `A1:${lastCol}${r}`; return ws; };
  return { ws, cell, heading, kv, para, table, title, finish };
}

const fmtDateTime = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function addReportSheet(wb, report = {}, ctx = {}) {
  const { heading, kv, para, table, title, finish } = createReportSheet(wb, REPORT_SHEET_NAME);

  const cond = report.conditions || {};
  const scoring = report.analysis?.scoring || null;
  const totals = scoring?.totals || {};
  const opt = report.optimize || null;
  const generated = report.generatedAt ? new Date(report.generatedAt) : new Date();

  title(`AI分析レポート ${ctx.title ? `― ${ctx.title}` : ''}`, `作成日時: ${fmtDateTime(generated)}`);

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
  if (num(totals.customers) != null && scoring?.customerRanking?.length) kv('顧客（選択エリア内）', `約${Math.round(num(totals.customers)).toLocaleString()}人${num(scoring.customerTotal) ? `（取り込んだ顧客 ${num(scoring.customerTotal).toLocaleString()}人のうち）` : ''}`);
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

  if (scoring?.customerRanking?.length) {
    heading('■ 顧客が多いエリア（取り込んだ顧客データ）');
    table([
      { header: '順位', value: (x) => x.rank, align: 'center' },
      { header: 'エリア', value: (x) => townLabel(x.name) },
      { header: '顧客(人)', key: 'customers', numFmt: '#,##0.#' },
      { header: '1000世帯あたり', key: 'customerPer1000', numFmt: '0.00' },
    ], scoring.customerRanking.map((x, i) => ({ ...x, rank: i + 1 })));
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
      ...(scoring.areas.some((a) => a.customers > 0) ? [{ header: '顧客(人)', key: 'customers', numFmt: '#,##0.#' }] : []),
      ...(hasIncome ? [{ header: '所得指数', value: (x) => (x.incomeIndex != null ? `${x.incomeIndex.toFixed(2)} ${x.incomeLevel}` : null), align: 'center' }] : []),
      { header: '想定コスト(円)', key: 'estimatedCost', numFmt: '#,##0' },
    ], scoring.areas.map((x, i) => ({ ...x, rank: i + 1 })));
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

  return finish();
}

// ======================================================================
// 顧客分析レポート（顧客データ → 商圏・顧客の多い町丁目 → 絞り込んだ配布エリア）
// 個人の情報は含めず、町丁目・距離帯・年齢層ごとの集計だけを載せる
// cr: { generatedAt, summary, center, radius, distanceBands, ageBands, ageSuggest, cities, towns, area, overallPer1000 }
// ======================================================================
export const CUSTOMER_SHEET_NAME = '顧客分析レポート';

export function addCustomerReportSheet(wb, cr = {}, ctx = {}) {
  const { heading, kv, para, table, title, finish } = createReportSheet(wb, CUSTOMER_SHEET_NAME);
  const sm = cr.summary || {};
  const rad = cr.radius || {};
  const area = cr.area || null;
  const towns = (cr.towns || []).filter((t) => t.customers > 0);
  const pct = (a, b) => (b ? a / b : null);
  const name = (t) => `${t.city ? `${t.city} ` : ''}${townLabel(t.name)}`;
  const fix1 = (v) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : null);

  title(`顧客分析レポート ${ctx.title ? `― ${ctx.title}` : ''}`, `作成日時: ${fmtDateTime(cr.generatedAt ? new Date(cr.generatedAt) : new Date())}`);

  // ---- 結論 ----
  heading('■ 結論：顧客分析から絞り込んだ配布エリア');
  const lines = [];
  if (rad['0.8']) lines.push(`商圏: 顧客の50%が📍から約${rad['0.5']}km、80%が約${rad['0.8']}km、90%が約${rad['0.9']}km以内に住んでいます。配布は約${rad['0.8']}km圏を中心に組むのが効率的です。`);
  const top = [...towns].sort((a, b) => b.customers - a.customers).slice(0, 5);
  if (top.length) lines.push(`顧客が多い町丁目: ${top.map((t) => `${townLabel(t.name)}（${fix1(t.customers)}人）`).join('、')}。`);
  const dense = towns.filter((t) => t.customers >= 2 && t.per1000 != null).sort((a, b) => b.per1000 - a.per1000).slice(0, 3);
  if (dense.length) lines.push(`世帯あたりで顧客が多い（浸透している）町丁目: ${dense.map((t) => `${townLabel(t.name)}（1000世帯あたり${t.per1000}人）`).join('、')}。似た地域性の周辺の町丁目も反応が見込めます。`);
  if (cr.ageSuggest) lines.push(`顧客の年齢: 中央値${cr.ageSuggest.median}歳、80%が${cr.ageSuggest.min}〜${cr.ageSuggest.max}歳。ターゲットはこの年齢層が目安です。`);
  if (area) {
    const share = pct(area.customers, sm.matched);
    const ratio = area.per1000 && cr.overallPer1000 ? area.per1000 / cr.overallPer1000 : null;
    lines.push(`配布エリア${area.optimized ? '（🤖 顧客データを使ってAIが作成）' : ''}: ${area.townCount}町丁目・${(area.copies || 0).toLocaleString()}部。` +
      `エリア内の顧客は約${fix1(area.customers)}人${share != null ? `（顧客全体の${Math.round(share * 100)}%）` : ''}、1000世帯あたり${area.per1000}人` +
      `${ratio ? `（顧客のいる町丁目全体の${ratio.toFixed(1)}倍）` : ''}です。`);
  }
  const rv = cr.review || null;
  if (rv?.diff?.summary) lines.push(`前回エリアからの見直し: ${rv.diff.summary}（町丁目ごとの根拠は下の「配布エリアの見直し」）`);
  else if (rv?.suggestion?.summary) lines.push(`前回エリアの見直し案: ${rv.suggestion.summary}`);
  const cands = rv ? [] : (cr.candidates || []).slice(0, 5);
  if (cands.length) lines.push(`追加候補（エリア外で顧客が多い）: ${cands.map((t) => `${townLabel(t.name)}（${fix1(t.customers)}人）`).join('、')}。部数に余裕があれば追加を検討してください。`);
  para(lines.map((l) => `・${l}`).join('\n'));

  // ---- 顧客データ ----
  // ---- 傾向・見直しの根拠（前回の配布エリアを比較元にした分析） ----
  if (rv) addReviewSections({ heading, para, table, kv }, rv, { name, fix1 });

  heading('■ 取り込んだ顧客データ');
  kv('顧客数', sm.total != null ? `${sm.total.toLocaleString()}人${sm.excluded ? `（退会者 ${sm.excluded}人を除く）` : ''}` : null);
  kv('町丁目に対応', sm.matched != null ? `${sm.matched.toLocaleString()}人（丁目まで ${sm.chome ?? '—'}人・町名まで ${sm.town ?? '—'}人）` : null);
  kv('対応できなかった', sm.unmatched ? `${sm.unmatched}人（住所の誤り・町名の不一致など。集計には含めていません）` : null);
  kv('店舗', sm.store || null);
  kv('中心地（📍）', cr.center || null);

  // ---- 距離 ----
  if (cr.distanceBands?.length) {
    heading('■ 📍からの距離別の顧客');
    const tot = cr.distanceBands.reduce((a, b) => a + b.count, 0);
    let cum = 0;
    table([
      { header: '距離', key: 'label', span: 2 },
      { header: '顧客(人)', value: (x) => fix1(x.count), numFmt: '#,##0.#' },
      { header: '割合', value: (x) => pct(x.count, tot), numFmt: '0.0%' },
      { header: '累計', value: (x) => { cum += x.count; return pct(cum, tot); }, numFmt: '0.0%' },
    ], cr.distanceBands);
  }

  // ---- 年齢 ----
  if (cr.ageBands?.some((b) => b.count > 0)) {
    heading('■ 顧客の年齢層');
    const tot = cr.ageBands.reduce((a, b) => a + b.count, 0);
    table([
      { header: '年齢層', key: 'label', span: 2 },
      { header: '人数', key: 'count', numFmt: '#,##0' },
      { header: '割合', value: (x) => pct(x.count, tot), numFmt: '0.0%' },
    ], cr.ageBands);
  }

  // ---- 市区町村 ----
  if (cr.cities?.length) {
    heading('■ 市区町村別の顧客');
    const tot = cr.cities.reduce((a, b) => a + b.count, 0);
    table([
      { header: '市区町村', key: 'name', span: 2 },
      { header: '顧客(人)', value: (x) => fix1(x.count), numFmt: '#,##0.#' },
      { header: '割合', value: (x) => pct(x.count, tot), numFmt: '0.0%' },
    ], cr.cities);
  }

  // ---- 町丁目 ----
  if (towns.length) {
    heading('■ 顧客が多い町丁目（上位20）');
    table([
      { header: '順位', value: (x) => x.rank, align: 'center' },
      { header: '町丁目', value: name, span: 2 },
      { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '1000世帯あたり', key: 'per1000', numFmt: '0.0' },
      { header: '📍から(km)', key: 'distanceKm', numFmt: '0.0' },
      { header: '配布エリア', value: (x) => (x.selected ? '○' : ''), align: 'center' },
    ], [...towns].filter((t) => t.customers >= 0.5).sort((a, b) => b.customers - a.customers).slice(0, 20).map((t, i) => ({ ...t, rank: i + 1 })));
  }

  // ---- 絞り込んだ配布エリア ----
  if (area?.towns?.length) {
    heading(`■ 絞り込んだ配布エリア（${area.townCount}町丁目・${(area.copies || 0).toLocaleString()}部）`);
    table([
      { header: '町丁目', value: name, span: 2 },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '配布部数', key: 'copies', numFmt: '#,##0' },
      { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
      { header: '1000世帯あたり', key: 'per1000', numFmt: '0.0' },
    ], [...area.towns].sort((a, b) => (b.customers || 0) - (a.customers || 0)));
  }

  // ---- 追加候補 ----
  if (cr.candidates?.length) {
    heading('■ 追加候補（配布エリア外で顧客が多い町丁目）');
    table([
      { header: '町丁目', value: name, span: 2 },
      { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '1000世帯あたり', key: 'per1000', numFmt: '0.0' },
      { header: '📍から(km)', key: 'distanceKm', numFmt: '0.0' },
    ], cr.candidates.slice(0, 10));
  }

  heading('■ 分析方法・注意');
  para([
    '・顧客の住所を町丁目に照合して集計しています（外部の地図サービスは使っていません）。丁目が書かれていない住所は、その町の丁目に均等に割り振っています（小数になることがあります）。',
    '・距離は📍から町丁目の中心までの直線距離で近似しています。',
    '・世帯数は国勢調査（または貼り付けた世帯数）。1000世帯あたりの顧客数は、顧客の多さを町の大きさで割った「浸透度」の目安です。',
    '・このシートには氏名・住所・年齢などの個人の情報は含めず、町丁目・距離・年齢層ごとの集計だけを載せています。',
  ].join('\n'), { color: 'FF595959' });

  return finish();
}


// 顧客分析レポートの「傾向」「配布エリアの見直し（削除・追加の根拠）」
// rv: services/customerReview.js reviewArea() の結果
function addReviewSections({ heading, para, table, kv }, rv, { name, fix1 }) {
  const tr = rv.trends || {};
  heading('■ 顧客分布の傾向');
  if (tr.bullets?.length) para(tr.bullets.map((b) => `・${b}`).join('\n'));
  if (tr.sectors?.length) {
    heading(`■ 方位別の浸透度（店舗から${rv.radiusKm}km以内・1000世帯あたりの顧客数）`);
    table([
      { header: '方位', key: 'dir', align: 'center' },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
      { header: '1000世帯あたり', key: 'per1000', numFmt: '0.00' },
      { header: 'うち前回エリア 世帯', key: 'baseHouseholds', numFmt: '#,##0' },
      { header: '前回エリア 顧客(人)', value: (x) => fix1(x.baseCustomers), numFmt: '#,##0.#' },
      { header: '前回エリア 1000世帯あたり', key: 'basePer1000', numFmt: '0.00' },
    ], tr.sectors);
  }
  if (tr.distanceBands?.length) {
    heading('■ 距離帯別の浸透度（1000世帯あたりの顧客数）');
    table([
      { header: '距離', key: 'label', span: 2 },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
      { header: '1000世帯あたり', key: 'per1000', numFmt: '0.00' },
      { header: 'うち前回エリア 世帯', key: 'baseHouseholds', numFmt: '#,##0' },
    ], tr.distanceBands);
  }

  const d = rv.diff;
  const sg = rv.suggestion || {};
  const townTable = (rows, { expected = false } = {}) => table([
    { header: '町丁目', value: name, span: 2 },
    { header: '配布部数', key: 'copies', numFmt: '#,##0' },
    { header: '世帯数', key: 'households', numFmt: '#,##0' },
    { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
    ...(expected ? [{ header: '平均なら(人)', key: 'expected', numFmt: '0.0' }] : [{ header: '1000世帯あたり', key: 'per1000', numFmt: '0.00' }]),
    { header: '方位・距離', value: (x) => `${x.dir} ${x.distanceKm}km`, align: 'center' },
  ], rows);
  const reasons = (rows) => para(rows.map((t) => `・${name(t)}（${(t.copies || 0).toLocaleString()}部）: ${t.reason}`).join('\n'));

  if (d) {
    heading('■ 配布エリアの見直し（前回 → 今回）');
    kv('前回', `${d.before.towns}町丁目・${d.before.copies.toLocaleString()}部・エリア内の顧客 ${fix1(d.before.customers)}人（1000世帯あたり${d.before.per1000}人）`);
    kv('今回', `${d.after.towns}町丁目・${d.after.copies.toLocaleString()}部・エリア内の顧客 ${fix1(d.after.customers)}人（1000世帯あたり${d.after.per1000}人）`);
    para(d.summary);
    if (d.removed.length) {
      heading(`■ 削除した町丁目と根拠（${d.removed.length}町丁目・${d.removed.reduce((s, t) => s + (t.copies || 0), 0).toLocaleString()}部）`);
      townTable(d.removed, { expected: true });
      reasons(d.removed);
    }
    if (d.added.length) {
      heading(`■ 追加した町丁目と根拠（${d.added.length}町丁目・${d.added.reduce((s, t) => s + (t.copies || 0), 0).toLocaleString()}部）`);
      townTable(d.added);
      reasons(d.added);
    }
  } else {
    heading('■ 配布エリアの見直し案（前回エリアのまま出力しています）');
    para(sg.summary || '');
    if (sg.removed?.length) {
      heading('■ 削除を提案する町丁目と根拠');
      townTable(sg.removed, { expected: true });
      reasons(sg.removed);
    }
    if (sg.added?.length) {
      heading('■ 追加を提案する町丁目と根拠');
      townTable(sg.added);
      reasons(sg.added);
    }
  }
  if (sg.keptZero?.length) {
    heading('■ 顧客0人だが残した町丁目（周辺が濃く、偶然の可能性があるため）');
    para(sg.keptZero.map((t) => `・${name(t)}: ${t.reason}`).join('\n'));
  }
  if (sg.watch?.length) {
    heading('■ 様子見の町丁目（顧客0人だが、偶然の範囲）');
    para(sg.watch.map((t) => `・${name(t)}: ${t.reason}`).join('\n'));
  }
  if (sg.extraCandidates?.length) {
    heading('■ その他の追加候補（顧客がいる未配布の町丁目）');
    table([
      { header: '町丁目', value: name, span: 2 },
      { header: '顧客(人)', value: (x) => fix1(x.customers), numFmt: '#,##0.#' },
      { header: '世帯数', key: 'households', numFmt: '#,##0' },
      { header: '1000世帯あたり', key: 'per1000', numFmt: '0.00' },
      { header: '方位・距離', value: (x) => `${x.dir} ${x.distanceKm}km`, align: 'center' },
    ], sg.extraCandidates);
  }
  para([
    '・浸透度 = 町丁目に住む顧客数 ÷ 世帯数（1000世帯あたり）。「平均なら」は前回エリアの平均の浸透度で世帯数を掛けた期待値です。',
    '・削除の判断: 顧客0人・平均なら0.8人以上いるはず・隣接する前回エリアを含めた周辺の浸透度も平均の6割未満、の町丁目をまとめ、偶然0人になる確率（ポアソン分布）が10%未満のときだけ削除しています。',
    '・追加の判断: 未配布なのに顧客がいて、浸透度が前回エリア平均の5割以上、かつ残したエリアに隣接する町丁目を、浸透度の高い順に、削除で浮いた部数の範囲で追加しています。',
    '・顧客はチラシ以外（紹介・SNSなど）から来た人も含みます。入会経路が分かれば、チラシ経由だけで分析するとより正確です。',
  ].join('\n'), { color: 'FF595959' });
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
