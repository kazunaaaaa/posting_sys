import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { distanceMeters, uid } from './lib/geo.js';
import { pickByCount } from './lib/selectByCount.js';
import { buildMapImage } from './lib/mapImage.js';
import { townLabel } from './lib/labels.js';
import { COLORS } from './lib/colors.js';
import { DEFAULT_RATE, withRate, rateFromPercent } from './lib/distribution.js';
import { decodeText, parseCsv, detectColumns, extractCustomers, aggregate, radiusPercentiles, suggestProfile } from './lib/customers.js';

// 「📍から約 N 部を追加」の選択肢
const COUNT_OPTIONS = [1000, 2000, 3000, 5000, 10000, 15000, 20000, 30000, 50000, 100000];
import GoogleMapView from './components/GoogleMapView.jsx';
import SvgMapView from './components/SvgMapView.jsx';

export default function App() {
  const [config, setConfig] = useState(null);
  // 世帯カバー率（％入力。既定70%）: 配布部数 = 世帯数 × カバー率（10部未満切り捨て）
  const [ratePct, setRatePct] = useState(String(DEFAULT_RATE * 100));
  const rate = rateFromPercent(ratePct) ?? DEFAULT_RATE;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const [mode, setMode] = useState('town'); // 'town' | 'municipality'

  // 町丁目モード（e-Stat 小地域の実境界。市区町村単位で読み込む）
  const [townAreas, setTownAreas] = useState([]);
  const [townCities, setTownCities] = useState([]); // [{code, name, count}]
  const [townPref, setTownPref] = useState('');
  const [townPrefMunis, setTownPrefMunis] = useState([]);
  const [townKeyword, setTownKeyword] = useState('');
  const [townErr, setTownErr] = useState('');
  const [townStatus, setTownStatus] = useState(null); // 取得済み市区町村数
  // 市区町村モード
  const [prefectures, setPrefectures] = useState([]);
  const [pref, setPref] = useState('');
  const [prefMunis, setPrefMunis] = useState([]);
  const [muniSource, setMuniSource] = useState(null);
  const [boundaryMap, setBoundaryMap] = useState({});
  const [muniKeyword, setMuniKeyword] = useState('');

  const [selected, setSelected] = useState([]);
  const [businessTypes, setBusinessTypes] = useState([]);
  const [businessTypeId, setBusinessTypeId] = useState('');
  const [competitors, setCompetitors] = useState([]);
  const [competitorSource, setCompetitorSource] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState({});
  const [unitCost, setUnitCost] = useState(5.5);

  // 範囲選択（円）
  const [circles, setCircles] = useState([]); // {id, lat, lng, radiusKm}
  const [radiusKm, setRadiusKm] = useState(1);
  const [addrQuery, setAddrQuery] = useState('');
  const [addrMsg, setAddrMsg] = useState('');
  const mapApiRef = useRef(null);
  const handleApi = useCallback((a) => { mapApiRef.current = a; }, []);
  const circlesRef = useRef(circles); // 地図イベントから最新の円を参照するため
  circlesRef.current = circles;

  // 中心地のピン・部数指定
  const [pin, setPin] = useState(null); // {lat, lng}
  const [countTarget, setCountTarget] = useState(10000);
  const [countMsg, setCountMsg] = useState('');

  // ターゲット属性（業態を選ぶと標準値が入る。自由に変更可）
  const [profile, setProfile] = useState({ ageMin: '', ageMax: '', sex: 'all' });
  const [incomePref, setIncomePref] = useState(''); // '' | 'high' | 'low'
  // AI最適エリアの結果と、地図に描く分断線（川・道路・線路）
  const [optResult, setOptResult] = useState(null);
  const [barriers, setBarriers] = useState([]);

  // 配布部数表（Excel）
  const [storeName, setStoreName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [titleCopies, setTitleCopies] = useState(''); // 空なら合計を1,000部単位に丸めた値
  const [exportMsg, setExportMsg] = useState('');

  // エリア表の貼り付け（Excelからコピー → 地図に反映）
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteReplace, setPasteReplace] = useState(true);   // 今の選択を置き換える
  const [pasteUseHh, setPasteUseHh] = useState(true);       // 貼り付けた世帯数を使う
  const [pasteResult, setPasteResult] = useState(null);

  // 顧客データ（CSV）。ブラウザのメモリ内だけに保持（保存しない）
  const [cust, setCust] = useState(null); // { fileName, list, cols, match, stores }
  const [custOpts, setCustOpts] = useState({ excludeWithdrawn: true, store: '', show: true, use: true, inExcel: false });
  const [custMsg, setCustMsg] = useState('');

  // 非同期処理の途中でも最新の町丁目を参照するための参照
  const townAreasRef = useRef(townAreas);
  townAreasRef.current = townAreas;
  const townCitiesRef = useRef(townCities);
  townCitiesRef.current = townCities;

  useEffect(() => {
    api.config().then(setConfig);
    api.businessTypes().then((d) => setBusinessTypes(d.categories));
    api.prefectures().then((d) => setPrefectures(d.prefectures));
    api.townsStatus().then(setTownStatus).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 町丁目の読み込み（市区町村単位）----
  async function changeTownPref(p) {
    setTownPref(p); setTownKeyword('');
    if (!p) { setTownPrefMunis([]); return; }
    const d = await api.municipalities({ pref: p });
    setTownPrefMunis(d.municipalities.map((m) => withRate(m, rateRef.current)));
  }

  // 市区町村の町丁目を読み込む。quiet=true のときは失敗してもエラー枠を出さず例外を投げる。
  async function loadTownCity(code, name, { quiet = false } = {}) {
    if (townCitiesRef.current.some((c) => c.code === code)) return [];
    if (!quiet) setTownErr('');
    setLoading((l) => ({ ...l, town: name }));
    try {
      const d = await api.towns(code);
      const have = new Set(townAreasRef.current.map((t) => t.code));
      const added = d.towns.filter((t) => !have.has(t.code)).map((t) => withRate(t, rateRef.current));
      townAreasRef.current = [...townAreasRef.current, ...added];
      townCitiesRef.current = [...townCitiesRef.current, { code, name, count: d.towns.length }];
      setTownAreas(townAreasRef.current);
      setTownCities(townCitiesRef.current);
      return added;
    } catch (e) {
      if (quiet) throw e;
      setTownErr(`${name}の町丁目を取得できませんでした。\n${e.message}`);
      return [];
    } finally {
      setLoading((l) => ({ ...l, town: null }));
    }
  }

  function unloadTownCity(code) {
    townAreasRef.current = townAreasRef.current.filter((t) => t.cityCode !== code);
    townCitiesRef.current = townCitiesRef.current.filter((c) => c.code !== code);
    setTownAreas(townAreasRef.current);
    setTownCities(townCitiesRef.current);
    setSelected((prev) => prev.filter((s) => !s.startsWith(code)));
    setAnalysis(null);
  }

  // モード切替時に選択をリセット
  function switchMode(m) {
    setMode(m); setSelected([]); setCircles([]); setCompetitors([]); setCompetitorSource(null); setAnalysis(null);
    setCountMsg(''); setExportMsg('');
  }

  async function changePref(p) {
    setPref(p); setAnalysis(null);
    if (!p) { setPrefMunis([]); return; }
    setLoading((l) => ({ ...l, muni: true }));
    try {
      const d = await api.municipalities({ pref: p });
      setPrefMunis(d.municipalities.map((m) => withRate(m, rateRef.current)));
      setMuniSource(d.source);
    } finally { setLoading((l) => ({ ...l, muni: false })); }
  }

  // カバー率を変えたら、読み込み済みの全エリアの配布部数を計算し直す
  const rateAppliedRef = useRef(rate);
  useEffect(() => {
    if (rateAppliedRef.current === rate) return;
    rateAppliedRef.current = rate;
    townAreasRef.current = townAreasRef.current.map((t) => withRate(t, rate));
    setTownAreas(townAreasRef.current);
    setPrefMunis((l) => l.map((m) => withRate(m, rate)));
    setTownPrefMunis((l) => l.map((m) => withRate(m, rate)));
    setAnalysis(null);
    setOptResult(null); // 作成時の部数と合わなくなるため
  }, [rate]);

  // 現在モードの全エリア
  const currentAreas = mode === 'town' ? townAreas : prefMunis;
  const byCode = useMemo(() => Object.fromEntries(currentAreas.map((a) => [a.code, a])), [currentAreas]);
  const selectedAreas = useMemo(() => selected.map((c) => byCode[c]).filter(Boolean), [selected, byCode]);

  // 選択中エリアを市区町村ごとにまとめる（右パネル表示用）
  const selectedGroups = useMemo(() => {
    const groups = new Map();
    for (const a of selectedAreas) {
      const key = mode === 'town' ? a.cityCode : a.pref;
      if (!groups.has(key)) groups.set(key, { key, label: mode === 'town' ? `${a.pref}　${a.city}` : a.pref, areas: [], copies: 0 });
      const g = groups.get(key);
      g.areas.push(a);
      g.copies += a.distribution || 0;
    }
    return [...groups.values()];
  }, [selectedAreas, mode]);

  function deselectGroup(g) {
    const codes = new Set(g.areas.map((a) => a.code));
    setSelected((prev) => prev.filter((c) => !codes.has(c)));
    setAnalysis(null);
  }

  const totalHouseholds = selectedAreas.reduce((s, a) => s + (a.households || 0), 0);
  const hasNullHh = selectedAreas.some((a) => a.households == null);
  const totalDistribution = selectedAreas.reduce((s, a) => s + (a.distribution || 0), 0);
  const estCost = Math.round(totalDistribution * unitCost);
  // 配布部数表のタイトル用（例: 30,460部 → 30000部エリア）
  const autoTitleCopies = totalDistribution >= 1000 ? Math.round(totalDistribution / 1000) * 1000 : totalDistribution;

  const scoreByCode = useMemo(() => {
    if (!analysis) return null;
    return Object.fromEntries(analysis.scoring.areas.map((a) => [a.code, a.score]));
  }, [analysis]);
  const bestCode = analysis?.scoring?.best?.code;
  // 顧客の集計（退会者・店舗の絞り込み後）
  const custList = useMemo(() => (cust ? cust.list.filter((c) => !(custOpts.excludeWithdrawn && c.withdrawn) && (!custOpts.store || c.store === custOpts.store)) : []),
    [cust, custOpts.excludeWithdrawn, custOpts.store]);
  const custAgg = useMemo(() => (cust?.match ? aggregate(custList, cust.match) : null), [custList, cust]);
  const custRadius = useMemo(() => (custAgg && pin ? radiusPercentiles(custAgg.markers, pin) : null), [custAgg, pin]);
  const custProfile = useMemo(() => suggestProfile(custList), [custList]);
  const custMarkers = custOpts.show && custAgg ? custAgg.markers : [];
  const hasIncomeCol = !!analysis?.scoring?.areas?.some((a) => a.incomeLevel && a.incomeLevel !== '—');
  const businessIcon = businessTypes.find((b) => b.id === businessTypeId)?.icon;

  async function toggle(code) {
    setAnalysis(null);
    const isSel = selected.includes(code);
    setSelected((prev) => (isSel ? prev.filter((c) => c !== code) : [...prev, code]));
    // 市区町村モードは選択時に境界をオンデマンド取得
    if (!isSel && mode === 'municipality' && !boundaryMap[code]) {
      try {
        const d = await api.boundaries([code]);
        const b = d.boundaries[0];
        if (b && !b.error) setBoundaryMap((m) => ({ ...m, [code]: b }));
      } catch { /* noop */ }
    }
  }

  function clearAll() {
    setSelected([]); setCircles([]); setCompetitors([]); setCompetitorSource(null); setAnalysis(null);
    setBarriers([]); setOptResult(null);
    setCountMsg(''); setExportMsg('');
  }

  // ---- 範囲選択（円） ----
  // 現在モードの各エリアの中心（町丁目=重心, 市区町村=代表点）
  const areaCenters = useMemo(() => currentAreas.map((a) => ({
    code: a.code,
    lat: mode === 'town' ? a.center.lat : a.lat,
    lng: mode === 'town' ? a.center.lng : a.lng,
  })), [currentAreas, mode]);

  function codesInCircle(circle) {
    return areaCenters
      .filter((a) => distanceMeters(circle.lat, circle.lng, a.lat, a.lng) <= circle.radiusKm * 1000)
      .map((a) => a.code);
  }

  // 市区町村モード: コード群の境界をまとめて取得しキャッシュ
  async function ensureBoundaries(codes) {
    if (mode !== 'municipality') return;
    const missing = codes.filter((c) => !boundaryMap[c]);
    if (!missing.length) return;
    try {
      const d = await api.boundaries(missing);
      setBoundaryMap((m) => {
        const next = { ...m };
        for (const b of d.boundaries) if (b && !b.error) next[b.code] = b;
        return next;
      });
    } catch { /* noop */ }
  }

  function selectCodes(codes) {
    if (!codes.length) return;
    setAnalysis(null);
    setSelected((prev) => Array.from(new Set([...prev, ...codes])));
    ensureBoundaries(codes);
  }

  // ---- 中心地のピン ----
  // ピンが無ければ地図の中心に立てて返す
  function ensurePin() {
    if (pin) return pin;
    const c = mapApiRef.current?.getCenter?.();
    if (!c) return null;
    setPin(c);
    return c;
  }

  function movePinToCenter() {
    const c = mapApiRef.current?.getCenter?.();
    if (c) setPin(c);
  }

  // 円は「その円で選んだコード(codes)」を保持し、移動・縮小で外れたものだけ解除する
  // drawOnly=true のときは円を描くだけ（エリアは選択しない。動かしても選択は変わらない）
  function addCircleAtPin(drawOnly = false) {
    const c = ensurePin();
    if (!c) return;
    const circle = { id: uid('circle'), lat: c.lat, lng: c.lng, radiusKm: Number(radiusKm) || 1 };
    if (drawOnly === true) {
      setCircles((prev) => [...prev, { ...circle, codes: [], drawOnly: true }]);
      return;
    }
    const codes = codesInCircle(circle);
    setCircles((prev) => [...prev, { ...circle, codes }]);
    selectCodes(codes);
  }

  // AI・部数指定で選んだエリアに付ける円（選択は変えない。動かすと通常の円として範囲内を選択）
  function autoCircle(center, maxDistanceKm, codes, tag) {
    const radiusKm = Math.max(0.1, Math.ceil((Number(maxDistanceKm) || 0.1) * 10) / 10);
    return { id: uid('circle'), lat: center.lat, lng: center.lng, radiusKm, codes: [...codes], tag };
  }

  function onCircleChange(id, next) {
    const all = circlesRef.current;
    const cur = all.find((c) => c.id === id);
    if (!cur) return;
    // 変化のない通知（地図側の再描画など）は無視
    if (Math.abs(cur.lat - next.lat) < 1e-9 && Math.abs(cur.lng - next.lng) < 1e-9 && Math.abs(cur.radiusKm - next.radiusKm) < 0.005) return;
    if (cur.drawOnly) { // 表示のみの円は位置・大きさだけ更新
      const updated = all.map((c) => (c.id === id ? { ...cur, ...next } : c));
      circlesRef.current = updated;
      setCircles(updated);
      return;
    }
    const moved = { ...cur, ...next, tag: undefined };
    const newCodes = codesInCircle(moved);
    const newSet = new Set(newCodes);
    const others = new Set(all.filter((c) => c.id !== id).flatMap((c) => c.codes || []));
    const drop = new Set((cur.codes || []).filter((code) => !newSet.has(code) && !others.has(code)));
    const updated = all.map((c) => (c.id === id ? { ...moved, codes: newCodes } : c));
    circlesRef.current = updated;
    setCircles(updated);
    setAnalysis(null);
    setSelected((prev) => Array.from(new Set([...prev.filter((code) => !drop.has(code)), ...newCodes])));
    ensureBoundaries(newCodes);
  }

  function removeCircle(id) {
    const target = circles.find((c) => c.id === id);
    const remaining = circles.filter((c) => c.id !== id);
    setCircles(remaining);
    if (!target) return;
    const removed = new Set(target.codes || []);
    const keep = new Set(remaining.flatMap((c) => c.codes || []));
    setSelected((prev) => prev.filter((code) => keep.has(code) || !removed.has(code)));
    setAnalysis(null);
  }

  async function searchAddress(e) {
    e?.preventDefault?.();
    const q = addrQuery.trim();
    if (!q) return;
    const geocode = mapApiRef.current?.geocode;
    if (!geocode) { setAddrMsg('住所検索はGoogle Maps接続時に利用できます'); return; }
    setAddrMsg('検索中…');
    try {
      const r = await geocode(q);
      const p = { lat: r.lat, lng: r.lng };
      mapApiRef.current.panTo(p, 15);
      setPin(p); // 検索した住所に中心地のピンを立てる
      setAddrMsg(`📍 ${r.formatted || q}`);
    } catch { setAddrMsg('住所が見つかりませんでした'); }
  }

  // ---- 👥 顧客データ（CSV）----
  function customersPayload() {
    return custOpts.use && custAgg?.markers.length ? custAgg.byCode : null;
  }

  async function loadCustomerFile(file) {
    if (!file) return;
    setCustMsg('読み込み中…');
    try {
      const rows = parseCsv(decodeText(await file.arrayBuffer()));
      const cols = detectColumns(rows[0] || []);
      if (!cols.ok) throw new Error('住所の列が見つかりません（1行目の見出しに「住所」「都道府県」「市区町村」などが必要です）');
      const list = extractCustomers(rows, cols);
      if (!list.length) throw new Error('住所の入った行がありません');
      setCustMsg(`${list.length.toLocaleString()}件の住所を町丁目に照合中…（初回は町丁目データの取得に少しかかります）`);
      // サーバー（このMacの中）へは行番号・都道府県・住所だけを送る
      const match = await api.matchCustomers(list.map((c) => ({ i: c.i, pref: c.pref, address: c.address })));
      const stores = [...new Set(list.map((c) => c.store).filter(Boolean))];
      setCust({ fileName: file.name, list, cols, match, stores });
      setCustOpts((o) => ({ ...o, store: '' }));
      setAnalysis(null);
      // 顧客の多い市区町村の町丁目を地図に読み込む
      const main = match.cities.filter((c) => c.count >= Math.max(2, list.length * 0.05));
      for (const c of main) {
        setCustMsg(`${c.name}の町丁目を読み込み中…`);
        try { await loadTownCity(c.code, c.name, { quiet: true }); } catch { /* 地図にはバブルだけ表示 */ }
      }
      setCustMsg(match.errors?.length ? `⚠ ${match.errors.slice(0, 2).join(' / ')}` : '');
    } catch (e) {
      setCustMsg(`読み込めませんでした: ${e.message}`);
    }
  }

  function clearCustomers() {
    setCust(null); setCustMsg(''); setAnalysis(null);
  }

  function applyCustomerProfile() {
    if (!custProfile) return;
    setProfile((p) => ({ ...p, ageMin: String(custProfile.ageMin), ageMax: String(custProfile.ageMax), ...(custProfile.sex ? { sex: custProfile.sex } : {}) }));
    setAnalysis(null);
  }

  function addCustomerRadiusCircle(p = 0.8) {
    if (!pin || !custRadius?.[p]) return;
    setCircles((prev) => [...prev, { id: uid('circle'), lat: pin.lat, lng: pin.lng, radiusKm: custRadius[p], codes: [], drawOnly: true, tag: `顧客${Math.round(p * 100)}%` }]);
  }

  // ---- 📋 エリア表の貼り付け → 地図に反映（その後クリック・円で調整できる）----
  async function importAreaTable() {
    if (!pasteText.trim() || mode !== 'town') return;
    setLoading((l) => ({ ...l, import: true }));
    setPasteResult({ msg: '照合中…' });
    try {
      const r = await api.importAreaTable(pasteText);
      const failedCities = [];
      for (const c of r.cities || []) {
        try { await loadTownCity(c.code, c.name, { quiet: true }); } catch { failedCities.push(c.name); }
      }
      // 貼り付けた世帯数で置き換え（1行 = 1町丁目に対応したものだけ）
      let overridden = 0;
      if (pasteUseHh) {
        const hh = new Map();
        for (const m of r.matched) if (m.codes.length === 1 && m.households > 0) hh.set(m.codes[0], m.households);
        if (hh.size) {
          townAreasRef.current = townAreasRef.current.map((t) => {
            if (!hh.has(t.code)) return t;
            overridden++;
            return withRate({ ...t, households: hh.get(t.code), estatHouseholds: t.estatHouseholds ?? t.households, hhSource: 'paste' }, rateRef.current);
          });
          setTownAreas(townAreasRef.current);
        }
      }
      const codes = [...new Set(r.matched.flatMap((m) => m.codes))];
      setAnalysis(null);
      if (pasteReplace) {
        setSelected(codes); setCircles([]); setOptResult(null); setBarriers([]);
      } else selectCodes(codes);

      // 表の上にあった住所に中心地のピンを立てる
      let pinMsg = '';
      if (r.address) {
        const geocode = mapApiRef.current?.geocode;
        if (geocode) {
          try {
            const g = await geocode(r.address);
            setPin({ lat: g.lat, lng: g.lng });
            pinMsg = `📍 ${r.address} にピンを立てました`;
          } catch { pinMsg = `住所「${r.address}」が見つかりませんでした`; }
        } else pinMsg = `住所「${r.address}」（ピンはGoogle Maps接続時に立てられます）`;
      }
      const byCode = new Map(townAreasRef.current.map((t) => [t.code, t]));
      const copies = codes.reduce((s, c) => s + (byCode.get(c)?.distribution || 0), 0);
      const pastedCopies = r.matched.reduce((s, m) => s + (m.copies || 0), 0);
      setPasteResult({
        ok: true,
        msg: `✅ ${r.rowCount}行中 ${r.matched.length}行を地図に反映しました（${codes.length}町丁目・${copies.toLocaleString()}部）`,
        pastedCopies, overridden, pinMsg,
        unmatched: r.unmatched, notes: [...(r.notes || []), ...failedCities.map((c) => `${c}の町丁目を読み込めませんでした`)],
      });
    } catch (e) {
      setPasteResult({ msg: `反映できませんでした: ${e.message}` });
    } finally {
      setLoading((l) => ({ ...l, import: false }));
    }
  }

  // ---- 「📍から約 N 部を追加」----
  // ピン周辺の市区町村（県境をまたぐ）の町丁目を自動で読み込み、近い順に目標部数まで選ぶ
  // ピン周辺の市区町村（県境をまたぐ）の町丁目を読み込む。失敗した市区町村名を failed に入れる
  async function loadNearbyTowns(p, km, limit, failed) {
    const { municipalities } = await api.nearby(p.lat, p.lng, km, limit);
    const toLoad = municipalities.filter((m) => !townCitiesRef.current.some((c) => c.code === m.code) && !failed.has(m.city.replace(' ', '')));
    if (!toLoad.length) return;
    setCountMsg(`周辺の町丁目を読み込み中…（${toLoad.map((m) => m.city.replace(' ', '')).join('・')}）`);
    const results = await Promise.allSettled(toLoad.map((m) => loadTownCity(m.code, m.city.replace(' ', ''), { quiet: true })));
    results.forEach((r, i) => { if (r.status === 'rejected') failed.add(toLoad[i].city.replace(' ', '')); });
  }

  // ターゲット属性（空欄は 0歳〜上限なし）
  function profilePayload() {
    return {
      ageMin: profile.ageMin === '' ? 0 : Number(profile.ageMin),
      ageMax: profile.ageMax === '' ? 120 : Number(profile.ageMax),
      sex: profile.sex,
    };
  }

  function changeBusinessType(id) {
    setBusinessTypeId(id); setCompetitors([]); setAnalysis(null);
    const t = businessTypes.find((b) => b.id === id)?.target;
    if (t) setProfile({ ageMin: t.ageMin ? String(t.ageMin) : '', ageMax: t.ageMax >= 120 ? '' : String(t.ageMax), sex: t.sex });
  }

  // ---- 🤖 AIで最適エリアを作成（選択中に限らず、ピン周辺から作る）----
  async function createOptimalArea() {
    if (mode !== 'town') return;
    const p = ensurePin();
    if (!p) return;
    const target = Number(countTarget);
    const failed = new Set();
    setLoading((l) => ({ ...l, optimize: true }));
    try {
      setCountMsg('🤖 周辺の市区町村を確認中…');
      await loadNearbyTowns(p, 5, 6, failed);
      const loadedCopies = townAreasRef.current.reduce((s, t) => s + (t.distribution || 0), 0);
      if (loadedCopies < target * 3) await loadNearbyTowns(p, 12, 15, failed);
      setCountMsg('🤖 ターゲットの多さ・川や道路の分断を考慮して、最適エリアを作成中…（初回は道路・人口データの取得に少しかかります）');
      const r = await api.optimizeArea({
        pin: p, targetCopies: target, cityCodes: townCitiesRef.current.map((c) => c.code),
        businessTypeId: businessTypeId || null, profile: profilePayload(), incomePref: incomePref || null, coverRate: rate,
        customers: customersPayload(),
      });
      if (!r.codes?.length) { setCountMsg('最適エリアを作成できませんでした（候補の町丁目がありません）'); return; }
      setSelected(r.codes);
      // 作成したエリアを囲む円（ピン中心・最も遠い町丁目の中心までの半径）
      setCircles([autoCircle(p, r.maxDistanceKm, r.codes, 'AI')]);
      setBarriers(r.barriers || []);
      setOptResult({ ...r, failed: [...failed], center: { ...p } });
      setCountMsg(`🤖 最適エリアを作成しました: 約${target.toLocaleString()}部 → ${r.sum.toLocaleString()}部（${r.codes.length}エリア・半径約${r.maxDistanceKm}km）`);
      await runAnalysis(r.codes);
    } catch (e) {
      setCountMsg(`最適エリアの作成に失敗しました: ${e.message}`);
    } finally {
      setLoading((l) => ({ ...l, optimize: false }));
    }
  }

  async function addByCount() {
    if (mode !== 'town') return;
    const p = ensurePin();
    if (!p) return;
    const target = Number(countTarget);
    const failed = new Set();
    const loadNearby = (km, limit) => loadNearbyTowns(p, km, limit, failed);
    const compute = () => {
      const sel = new Set(selected);
      const candidates = townAreasRef.current.filter((t) => !sel.has(t.code));
      return pickByCount(candidates, p, target);
    };

    try {
      setCountMsg('周辺の市区町村を確認中…');
      await loadNearby(5, 6);
      let r = compute();
      if (r.sum < target) { // 足りなければ範囲を広げて再試行
        await loadNearby(12, 15);
        r = compute();
      }
      if (!r.codes.length) { setCountMsg('追加できる町丁目が見つかりませんでした'); return; }
      selectCodes(r.codes);
      setCircles((prev) => [...prev, autoCircle(p, r.maxDistanceKm, r.codes, `${target.toLocaleString()}部`)]);
      setCountMsg(`📍から約${target.toLocaleString()}部 → ${r.sum.toLocaleString()}部（${r.codes.length}エリア・半径約${r.maxDistanceKm}km）を追加しました`
        + (failed.size ? `\n※ 読み込めなかった市区町村: ${[...failed].join('、')}` : ''));
    } catch (e) {
      setCountMsg(`部数追加に失敗しました: ${e.message}`);
    }
  }

  // ---- Excel「AI分析レポート」シートの内容 ----
  function buildReport(rep, opt) {
    const bt = businessTypes.find((b) => b.id === businessTypeId);
    const c = opt?.center || pin;
    return {
      generatedAt: new Date().toISOString(),
      conditions: {
        businessType: bt ? bt.label : null,
        target: rep.scoring?.targetProfile?.label || (mode === 'town' ? profileLabel(profile) : null),
        incomePref: rep.incomePref || null,
        targetCopies: opt?.targetCopies || null,
        center: c ? `${storeName ? storeName + '　' : ''}緯度 ${c.lat.toFixed(5)} / 経度 ${c.lng.toFixed(5)}` : storeName || null,
      },
      analysis: { scoring: rep.scoring, explanation: rep.explanation, quotes: { companyTotals: (rep.quotes?.companyTotals || []).filter((t) => t.quote > 0) } },
      optimize: opt ? {
        sum: opt.sum, targetCopies: opt.targetCopies, areaCount: opt.codes.length, maxDistanceKm: opt.maxDistanceKm,
        targetTotal: opt.targetTotal, incomeIndex: opt.incomeIndex, incomePref: opt.incomePref, islands: opt.islands,
        skippedByBarrier: opt.skippedByBarrier, crossedBarriers: opt.crossedBarriers, barrierError: opt.barrierError,
      } : null,
    };
  }

  // ---- 配布部数表（Excel）ダウンロード ----
  async function downloadAreaTable() {
    if (!selectedAreas.length) return;
    setLoading((l) => ({ ...l, export: true }));
    setExportMsg('準備中…');
    try {
      const ordered = [...selectedAreas].sort((a, b) => String(a.code).localeCompare(String(b.code)));
      const isTown = mode === 'town';
      const rows = ordered.map((a) => ({
        city: isTown ? a.city : a.pref,
        town: isTown ? a.name : a.city,
        households: a.households,
      }));
      if (rows.some((r) => r.households == null)) throw new Error('世帯数が未取得のエリアがあります（e-Stat接続が必要）');

      // AI分析レポート（別シート）: 選択が分析時から変わっていれば分析し直す
      let rep = analysis;
      const sameSet = (a, b) => a && b && a.length === b.length && a.every((c) => b.includes(c));
      if (!rep || !sameSet(rep.codes, selected)) {
        setExportMsg('AI分析を実行中…（レポート用）');
        try { rep = await runAnalysis(selected); } catch (e) { console.warn('analysis for report failed', e); rep = null; }
      }
      const report = rep ? buildReport(rep, sameSet(optResult?.codes, selected) ? optResult : null) : null;

      // エリア表のターゲット人数・占有率（全年齢・男女ともの場合は意味がないので出さない）
      const tt = rep?.scoring?.totals;
      const prof = rep?.scoring?.targetProfile;
      const allPeople = prof && prof.ageMin === 0 && prof.ageMax >= 120 && prof.sex === 'all';
      const target = isTown && tt?.target > 0 && !allPeople ? {
        label: prof?.label,
        people: tt.target,
        share: tt.targetPopulation ? tt.target / tt.targetPopulation : null,
        note: rep.scoring.targetSource === 'census' ? '国勢調査より' : '一部推計',
      } : null;

      // 地図画像（選択エリア・円・ピン・競合）
      setExportMsg('地図画像を作成中…');
      let map = null;
      const comps = rep?.competitors ?? competitors;
      try {
        const areas = ordered.map((a) => (isTown
          ? { rings: a.polygons ?? [a.polygon], center: a.center, name: a.name }
          : boundaryMap[a.code] && { rings: boundaryMap[a.code].polygons, center: boundaryMap[a.code].center, name: a.city })).filter(Boolean);
        const bt = businessTypes.find((b) => b.id === businessTypeId);
        map = await buildMapImage({
          areas, circles, pin, pinLabel: storeName, labelOf: isTown ? townLabel : (n) => n,
          competitors: comps, competitorLabel: bt ? `競合：${bt.label}` : '競合',
          customers: custOpts.inExcel && custAgg ? custAgg.markers : [],
        });
      } catch (e) {
        console.warn('map image failed', e);
      }

      setExportMsg('Excelを作成中…');
      const { blob, filename } = await api.exportAreaXlsx({
        report,
        target,
        rows,
        coverRate: rate,
        storeName,
        projectName,
        targetCopies: Number(titleCopies) > 0 ? Number(titleCopies) : autoTitleCopies,
        mapImage: map?.dataUrl,
        mapSize: map ? { width: map.width, height: map.height } : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExportMsg(`✅ ${filename} をダウンロードしました${report ? '（シート「AI分析レポート」付き）' : ''}`
        + (!map ? '\n※ 地図画像を作成できませんでした' : !map.baseMap ? `\n※ 背景の地図を取得できなかったため、背景なしの地図を貼り付けました。\n原因: ${map.baseError || '不明'}` : ''));
    } catch (e) {
      setExportMsg(`出力に失敗しました: ${e.message}`);
    } finally {
      setLoading((l) => ({ ...l, export: false }));
    }
  }

  async function loadCompetitors() {
    if (!businessTypeId || !selected.length) return;
    setLoading((l) => ({ ...l, comp: true }));
    try {
      const r = await api.searchCompetitors(businessTypeId, selected, mode);
      setCompetitors(r.competitors); setCompetitorSource(r.source);
    } finally { setLoading((l) => ({ ...l, comp: false })); }
  }

  async function runAnalysis(codesArg) {
    const codes = Array.isArray(codesArg) ? codesArg : selected;
    if (!codes.length) return;
    setLoading((l) => ({ ...l, analyze: true }));
    try {
      let comps = competitors;
      if (businessTypeId && (!comps.length || Array.isArray(codesArg))) {
        const r = await api.searchCompetitors(businessTypeId, codes, mode);
        comps = r.competitors; setCompetitors(comps); setCompetitorSource(r.source);
      }
      const res = await api.analyze(codes, mode, businessTypeId || null, comps, unitCost, profilePayload(), incomePref, rate,
        mode === 'town' && customersPayload() ? { customers: customersPayload(), customerTotal: custAgg.matched } : {});
      const withCodes = { ...res, codes: [...codes], incomePref, competitors: comps };
      setAnalysis(withCodes);
      return withCodes;
    } finally { setLoading((l) => ({ ...l, analyze: false })); }
  }

  // ---- 地図データ（統一形式）----
  const mapPolygons = useMemo(() => {
    if (mode === 'town') {
      return townAreas.map((a) => ({
        code: a.code, rings: a.polygons ?? [a.polygon], center: a.center,
        label: townLabel(a.name), fullName: `${a.city}${a.name}`,
        households: a.households, distribution: a.distribution,
        selected: selected.includes(a.code), score: scoreByCode?.[a.code], best: a.code === bestCode,
      }));
    }
    // 市区町村: 選択済みで境界取得済みのものをポリゴン表示
    return selected.map((c) => {
      const b = boundaryMap[c]; const a = byCode[c];
      if (!b || !a) return null;
      return {
        code: c, rings: b.polygons, center: b.center, label: a.city,
        households: a.households, distribution: a.distribution,
        selected: true, score: scoreByCode?.[c], best: c === bestCode,
      };
    }).filter(Boolean);
  }, [mode, townAreas, prefMunis, selected, boundaryMap, byCode, scoreByCode, bestCode]);

  const mapPoints = useMemo(() => {
    if (mode !== 'municipality') return [];
    return prefMunis.map((m) => ({ code: m.code, lat: m.lat, lng: m.lng, label: m.city, selected: selected.includes(m.code) }));
  }, [mode, prefMunis, selected]);

  const MapComp = config?.googleMapsApiKey ? GoogleMapView : SvgMapView;
  const filteredMunis = muniKeyword ? prefMunis.filter((m) => m.city.includes(muniKeyword) || (m.kana || '').includes(muniKeyword)) : prefMunis;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">📮 ポスティング配布エリア選択</div>
        <div className="tagline">競合分析 ／ AI最適エリア ／ 見積 ／ エリア表DL</div>
      </header>

      <div className="layout">
        {/* 左パネル */}
        <aside className="panel left">
          <div className="modetabs">
            <button className={mode === 'town' ? 'on' : ''} onClick={() => switchMode('town')}>町丁目 配布</button>
            <button className={mode === 'municipality' ? 'on' : ''} onClick={() => switchMode('municipality')}>市区町村 配布（全国）</button>
          </div>

          {mode === 'town' ? (
            <Section title="町丁目を読み込む（国勢調査の実境界）">
              <Field label="都道府県">
                <select value={townPref} onChange={(e) => changeTownPref(e.target.value)}>
                  <option value="">-- 都道府県を選択 --</option>
                  {prefectures.map((p) => <option key={p.code} value={p.pref}>{p.pref}</option>)}
                </select>
              </Field>
              {townPref && (
                <>
                  <input className="search" placeholder="市区町村を検索" value={townKeyword} onChange={(e) => setTownKeyword(e.target.value)} />
                  <div className="munilist">
                    {townPrefMunis
                      // 政令指定都市は区ごとにデータがあるため、市全体（区を持つ親）は除外
                      .filter((m) => !townPrefMunis.some((o) => o.code !== m.code && o.city.startsWith(m.city + ' ')))
                      .filter((m) => !townKeyword || m.city.includes(townKeyword) || (m.kana || '').includes(townKeyword))
                      .map((m) => {
                        const loaded = townCities.some((c) => c.code === m.code);
                        return (
                          <div key={m.code} className="municheck">
                            <span>{m.city}</span>
                            <button className={`chip ${loaded ? '' : 'solid'}`} disabled={loaded || !!loading.town}
                              onClick={() => loadTownCity(m.code, m.city)}>
                              {loaded ? '読込済' : '＋読込'}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
              {townStatus && (
                <div className="hint">📦 取得済みデータ: {townStatus.cachedCities}市区町村
                  {townStatus.cachedCities < 50 && '（一都三県などを事前取得すると、検索がすぐ表示されます）'}</div>
              )}
              {loading.town && <div className="hint">⏳ {loading.town}の町丁目を取得中…（初回は数秒）</div>}
              {townErr && <div className="errbox">{townErr}</div>}
              {townCities.length > 0 && (
                <div className="citychips">
                  {townCities.map((c) => (
                    <span key={c.code} className="circlechip">
                      {c.name}（{c.count}町丁目）
                      <button onClick={() => unloadTownCity(c.code)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="hint">
                使い方: 地図上の住所検索でピンを立てて「📍から約○部を追加」すると、周辺の市区町村（県境をまたいでも可）を自動で読み込んで選択します。
                市区町村を指定して読み込み、町丁目をクリックや円で選ぶこともできます。世帯数は令和2年国勢調査（町丁・字等別）。
              </div>
            </Section>
          ) : null}
          {mode === 'town' && (
            <Section title="📋 エリア表を貼り付けて反映">
              {!pasteOpen ? (
                <button className="btn ghost" onClick={() => setPasteOpen(true)}>Excelのエリア表を貼り付ける</button>
              ) : (
                <>
                  <textarea className="pastebox" rows={7} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                    placeholder={'Excelで「都道府県・市区町村・町丁目名・世帯数・配布予定数」の範囲を選んでコピーし、ここに貼り付け\n例）\n坂戸市北峰183-2\n都道府県\t市区町村\t町丁目名\t一般世帯数\t配布予定数\n埼玉県\t坂戸市\t日の出町\t1137\t790'} />
                  <label className="checkline"><input type="checkbox" checked={pasteReplace} onChange={(e) => setPasteReplace(e.target.checked)} />今の選択を置き換える（外すと追加）</label>
                  <label className="checkline"><input type="checkbox" checked={pasteUseHh} onChange={(e) => setPasteUseHh(e.target.checked)} />貼り付けた世帯数を使う（外すと国勢調査の世帯数）</label>
                  <div className="pastebtns">
                    <button className="btn primary" disabled={!pasteText.trim() || loading.import} onClick={importAreaTable}>
                      {loading.import ? '反映中…' : '地図に反映'}
                    </button>
                    <button className="btn ghost" onClick={() => { setPasteText(''); setPasteResult(null); }}>クリア</button>
                  </div>
                </>
              )}
              {pasteResult && (
                <div className="pasteresult">
                  <div className={pasteResult.ok ? 'ok' : ''}>{pasteResult.msg}</div>
                  {pasteResult.ok && pasteResult.pastedCopies > 0 && <div className="hint">貼り付けた配布予定数の合計: {pasteResult.pastedCopies.toLocaleString()}部{pasteResult.overridden ? `（世帯数を貼り付けの値に置き換え: ${pasteResult.overridden}町丁目）` : ''}</div>}
                  {pasteResult.pinMsg && <div className="hint">{pasteResult.pinMsg}</div>}
                  {pasteResult.unmatched?.length > 0 && (
                    <div className="warnbox">⚠ 照合できなかった行（{pasteResult.unmatched.length}）:
                      <ul>{pasteResult.unmatched.slice(0, 15).map((u) => <li key={u.line}>{u.line}行目 {u.input}</li>)}</ul>
                      地図で該当する町丁目をクリックして追加してください。
                    </div>
                  )}
                  {pasteResult.notes?.map((n, i) => <div key={i} className="hint warn">{n}</div>)}
                  {pasteResult.ok && <div className="hint">反映後も、地図の町丁目をクリック・円で追加／解除して調整できます。</div>}
                </div>
              )}
            </Section>
          )}
          {mode === 'town' && (
            <Section title="👥 顧客データ（CSV）">
              <label className="btn ghost filebtn">
                {cust ? '別のCSVを読み込む' : '顧客CSVを読み込む'}
                <input type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => { loadCustomerFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <div className="hint">ファイルはこのMacの中だけで処理し、保存しません（画面を閉じると消えます）。照合に使うのは住所だけです。地図には町丁目ごとの人数だけを表示します。</div>
              {custMsg && <div className="hint">{custMsg}</div>}
              {cust && custAgg && (
                <div className="custpanel">
                  <div className="custsum"><b>{custAgg.matched.toLocaleString()}</b> / {custAgg.total.toLocaleString()}人を町丁目に対応
                    <span>（丁目まで {custAgg.chome}・町名まで {custAgg.town}）</span></div>
                  {custAgg.unmatched.length > 0 && (
                    <details className="warnbox">
                      <summary>対応できなかった {custAgg.unmatched.length}人</summary>
                      <ul>{custAgg.unmatched.slice(0, 30).map((u) => <li key={u.i}>{u.i}行目 {u.text}（{u.reason}）</li>)}</ul>
                    </details>
                  )}
                  {cust.cols.withdrawn >= 0 && (
                    <label className="checkline"><input type="checkbox" checked={custOpts.excludeWithdrawn} onChange={(e) => setCustOpts((o) => ({ ...o, excludeWithdrawn: e.target.checked }))} />退会者を除く</label>
                  )}
                  {cust.stores.length > 1 && (
                    <Field label="店舗">
                      <select value={custOpts.store} onChange={(e) => setCustOpts((o) => ({ ...o, store: e.target.value }))}>
                        <option value="">すべての店舗</option>
                        {cust.stores.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                  )}
                  <label className="checkline"><input type="checkbox" checked={custOpts.show} onChange={(e) => setCustOpts((o) => ({ ...o, show: e.target.checked }))} />地図に表示</label>
                  <label className="checkline"><input type="checkbox" checked={custOpts.use} onChange={(e) => { setCustOpts((o) => ({ ...o, use: e.target.checked })); setAnalysis(null); }} />AI分析・AI最適エリア作成に使う</label>

                  {custRadius ? (
                    <div className="custrow">📍からの距離: 顧客の50%が <b>{custRadius[0.5]}km</b>・80%が <b>{custRadius[0.8]}km</b>・90%が <b>{custRadius[0.9]}km</b> 以内
                      <button className="chip redline" onClick={() => addCustomerRadiusCircle(0.8)}>80%の半径で円</button></div>
                  ) : <div className="hint">📍を立てると、顧客が何km以内に集まっているか（商圏）を計算します。</div>}
                  {custProfile && (
                    <div className="custrow">顧客の年齢: 中央値 <b>{custProfile.median}歳</b>・80%が <b>{custProfile.ageMin}〜{custProfile.ageMax}歳</b>
                      {custProfile.sex && custProfile.sex !== 'all' ? `・${custProfile.sex === 'female' ? '女性' : '男性'}が8割以上` : ''}
                      <button className="chip" onClick={applyCustomerProfile}>ターゲットに設定</button></div>
                  )}
                  {custAgg.markers.length > 0 && (
                    <table className="ranktable">
                      <thead><tr><th>顧客が多い町丁目</th><th>人</th><th>1000世帯あたり</th></tr></thead>
                      <tbody>
                        {custAgg.markers.slice(0, 8).map((m) => (
                          <tr key={m.code}><td>{townLabel(m.name)}</td><td>{m.count}</td><td>{m.households ? ((m.count / m.households) * 1000).toFixed(1) : '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="hint">「🤖 AIで最適エリアを作成」「AIで最適エリアを分析」は、顧客が多い町丁目（世帯あたり）とその周辺を優先します。</div>
                  <button className="btn ghost" onClick={clearCustomers}>顧客データを消す</button>
                </div>
              )}
            </Section>
          )}
          {mode !== 'town' && (
            <Section title="全国から自治体を選択">
              <Field label="都道府県">
                <select value={pref} onChange={(e) => changePref(e.target.value)}>
                  <option value="">-- 都道府県を選択 --</option>
                  {prefectures.map((p) => <option key={p.code} value={p.pref}>{p.pref}</option>)}
                </select>
              </Field>
              {pref && (
                <>
                  <input className="search" placeholder="市区町村を検索" value={muniKeyword} onChange={(e) => setMuniKeyword(e.target.value)} />
                  <div className="munilist">
                    {loading.muni && <div className="hint">読み込み中…</div>}
                    {filteredMunis.map((m) => (
                      <label key={m.code} className="municheck">
                        <input type="checkbox" checked={selected.includes(m.code)} onChange={() => toggle(m.code)} />
                        <span>{m.city}</span>
                        <em>{m.households != null ? `${m.distribution.toLocaleString()}部` : '—'}</em>
                      </label>
                    ))}
                  </div>
                  {muniSource === 'none' && <div className="hint">世帯数はe-Stat未接続のため「—」。ESTAT_APP_ID設定で真値・部数が表示されます。</div>}
                </>
              )}
            </Section>
          )}

          <Section title="業態・ターゲット・競合">
            <Field label="業態を選択">
              <select value={businessTypeId} onChange={(e) => changeBusinessType(e.target.value)}>
                <option value="">-- 業態を選択 --</option>
                {businessTypes.map((b) => <option key={b.id} value={b.id}>{b.icon} {b.label}</option>)}
              </select>
            </Field>
            <div className="targetbox">
              <div className="targetbox-title">🎯 ターゲット属性 <span>{profileLabel(profile)}</span></div>
              <div className="targetrow">
                年齢
                <input type="number" min="0" max="120" placeholder="0" value={profile.ageMin}
                  onChange={(e) => setProfile((p) => ({ ...p, ageMin: e.target.value }))} />
                〜
                <input type="number" min="0" max="120" placeholder="上限なし" value={profile.ageMax}
                  onChange={(e) => setProfile((p) => ({ ...p, ageMax: e.target.value }))} />
                歳
              </div>
              <div className="targetrow">
                性別
                <select value={profile.sex} onChange={(e) => setProfile((p) => ({ ...p, sex: e.target.value }))}>
                  <option value="all">男女とも</option>
                  <option value="female">女性</option>
                  <option value="male">男性</option>
                </select>
              </div>
              <div className="targetrow">
                所得層
                <select value={incomePref} onChange={(e) => { setIncomePref(e.target.value); setAnalysis(null); }}>
                  <option value="">指定なし</option>
                  <option value="high">高め</option>
                  <option value="low">低め</option>
                </select>
              </div>
              <div className="hint">業態を選ぶと標準のターゲットが入ります（自由に変更可）。町丁目ごとのターゲット人数は国勢調査の年齢・男女別人口から計算します。所得層は市区町村の平均所得（実データ）と町丁目の所得指数（推計）で評価します。</div>
            </div>
            <button className="btn ghost" disabled={!businessTypeId || !selected.length || loading.comp} onClick={loadCompetitors}>
              {loading.comp ? '検索中…' : '競合をプロット'}
            </button>
            {competitorSource && <div className="hint">競合 {competitors.length}件 ・ データ元: {sourceLabel(competitorSource)}</div>}
          </Section>

          <Section title="配布サマリ">
            <Field label="世帯カバー率(%)">
              <div className="ratebox">
                <input type="number" min="1" max="100" step="1" value={ratePct}
                  onChange={(e) => setRatePct(e.target.value)}
                  onBlur={() => setRatePct(String(Math.round(rate * 1000) / 10))} />
                {rate !== DEFAULT_RATE && <button type="button" className="link" onClick={() => setRatePct(String(DEFAULT_RATE * 100))}>70%に戻す</button>}
              </div>
            </Field>
            <Field label="配布単価(円/部)">
              <input type="number" step="0.5" value={unitCost} onChange={(e) => setUnitCost(+e.target.value)} />
            </Field>
            <div className="summary">
              <Row k="選択エリア" v={`${selectedAreas.length} エリア`} />
              <Row k="合計世帯数" v={hasNullHh && totalHouseholds === 0 ? '—' : totalHouseholds.toLocaleString()} />
              <Row k={`配布部数 (×${Math.round(rate * 1000) / 10}%)`} v={totalDistribution ? `${totalDistribution.toLocaleString()} 部` : '—'} strong />
              <Row k="想定コスト" v={estCost ? `約 ${estCost.toLocaleString()} 円` : '—'} />
            </div>
            {hasNullHh && <div className="hint">一部エリアの世帯数が未取得です（e-Stat接続で解決）。</div>}
            <button className="btn primary" disabled={!selected.length || loading.analyze} onClick={runAnalysis}>
              {loading.analyze ? 'AI分析中…' : '🤖 AIで最適エリアを分析'}
            </button>
          </Section>
        </aside>

        {/* 中央: 地図 */}
        <main className="mapwrap">
          <div className="maptoolbar">
            <form className="addrbox" onSubmit={searchAddress}>
              <input placeholder="住所・店舗名で検索（ピンを立てる）" value={addrQuery} onChange={(e) => setAddrQuery(e.target.value)} />
              <button type="submit" className="chip">🔍</button>
            </form>
            <button className="chip" onClick={movePinToCenter} title="地図の中心にピンを移動">📍を地図の中心に <b className="link">移動</b></button>
            <button className="chip" onClick={clearAll}>クリア</button>
            <span className="spacer" />
            <LegendDot color={COLORS.selFill} label="選択エリア" />
            <LegendDot color={COLORS.circle} label="円" />
            <LegendDot color="#7c3aed" label="競合" />
            {custMarkers.length > 0 && <LegendDot color="#0d9488" label="顧客" />}
            {barriers.length > 0 && <><LegendLine color="#2563eb" label="川" /><LegendLine color="#475569" label="道路" /><LegendLine color="#111827" label="線路" dashed /></>}
            {analysis && <LegendGradient />}
          </div>
          <div className="maptoolbar sub">
            <span className="circlectl">
              円選択　半径
              <input type="number" min="0.2" step="0.1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              km
              <button className="chip red" onClick={() => addCircleAtPin(false)} title="円を描き、円の中の町丁目を選択します">円を追加</button>
              <button className="chip redline" onClick={() => addCircleAtPin(true)} title="円を描くだけで、エリアは選択しません">円のみ</button>
            </span>
            {mode === 'town' && (
              <span className="countctl">
                📍から 約
                <select value={countTarget} onChange={(e) => setCountTarget(Number(e.target.value))}>
                  {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()}部</option>)}
                </select>
                を
                <button className="chip solid" onClick={addByCount} disabled={!!loading.town || !!loading.optimize}>追加</button>
                <button className="chip ai" onClick={createOptimalArea} disabled={!!loading.town || !!loading.optimize}
                  title="選択中に限らず、ターゲットの多さと川・道路・線路の分断を考慮して、目標部数のエリアを新しく作ります">
                  {loading.optimize ? '🤖 作成中…' : '🤖 AIで最適エリアを作成'}
                </button>
              </span>
            )}
          </div>
          {(circles.length > 0 || addrMsg || countMsg) && (
            <div className="circlebar">
              {circles.map((c, i) => (
                <span key={c.id} className="circlechip">
                  円{i + 1}（{c.radiusKm}km{c.drawOnly ? '・円のみ' : c.tag ? `・${c.tag}` : ''}）
                  <button onClick={() => removeCircle(c.id)}>×</button>
                </span>
              ))}
              {addrMsg && <span className="addrmsg">{addrMsg}</span>}
              {countMsg && <span className="addrmsg countmsg">{countMsg}</span>}
            </div>
          )}
          <div className="mapbox">
            <MapComp
              apiKey={config?.googleMapsApiKey}
              center={config?.defaultCenter}
              zoom={config?.defaultZoom}
              polygons={mapPolygons}
              points={mapPoints}
              competitors={competitors}
              customers={custMarkers}
              circles={circles}
              pin={pin}
              pinLabel={storeName}
              businessIcon={businessIcon}
              onToggle={toggle}
              onApi={handleApi}
              onCircleChange={onCircleChange}
              onPinChange={setPin}
              barriers={barriers}
              emptyHint={mode === 'municipality' ? '都道府県を選び、自治体を選択してください' : 'エリアを選択してください'}
            />
          </div>
        </main>

        {/* 右パネル */}
        <aside className="panel right">
          {optResult && (
            <Section title="🤖 AIが作成した最適エリア">
              <div className="optsum">
                <div><b>{optResult.sum.toLocaleString()}</b>部<span>（目標 約{optResult.targetCopies.toLocaleString()}部）</span></div>
                <div><b>{optResult.codes.length}</b>エリア・ピンから半径約<b>{optResult.maxDistanceKm}</b>km</div>
                {optResult.targetTotal > 0 && (
                  <div>🎯 {optResult.profile?.label}: 約<b>{optResult.targetTotal.toLocaleString()}</b>人
                    <span>{optResult.targetSource === 'census' ? '（国勢調査）' : optResult.targetSource === 'mixed' ? '（一部推計）' : '（全国の年齢構成による推計）'}</span></div>
                )}
                {optResult.customersInArea != null && (
                  <div>👥 エリア内の顧客 約<b>{Math.round(optResult.customersInArea).toLocaleString()}</b>人<span>（顧客の多い町丁目と周辺を優先）</span></div>
                )}
                {optResult.incomeIndex != null && (
                  <div>💴 所得指数 <b>{optResult.incomeIndex.toFixed(2)}</b><span>（推計・市区町村平均=1.00、{optResult.incomePref === 'low' ? '低め' : '高め'}を優先）</span></div>
                )}
              </div>
              <ul className="optnotes">
                <li>ピンのある町丁目から、隣り合う町丁目へ順に広げました（飛び地なし{optResult.islands ? `／やむを得ず${optResult.islands}か所` : ''}）</li>
                <li>ターゲットの多い町丁目を優先し、川・高速道路・国道・線路をまたぐ町丁目は後回しにしました</li>
                {optResult.incomePref && optResult.incomeIndex == null && <li className="warn">所得指数を取得できなかったため、所得層は考慮していません{optResult.incomeErrors?.[0] ? `（${optResult.incomeErrors[0]}）` : ''}</li>}
                {optResult.skippedByBarrier?.length > 0 && (
                  <li>分断のため除外した近くの町丁目: {optResult.skippedByBarrier.slice(0, 6).map((x) => `${townLabel(x.name)}（${x.barriers.slice(0, 2).join('・')}の向こう側）`).join('、')}</li>
                )}
                {optResult.crossedBarriers?.length > 0 && <li>部数を満たすためにまたいだもの: {optResult.crossedBarriers.slice(0, 5).join('、')}</li>}
                {optResult.barrierError && <li className="warn">{optResult.barrierError}（川は町丁目の水面区画で考慮しています）</li>}
                {optResult.targetSource !== 'census' && <li className="warn">年齢・男女別人口を取得できなかった町丁目は、全国の年齢構成で推計しています</li>}
                {optResult.failed?.length > 0 && <li className="warn">読み込めなかった市区町村: {optResult.failed.join('、')}</li>}
              </ul>
            </Section>
          )}
          <Section title="選択中エリア">
            <div className="selhead">
              <span>{totalDistribution ? `${totalDistribution.toLocaleString()}部` : '—'}</span>
              <span>全{selectedAreas.length}エリア</span>
            </div>
            {selectedAreas.length === 0 && <div className="hint">地図からエリアを選択してください。</div>}
            {selectedGroups.map((g) => (
              <div key={g.key} className="selgroup">
                <div className="selgroup-head">
                  <b>{g.label}</b>
                  <span>{g.copies.toLocaleString()}部・{g.areas.length}エリア</span>
                </div>
                {g.areas.map((a) => (
                  <div key={a.code} className="selrow">
                    <span className="selname">{mode === 'town' ? townLabel(a.name) : a.city}</span>
                    <span className="selcopies">{a.distribution != null ? `${a.distribution.toLocaleString()}部` : '—'}</span>
                    {scoreByCode && scoreByCode[a.code] != null && <span className="scorepill" style={{ background: `hsl(${scoreByCode[a.code] * 1.2},70%,45%)` }}>{scoreByCode[a.code]}</span>}
                    <button className="selx" onClick={() => toggle(a.code)} title="選択解除">×</button>
                  </div>
                ))}
                <button className="linkbtn" onClick={() => deselectGroup(g)}>このエリアを選択解除</button>
              </div>
            ))}
            {selectedAreas.length > 0 && <button className="linkbtn danger" onClick={clearAll}>すべてのエリアを選択解除</button>}
          </Section>

          <Section title="📥 配布部数表（エリア表）">
            <Field label="店舗名（タイトル・地図のピンに表示）">
              <input value={storeName} placeholder="例: ○○広尾店" onChange={(e) => setStoreName(e.target.value)} />
            </Field>
            <Field label="案件名">
              <input value={projectName} placeholder="例: オープン案件" onChange={(e) => setProjectName(e.target.value)} />
            </Field>
            <Field label="タイトルの部数（空欄なら合計を千部単位で自動）">
              <input type="number" step="1000" value={titleCopies} placeholder={`自動: ${autoTitleCopies.toLocaleString()}部`}
                onChange={(e) => setTitleCopies(e.target.value)} />
            </Field>
            {custAgg?.markers.length > 0 && (
              <label className="checkline"><input type="checkbox" checked={custOpts.inExcel} onChange={(e) => setCustOpts((o) => ({ ...o, inExcel: e.target.checked }))} />地図に顧客の分布（町丁目ごとの人数）を入れる</label>
            )}
            <button className="btn primary" disabled={!selectedAreas.length || loading.export} onClick={downloadAreaTable}>
              {loading.export ? '作成中…' : '配布部数表ダウンロード（Excel）'}
            </button>
            <div className="hint">市区町村名・町丁目名・世帯数・配布予定数（=ROUNDDOWN(世帯数×カバー率,-1)）と地図を出力します。Googleスプレッドシートでもそのまま開けます。</div>
            {exportMsg && <div className={exportMsg.startsWith('出力に失敗') ? 'errbox' : 'okbox'}>{exportMsg}</div>}
          </Section>

          {analysis && (
            <>
              {analysis.scoring.best ? (
                <Section title="🤖 AI最適エリア分析">
                  <div className="best">
                    <div className="besttag">最適エリア</div>
                    <div className="bestname">{analysis.scoring.best.name}</div>
                    <div className="bestscore">総合 {analysis.scoring.best.score}点</div>
                  </div>
                  <div className="explain">{analysis.explanation.text}</div>
                  <div className="hint">解説: {analysis.explanation.source === 'claude' ? `Claude (${analysis.explanation.model})` : 'ルールベース（Claude APIキー未設定）'}</div>
                  {analysis.scoring.targetRanking?.length > 0 && (
                    <>
                      <h4 className="subhead">🎯 ターゲット（{analysis.scoring.targetProfile?.label}）が多いエリア
                        <span>{analysis.scoring.targetSource === 'census' ? '国勢調査' : analysis.scoring.targetSource === 'mixed' ? '一部推計' : '推計'}</span></h4>
                      <table className="ranktable">
                        <thead><tr><th>順</th><th>エリア</th><th>人数</th><th>割合</th><th>1部あたり</th></tr></thead>
                        <tbody>
                          {analysis.scoring.targetRanking.map((a, i) => (
                            <tr key={a.code} className={i === 0 ? 'top' : ''}>
                              <td>{i + 1}</td><td>{townLabel(a.name)}</td><td>{a.target.toLocaleString()}</td><td>{a.targetRate}%</td><td>{a.targetPerCopy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  {(analysis.scoring.income?.municipal?.length > 0 || analysis.scoring.incomeRanking?.length > 0) && (
                    <>
                      <h4 className="subhead">💴 所得{analysis.scoring.incomePref ? `（${analysis.scoring.incomePref === 'high' ? '高め' : '低め'}を優先）` : ''}</h4>
                      {analysis.scoring.income?.municipal?.map((m) => (
                        <div key={m.code} className="kv"><span>{m.city} 平均所得<small>（納税者1人あたり・{m.year}年・実データ）</small></span><span>約{Math.round(m.avgIncomeYen / 10000).toLocaleString()}万円</span></div>
                      ))}
                      {analysis.scoring.income?.estimated && analysis.scoring.incomeRanking?.length > 0 && (
                        <table className="ranktable">
                          <thead><tr><th>順</th><th>エリア</th><th>所得指数</th><th>水準</th></tr></thead>
                          <tbody>
                            {analysis.scoring.incomeRanking.slice(0, 5).map((a, i) => (
                              <tr key={a.code} className={i === 0 ? 'top' : ''}><td>{i + 1}</td><td>{townLabel(a.name)}</td><td>{a.incomeIndex.toFixed(2)}</td><td>{a.incomeLevel}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="hint">所得指数は推計（管理職・専門職の割合、持ち家率、夫婦と子どもの世帯・単身世帯の割合から、市区町村平均=1.00で算出）。金額ではありません。</div>
                    </>
                  )}
                  {analysis.scoring.income?.errors?.length > 0 && !analysis.scoring.income?.municipal?.length && !analysis.scoring.incomeRanking?.length && (
                    <div className="hint warn">所得データを取得できませんでした（{analysis.scoring.income.errors[0]}）</div>
                  )}
                  {analysis.scoring.customerRanking?.length > 0 && (
                    <>
                      <h4 className="subhead">👥 顧客が多いエリア<span>選択エリア内 約{Math.round(analysis.scoring.totals.customers || 0).toLocaleString()}人</span></h4>
                      <table className="ranktable">
                        <thead><tr><th>順</th><th>エリア</th><th>顧客</th><th>1000世帯あたり</th></tr></thead>
                        <tbody>
                          {analysis.scoring.customerRanking.slice(0, 8).map((a, i) => (
                            <tr key={a.code} className={i === 0 ? 'top' : ''}><td>{i + 1}</td><td>{townLabel(a.name)}</td><td>{a.customers}</td><td>{a.customerPer1000}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  <h4 className="subhead">総合スコア</h4>
                  <table className="ranktable">
                    <thead><tr><th>順位</th><th>エリア</th><th>点</th><th>ターゲット</th>{hasIncomeCol && <th>所得</th>}<th>競合</th></tr></thead>
                    <tbody>
                      {analysis.scoring.areas.map((a, i) => (
                        <tr key={a.code} className={a.code === bestCode ? 'top' : ''}>
                          <td>{i + 1}</td><td>{townLabel(a.name)}</td><td>{a.score}</td><td>{a.target != null ? a.target.toLocaleString() : '—'}</td>
                          {hasIncomeCol && <td title={a.incomeIndex != null ? `所得指数 ${a.incomeIndex.toFixed(2)}` : ''}>{a.incomeLevel || '—'}</td>}
                          <td>{a.competitorCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              ) : (
                <Section title="🤖 AI最適エリア分析">
                  <div className="explain">{analysis.explanation.text}</div>
                </Section>
              )}

              {/* 配布会社 見積 */}
              {analysis.quotes?.companyTotals?.some((t) => t.quote > 0) && (
                <Section title="🚚 配布会社 見積（原価・見積単価）">
                  <div className="hint">選択エリアの各社見積。実データを徐々にプロット予定。</div>
                  <table className="ranktable">
                    <thead><tr><th>配布会社</th><th>原価</th><th>見積</th></tr></thead>
                    <tbody>
                      {analysis.quotes.companyTotals.map((t, i) => (
                        <tr key={t.companyId} className={i === 0 ? 'top' : ''}>
                          <td><span className="codot" style={{ background: t.color }} />{t.name}</td>
                          <td>¥{t.cost.toLocaleString()}</td>
                          <td>¥{t.quote.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }) { return <section className="section"><h3>{title}</h3>{children}</section>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Row({ k, v, strong }) { return <div className={`kv ${strong ? 'strong' : ''}`}><span>{k}</span><span>{v}</span></div>; }
function LegendLine({ color, label, dashed }) {
  return <span className="legend"><i style={{ background: dashed ? `repeating-linear-gradient(90deg,${color} 0 4px,transparent 4px 7px)` : color, height: 3, width: 16, borderRadius: 2 }} />{label}</span>;
}
function profileLabel(p) {
  const min = p.ageMin === '' ? 0 : Number(p.ageMin);
  const max = p.ageMax === '' ? 120 : Number(p.ageMax);
  const age = min === 0 && max >= 120 ? '全年齢' : max >= 120 ? `${min}歳以上` : `${min}〜${max}歳`;
  const sex = { all: '', female: 'の女性', male: 'の男性' }[p.sex] || '';
  return age + sex;
}
function LegendDot({ color, label }) { return <span className="legend"><i style={{ background: color }} />{label}</span>; }
function LegendGradient() { return <span className="legend"><i style={{ background: 'linear-gradient(90deg,hsl(0,80%,45%),hsl(60,80%,45%),hsl(120,80%,45%))', width: 40 }} />スコア低→高</span>; }
function sourceLabel(s) { return { google: 'Google Places', osm: 'OpenStreetMap', sample: 'サンプル', none: '-' }[s] || s; }
