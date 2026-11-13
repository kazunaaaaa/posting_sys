import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { distanceMeters, uid } from './lib/geo.js';
import { pickByCount } from './lib/selectByCount.js';
import { buildMapImage } from './lib/mapImage.js';
import { townLabel } from './lib/labels.js';
import { COLORS } from './lib/colors.js';

// 「📍から約 N 部を追加」の選択肢
const COUNT_OPTIONS = [1000, 2000, 3000, 5000, 10000, 15000, 20000, 30000, 50000, 100000];
import GoogleMapView from './components/GoogleMapView.jsx';
import SvgMapView from './components/SvgMapView.jsx';

export default function App() {
  const [config, setConfig] = useState(null);
  const [rate, setRate] = useState(0.7);
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

  // 配布部数表（Excel）
  const [storeName, setStoreName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [titleCopies, setTitleCopies] = useState(''); // 空なら合計を1,000部単位に丸めた値
  const [exportMsg, setExportMsg] = useState('');

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
    setTownPrefMunis(d.municipalities);
    setRate(d.distributionRate ?? 0.7);
  }

  // 市区町村の町丁目を読み込む。quiet=true のときは失敗してもエラー枠を出さず例外を投げる。
  async function loadTownCity(code, name, { quiet = false } = {}) {
    if (townCitiesRef.current.some((c) => c.code === code)) return [];
    if (!quiet) setTownErr('');
    setLoading((l) => ({ ...l, town: name }));
    try {
      const d = await api.towns(code);
      const have = new Set(townAreasRef.current.map((t) => t.code));
      const added = d.towns.filter((t) => !have.has(t.code));
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
      setPrefMunis(d.municipalities);
      setMuniSource(d.source);
    } finally { setLoading((l) => ({ ...l, muni: false })); }
  }

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
  function addCircleAtPin() {
    const c = ensurePin();
    if (!c) return;
    const circle = { id: uid('circle'), lat: c.lat, lng: c.lng, radiusKm: Number(radiusKm) || 1 };
    const codes = codesInCircle(circle);
    setCircles((prev) => [...prev, { ...circle, codes }]);
    selectCodes(codes);
  }

  function onCircleChange(id, next) {
    const all = circlesRef.current;
    const cur = all.find((c) => c.id === id);
    if (!cur) return;
    const moved = { ...cur, ...next };
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

  // ---- 「📍から約 N 部を追加」----
  // ピン周辺の市区町村（県境をまたぐ）の町丁目を自動で読み込み、近い順に目標部数まで選ぶ
  async function addByCount() {
    if (mode !== 'town') return;
    const p = ensurePin();
    if (!p) return;
    const target = Number(countTarget);
    const failed = new Set();

    const loadNearby = async (km, limit) => {
      const { municipalities } = await api.nearby(p.lat, p.lng, km, limit);
      const toLoad = municipalities.filter((m) => !townCitiesRef.current.some((c) => c.code === m.code) && !failed.has(m.city));
      if (!toLoad.length) return;
      setCountMsg(`周辺の町丁目を読み込み中…（${toLoad.map((m) => m.city.replace(' ', '')).join('・')}）`);
      const results = await Promise.allSettled(toLoad.map((m) => loadTownCity(m.code, m.city.replace(' ', ''), { quiet: true })));
      results.forEach((r, i) => { if (r.status === 'rejected') failed.add(toLoad[i].city.replace(' ', '')); });
    };
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
      setCountMsg(`📍から約${target.toLocaleString()}部 → ${r.sum.toLocaleString()}部（${r.codes.length}エリア・半径約${r.maxDistanceKm}km）を追加しました`
        + (failed.size ? `\n※ 読み込めなかった市区町村: ${[...failed].join('、')}` : ''));
    } catch (e) {
      setCountMsg(`部数追加に失敗しました: ${e.message}`);
    }
  }

  // ---- 配布部数表（Excel）ダウンロード ----
  async function downloadAreaTable() {
    if (!selectedAreas.length) return;
    setLoading((l) => ({ ...l, export: true }));
    setExportMsg('地図画像を作成中…');
    try {
      const ordered = [...selectedAreas].sort((a, b) => String(a.code).localeCompare(String(b.code)));
      const isTown = mode === 'town';
      const rows = ordered.map((a) => ({
        city: isTown ? a.city : a.pref,
        town: isTown ? a.name : a.city,
        households: a.households,
      }));
      if (rows.some((r) => r.households == null)) throw new Error('世帯数が未取得のエリアがあります（e-Stat接続が必要）');

      let map = null;
      try {
        const areas = ordered.map((a) => (isTown
          ? { rings: a.polygons ?? [a.polygon], center: a.center, name: a.name }
          : boundaryMap[a.code] && { rings: boundaryMap[a.code].polygons, center: boundaryMap[a.code].center, name: a.city })).filter(Boolean);
        map = await buildMapImage({ areas, circles, pin, pinLabel: storeName, labelOf: isTown ? townLabel : (n) => n });
      } catch (e) {
        console.warn('map image failed', e);
      }

      setExportMsg('Excelを作成中…');
      const { blob, filename } = await api.exportAreaXlsx({
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
      setExportMsg(`✅ ${filename} をダウンロードしました`
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

  async function runAnalysis() {
    if (!selected.length) return;
    setLoading((l) => ({ ...l, analyze: true }));
    try {
      let comps = competitors;
      if (businessTypeId && !comps.length) {
        const r = await api.searchCompetitors(businessTypeId, selected, mode);
        comps = r.competitors; setCompetitors(comps); setCompetitorSource(r.source);
      }
      const res = await api.analyze(selected, mode, businessTypeId || null, comps, unitCost);
      setAnalysis(res);
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
        <div className="tagline">世帯数×{Math.round(rate * 100)}%の配布部数 ／ 競合分析 ／ AI最適エリア ／ 配布会社見積</div>
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
          ) : (
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

          <Section title="競合分析">
            <Field label="業態を選択">
              <select value={businessTypeId} onChange={(e) => { setBusinessTypeId(e.target.value); setCompetitors([]); setAnalysis(null); }}>
                <option value="">-- 業態を選択 --</option>
                {businessTypes.map((b) => <option key={b.id} value={b.id}>{b.icon} {b.label}</option>)}
              </select>
            </Field>
            <button className="btn ghost" disabled={!businessTypeId || !selected.length || loading.comp} onClick={loadCompetitors}>
              {loading.comp ? '検索中…' : '競合をプロット'}
            </button>
            {competitorSource && <div className="hint">競合 {competitors.length}件 ・ データ元: {sourceLabel(competitorSource)}</div>}
          </Section>

          <Section title="配布サマリ">
            <Field label="配布単価(円/部)">
              <input type="number" step="0.5" value={unitCost} onChange={(e) => setUnitCost(+e.target.value)} />
            </Field>
            <div className="summary">
              <Row k="選択エリア" v={`${selectedAreas.length} エリア`} />
              <Row k="合計世帯数" v={hasNullHh && totalHouseholds === 0 ? '—' : totalHouseholds.toLocaleString()} />
              <Row k={`配布部数 (×${Math.round(rate * 100)}%)`} v={totalDistribution ? `${totalDistribution.toLocaleString()} 部` : '—'} strong />
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
            {analysis && <LegendGradient />}
          </div>
          <div className="maptoolbar sub">
            <span className="circlectl">
              円選択　半径
              <input type="number" min="0.2" step="0.1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              km
              <button className="chip red" onClick={addCircleAtPin}>円を追加</button>
            </span>
            {mode === 'town' && (
              <span className="countctl">
                📍から 約
                <select value={countTarget} onChange={(e) => setCountTarget(Number(e.target.value))}>
                  {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()}部</option>)}
                </select>
                を
                <button className="chip solid" onClick={addByCount} disabled={!!loading.town}>追加</button>
              </span>
            )}
          </div>
          {(circles.length > 0 || addrMsg || countMsg) && (
            <div className="circlebar">
              {circles.map((c, i) => (
                <span key={c.id} className="circlechip">
                  円{i + 1}（{c.radiusKm}km）
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
              circles={circles}
              pin={pin}
              pinLabel={storeName}
              businessIcon={businessIcon}
              onToggle={toggle}
              onApi={handleApi}
              onCircleChange={onCircleChange}
              onPinChange={setPin}
              emptyHint={mode === 'municipality' ? '都道府県を選び、自治体を選択してください' : 'エリアを選択してください'}
            />
          </div>
        </main>

        {/* 右パネル */}
        <aside className="panel right">
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
                  <table className="ranktable">
                    <thead><tr><th>順位</th><th>エリア</th><th>点</th><th>競合</th></tr></thead>
                    <tbody>
                      {analysis.scoring.areas.map((a, i) => (
                        <tr key={a.code} className={a.code === bestCode ? 'top' : ''}>
                          <td>{i + 1}</td><td>{a.name}</td><td>{a.score}</td><td>{a.competitorCount}</td>
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
function LegendDot({ color, label }) { return <span className="legend"><i style={{ background: color }} />{label}</span>; }
function LegendGradient() { return <span className="legend"><i style={{ background: 'linear-gradient(90deg,hsl(0,80%,45%),hsl(60,80%,45%),hsl(120,80%,45%))', width: 40 }} />スコア低→高</span>; }
function sourceLabel(s) { return { google: 'Google Places', osm: 'OpenStreetMap', sample: 'サンプル', none: '-' }[s] || s; }
