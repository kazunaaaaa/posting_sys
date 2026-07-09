import { useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import GoogleMapView from './components/GoogleMapView.jsx';
import SvgMapView from './components/SvgMapView.jsx';

export default function App() {
  const [config, setConfig] = useState(null);
  const [areas, setAreas] = useState([]);
  const [distributionRate, setRate] = useState(0.7);
  const [selected, setSelected] = useState([]);
  const [businessTypes, setBusinessTypes] = useState([]);
  const [businessTypeId, setBusinessTypeId] = useState('');
  const [competitors, setCompetitors] = useState([]);
  const [competitorSource, setCompetitorSource] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState({});
  const [unitCost, setUnitCost] = useState(5.5);

  useEffect(() => {
    api.config().then(setConfig);
    api.areas().then((d) => {
      setAreas(d.areas);
      setRate(d.distributionRate);
    });
    api.businessTypes().then((d) => setBusinessTypes(d.categories));
  }, []);

  const selectedAreas = useMemo(
    () => areas.filter((a) => selected.includes(a.code)),
    [areas, selected]
  );
  const totalHouseholds = selectedAreas.reduce((s, a) => s + a.households, 0);
  const totalDistribution = selectedAreas.reduce((s, a) => s + a.distribution, 0);
  const estCost = Math.round(totalDistribution * unitCost);

  const scoreByCode = useMemo(() => {
    if (!analysis) return null;
    return Object.fromEntries(analysis.scoring.areas.map((a) => [a.code, a.score]));
  }, [analysis]);
  const bestCode = analysis?.scoring?.best?.code;
  const businessIcon = businessTypes.find((b) => b.id === businessTypeId)?.icon;

  function toggle(code) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
    setAnalysis(null);
  }
  function selectAll() {
    setSelected(areas.map((a) => a.code));
    setAnalysis(null);
  }
  function clearAll() {
    setSelected([]);
    setCompetitors([]);
    setAnalysis(null);
  }

  async function loadCompetitors() {
    if (!businessTypeId || !selected.length) return;
    setLoading((l) => ({ ...l, comp: true }));
    try {
      const r = await api.searchCompetitors(businessTypeId, selected);
      setCompetitors(r.competitors);
      setCompetitorSource(r.source);
    } finally {
      setLoading((l) => ({ ...l, comp: false }));
    }
  }

  async function runAnalysis() {
    if (!selected.length) return;
    setLoading((l) => ({ ...l, analyze: true }));
    try {
      let comps = competitors;
      let src = competitorSource;
      if (businessTypeId && !comps.length) {
        const r = await api.searchCompetitors(businessTypeId, selected);
        comps = r.competitors;
        src = r.source;
        setCompetitors(comps);
        setCompetitorSource(src);
      }
      const res = await api.analyze(selected, businessTypeId || null, comps, unitCost);
      setAnalysis(res);
    } finally {
      setLoading((l) => ({ ...l, analyze: false }));
    }
  }

  const MapComp = config?.googleMapsApiKey ? GoogleMapView : SvgMapView;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">📮 ポスティング配布エリア選択</div>
        <div className="tagline">世帯数×{Math.round(distributionRate * 100)}%の配布部数 ／ 競合分析 ／ AI最適エリア提案</div>
      </header>

      <div className="layout">
        {/* 左パネル: 配布設定 */}
        <aside className="panel left">
          <Section title="配布設定">
            <Field label="配布物"><select defaultValue="flyer"><option value="flyer">チラシ</option><option>ポスティング冊子</option></select></Field>
            <Field label="配布方法"><select defaultValue="standard"><option value="standard">標準配布</option><option>集合住宅中心</option><option>戸建て中心</option></select></Field>
            <Field label="印刷カラー"><select defaultValue="color"><option value="color">両面カラー</option><option>片面カラー</option></select></Field>
            <Field label="サイズ / 用紙"><select defaultValue="a4"><option value="a4">A4 / 光沢紙 標準</option><option>B5 / 上質紙</option></select></Field>
            <Field label="配布単価(円/部)">
              <input type="number" step="0.5" value={unitCost} onChange={(e) => setUnitCost(+e.target.value)} />
            </Field>
          </Section>

          <Section title="競合分析">
            <Field label="業態を選択">
              <select value={businessTypeId} onChange={(e) => { setBusinessTypeId(e.target.value); setCompetitors([]); setAnalysis(null); }}>
                <option value="">-- 業態を選択 --</option>
                {businessTypes.map((b) => (
                  <option key={b.id} value={b.id}>{b.icon} {b.label}</option>
                ))}
              </select>
            </Field>
            <button className="btn ghost" disabled={!businessTypeId || !selected.length || loading.comp} onClick={loadCompetitors}>
              {loading.comp ? '検索中…' : '競合をプロット'}
            </button>
            {competitorSource && (
              <div className="hint">
                競合 {competitors.length}件 ・ データ元: {sourceLabel(competitorSource)}
              </div>
            )}
          </Section>

          <Section title="配布サマリ">
            <div className="summary">
              <Row k="選択エリア" v={`${selectedAreas.length} エリア`} />
              <Row k="合計世帯数" v={totalHouseholds.toLocaleString()} />
              <Row k={`配布部数 (×${Math.round(distributionRate * 100)}%)`} v={`${totalDistribution.toLocaleString()} 部`} strong />
              <Row k="想定コスト" v={`約 ${estCost.toLocaleString()} 円`} />
            </div>
            <button className="btn primary" disabled={!selected.length || loading.analyze} onClick={runAnalysis}>
              {loading.analyze ? 'AI分析中…' : '🤖 AIで最適エリアを分析'}
            </button>
          </Section>
        </aside>

        {/* 中央: 地図 */}
        <main className="mapwrap">
          <div className="maptoolbar">
            <button className="chip" onClick={selectAll}>全エリア選択</button>
            <button className="chip" onClick={clearAll}>クリア</button>
            <span className="spacer" />
            <LegendDot color="#e5007e" label="選択エリア" />
            <LegendDot color="#7c3aed" label="競合" />
            {analysis && <LegendGradient />}
          </div>
          <div className="mapbox">
            <MapComp
              apiKey={config?.googleMapsApiKey}
              center={config?.defaultCenter}
              zoom={config?.defaultZoom}
              areas={areas}
              selected={selected}
              competitors={competitors}
              scoreByCode={scoreByCode}
              bestCode={bestCode}
              businessIcon={businessIcon}
              onToggle={toggle}
            />
          </div>
        </main>

        {/* 右パネル: 選択エリア & AI結果 */}
        <aside className="panel right">
          <Section title={`選択中エリア (${selectedAreas.length})`}>
            {selectedAreas.length === 0 && <div className="hint">地図をクリックしてエリアを選択してください。</div>}
            {selectedAreas.map((a) => (
              <div key={a.code} className="arearow" onClick={() => toggle(a.code)}>
                <div>
                  <b>{a.name}</b>
                  <div className="sub">世帯 {a.households.toLocaleString()} → 配布 {a.distribution.toLocaleString()}部</div>
                </div>
                {scoreByCode && <span className="scorepill" style={{ background: `hsl(${scoreByCode[a.code] * 1.2},70%,45%)` }}>{scoreByCode[a.code]}</span>}
                <span className="remove">×</span>
              </div>
            ))}
          </Section>

          {analysis && (
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
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Row({ k, v, strong }) {
  return (
    <div className={`kv ${strong ? 'strong' : ''}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}
function LegendDot({ color, label }) {
  return <span className="legend"><i style={{ background: color }} />{label}</span>;
}
function LegendGradient() {
  return (
    <span className="legend">
      <i style={{ background: 'linear-gradient(90deg,hsl(0,80%,45%),hsl(60,80%,45%),hsl(120,80%,45%))', width: 40 }} />
      スコア低→高
    </span>
  );
}
function sourceLabel(s) {
  return { google: 'Google Places', osm: 'OpenStreetMap', sample: 'サンプル', none: '-' }[s] || s;
}
