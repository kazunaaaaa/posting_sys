// Claude API による最適エリアの解説生成
// ANTHROPIC_API_KEY 未設定時はルールベースの解説にフォールバック。
const API_URL = 'https://api.anthropic.com/v1/messages';

function ruleBasedExplanation(scoring, businessTypeLabel) {
  const { best, areas, totals, skipped } = scoring;
  if (!best) {
    if (skipped?.length) {
      return `選択エリアの世帯数が未取得のため分析できません（${skipped.map((s) => s.name).join('、')}）。e-Stat連携（ESTAT_APP_ID / ESTAT_STATS_DATA_ID）を設定するか、町丁目サンプルでお試しください。`;
    }
    return '対象エリアが選択されていません。';
  }
  const top3 = areas.slice(0, 3);
  const lines = [];
  lines.push(
    `【最適エリア】${best.name}（総合スコア ${best.score}点）。` +
      `世帯数 ${best.households.toLocaleString()}、想定配布 ${best.distribution.toLocaleString()}部、` +
      `${businessTypeLabel}の競合は ${best.competitorCount}件（世帯1000あたり ${best.competitorPer1000Households}件）。`
  );
  lines.push(
    `到達${best.breakdown.reach}・競合機会${best.breakdown.opportunity}・効率${best.breakdown.efficiency}・コスト${best.breakdown.cost}の内訳で、` +
      `世帯規模と競合の少なさのバランスが最も優れています。`
  );
  lines.push(
    `上位候補: ${top3.map((a) => `${a.name}(${a.score})`).join(' / ')}。` +
      `選択中エリア合計は世帯 ${totals.households.toLocaleString()}・配布 ${totals.distribution.toLocaleString()}部・想定コスト 約${totals.estimatedCost.toLocaleString()}円です。`
  );
  return lines.join('\n');
}

export async function explainBestArea(scoring, businessTypeLabel) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  if (!apiKey) {
    return { source: 'rule-based', text: ruleBasedExplanation(scoring, businessTypeLabel) };
  }

  const prompt = `あなたはポスティング（チラシ配布）の販促プランナーです。
以下は候補エリアの分析データ（JSON）です。業態は「${businessTypeLabel}」。
配布部数は各エリアの世帯数×70%で算出しています。

${JSON.stringify(scoring, null, 2)}

このデータを踏まえ、日本語で次を簡潔に述べてください:
1. 最も配布に適したエリアはどこか、その理由（世帯規模・競合密度・配布効率の観点）
2. 逆に優先度を下げるべきエリアと理由
3. 予算配分の提案（上位エリアへの傾斜配分の考え方）
箇条書き中心で、合計300〜400字程度。数値は与えられたデータのみ使用すること。`;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = (json.content ?? []).map((b) => b.text).join('').trim();
    return { source: 'claude', model, text: text || ruleBasedExplanation(scoring, businessTypeLabel) };
  } catch (e) {
    console.warn('[claude] failed, fallback to rule-based:', e.message);
    return { source: 'rule-based', text: ruleBasedExplanation(scoring, businessTypeLabel), error: e.message };
  }
}
