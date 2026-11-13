import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { distanceMeters, uid } from './lib/geo.js';
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

  useEffect(() => {
    api.config().then(setConfig);
    api.businessTypes().then((d) => setBusinessTypes(d.categories));
    api.prefectures().then((d) => setPrefectures(d.prefectures));
    // 初期表示: 千葉県松戸市の町丁目を読み込む
    changeTownPref('千葉県');
    loadTownCity('12207', '松戸市');
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

  async function loadTownCity(code, name) {
    setTownErr('');
    setLoading((l) => ({ ...l, town: name }));
    try {
      const d = await api.towns(code);
      setTownAreas((prev) => {
        const have = new Set(prev.map((t) => t.code));
        return [...prev, ...d.towns.filter((t) => !have.has(t.code))];
      });
      setTownCities((prev) => (prev.some((c) => c.code === code) ? prev : [...prev, { code, name, count: d.towns.length }]));
    } catch (e) {
      setTownErr(`${name}の町丁目を取得できませんでした。\n${e.message}`);
    } finally {
      setLoading((l) => ({ ...l, town: null }));
    }
  }

  function unloadTownCity(code) {
    setTownAreas((prev) => prev.filter((t) => t.cityCode !== code));
    setTownCities((prev) => prev.filter((c) => c.code !== code));
    setSelected((prev) => prev.filter((s) => !s.startsWith(code)));
    setAnalysis(null);
  }

  // モード切替時に選択をリセット
  function switchMode(m) {
    setMode(m); setSelected([]); setCircles([]); setCompetitors([]); setCompetitorSource(null); setAnalysis(null);
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

  const totalHouseholds = selectedAreas.reduce((s, a) => s + (a.households || 0), 0);
  const hasNullHh = selectedAreas.some((a) => a.households == null);
  const totalDistribution = selectedAreas.reduce((s, a) => s + (a.distribution || 0), 0);
  const estCost = Math.round(totalDistribution * unitCost);

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

  function clearAll() { setSelected([]); setCircles([]); setCompetitors([]); setCompetitorSource(null); setAnalysis(null); }

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

  // 円は「その円で選んだコード(codes)」を保持し、移動・縮小で外れたものだけ解除する
  function addCircleAtCenter() {
    const c = mapApiRef.current?.getCenter?.();
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
      mapApiRef.current.panTo({ lat: r.lat, lng: r.lng }, 14);
      setAddrMsg(r.formatted || '移動しました');
    } catch { setAddrMsg('住所が見つかりませんでした'); }
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
        code: a.code, rings: a.polygons ?? [a.polygon], center: a.center, label: a.name,
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
              <div className="hint">地図の町丁目をクリック、または円で選択。世帯数は令和2年国勢調査（町丁・字等別）。</div>
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
              <input placeholder="住所・地名で移動" value={addrQuery} onChange={(e) => setAddrQuery(e.target.value)} />
              <button type="submit" className="chip">🔍</button>
            </form>
            <span className="circlectl">
              半径
              <input type="number" min="0.2" step="0.1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              km
              <button className="chip solid" onClick={addCircleAtCenter}>⊕ 地図中心に円を追加</button>
            </span>
            <button className="chip" onClick={clearAll}>クリア</button>
            <span className="spacer" />
            <LegendDot color="#e5007e" label="選択エリア" />
            <LegendDot color="#7c3aed" label="競合" />
            {analysis && <LegendGradient />}
          </div>
          {(circles.length > 0 || addrMsg) && (
            <div className="circlebar">
              {circles.map((c, i) => (
                <span key={c.id} className="circlechip">
                  円{i + 1}（{c.radiusKm}km）
                  <button onClick={() => removeCircle(c.id)}>×</button>
                </span>
              ))}
              {addrMsg && <span className="addrmsg">{addrMsg}</span>}
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
              businessIcon={businessIcon}
              onToggle={toggle}
              onApi={handleApi}
              onCircleChange={onCircleChange}
              emptyHint={mode === 'municipality' ? '都道府県を選び、自治体を選択してください' : 'エリアを選択してください'}
            />
          </div>
        </main>

        {/* 右パネル */}
        <aside className="panel right">
          <Section title={`選択中エリア (${selectedAreas.length})`}>
            {selectedAreas.length === 0 && <div className="hint">エリアを選択してください。</div>}
            {selectedAreas.map((a) => (
              <div key={a.code} className="arearow" onClick={() => toggle(a.code)}>
                <div>
                  <b>{a.name || a.city}</b>
                  <div className="sub">{a.households != null ? `世帯 ${a.households.toLocaleString()} → 配布 ${a.distribution.toLocaleString()}部` : '世帯数: e-Stat接続で取得'}</div>
                </div>
                {scoreByCode && scoreByCode[a.code] != null && <span className="scorepill" style={{ background: `hsl(${scoreByCode[a.code] * 1.2},70%,45%)` }}>{scoreByCode[a.code]}</span>}
                <span className="remove">×</span>
              </div>
            ))}
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
