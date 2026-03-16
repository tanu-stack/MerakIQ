export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  const TAVILY_KEY = process.env.TAVILY_API_KEY;

  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel environment variables.' });
  if (!TAVILY_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not set in Vercel environment variables.' });

  try {
    const { competitor, myCompany, mode } = req.body;
    if (!competitor) return res.status(400).json({ error: 'competitor field is required' });

    // Step 1: Tavily searches for real web data
    const [r1, r2, r3] = await Promise.all([
      tavilySearch(`${competitor} software company overview pricing`, TAVILY_KEY),
      tavilySearch(`${competitor} G2 reviews customer feedback`, TAVILY_KEY),
      tavilySearch(`${competitor} product news 2025 2026`, TAVILY_KEY),
    ]);

    const context = [r1, r2, r3]
      .map(r => (r.results || []).map(x => `${x.title}: ${x.content}`).join('\n'))
      .join('\n---\n')
      .slice(0, 5000);

    // Step 2: Groq structures data into JSON
    const prompt = mode === 'battlecard'
      ? `You are a senior PMM analyst. Generate a head-to-head battlecard comparing "${myCompany}" vs "${competitor}".
Context: ${context}
Return ONLY this JSON:
{"youWin":"2 sentences when ${myCompany} wins vs ${competitor}","theyWin":"2 sentences when ${competitor} wins vs ${myCompany}","topObjection":"top objection a ${myCompany} prospect raises after seeing ${competitor}","objectionHandle":"how a ${myCompany} rep handles that objection"}`
      : `You are a senior PMM analyst. Generate a competitor brief for "${competitor}" using this web research:
${context}
Return ONLY this JSON:
{"name":"display name","tagline":"their tagline","founded":"year","headquarters":"city, country","employees":"range","funding":"e.g. $120M Series C","category":"category","threatLevel":"High or Medium or Low","threatReason":"one sentence","gradient":"#hex1,#hex2","scores":{"productStrength":75,"marketPresence":80,"brandAwareness":70,"customerSatisfaction":72},"icp":"2 sentence ICP","positioning":"2 sentence positioning","strengths":["s1","s2","s3","s4"],"weaknesses":["w1","w2","w3"],"keyMessages":["m1","m2","m3"],"g2":{"overallRating":4.3,"totalReviews":1200,"ratings":{"Ease of Use":4.4,"Quality of Support":4.1,"Ease of Setup":4.0,"Value for Money":4.2},"reviews":[{"reviewer":"Marketing Manager, Mid-Market","stars":5,"text":"positive review"},{"reviewer":"Ops Lead, SMB","stars":3,"text":"critical review"},{"reviewer":"Director, Enterprise","stars":4,"text":"balanced review"}]},"pricing":[{"tier":"Free","price":"$0","period":"forever","desc":"core features","featured":false},{"tier":"Pro","price":"$15","period":"per user/mo","desc":"advanced tools","featured":true},{"tier":"Business","price":"$30","period":"per user/mo","desc":"admin controls","featured":false},{"tier":"Enterprise","price":"Custom","period":"annual","desc":"SSO and security","featured":false}],"positioningMap":{"xAxis":"Ease of Use","yAxis":"Feature Depth","competitors":[{"name":"${competitor}","x":65,"y":70,"isMain":true},{"name":"Competitor B","x":40,"y":60,"isMain":false},{"name":"Competitor C","x":75,"y":45,"isMain":false},{"name":"Competitor D","x":55,"y":85,"isMain":false}]},"recentMoves":["move 1","move 2","move 3"]}`;

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2400,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a senior product marketing analyst. Always respond with valid JSON only. No markdown, no backticks.' },
          { role: 'user', content: prompt }
        ],
      }),
    });

    const groqData = await groqResp.json();
    if (groqData.error) throw new Error(`Groq: ${groqData.error.message}`);
    const result = groqData.choices?.[0]?.message?.content;
    if (!result) throw new Error('No content from Groq');

    return res.status(200).json({ result });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function tavilySearch(query, apiKey) {
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 4 }),
    });
    return r.json();
  } catch { return { results: [] }; }
}
