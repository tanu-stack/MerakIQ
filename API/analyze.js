exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!TAVILY_API_KEY || !GROQ_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing API keys. Make sure TAVILY_API_KEY and GROQ_API_KEY are set in Netlify environment variables." }),
    };
  }

  try {
    const { competitor, myCompany, mode } = JSON.parse(event.body);

    // ── STEP 1: Tavily searches for real web data ──
    const searches = await Promise.all([
      tavilySearch(`${competitor} SaaS company positioning pricing`, TAVILY_API_KEY),
      tavilySearch(`${competitor} G2 reviews rating customers`, TAVILY_API_KEY),
      tavilySearch(`${competitor} recent news product launches 2025 2026`, TAVILY_API_KEY),
    ]);

    const rawContext = searches
      .map(s => s.results?.map(r => `${r.title}\n${r.content}`).join("\n\n") || "")
      .join("\n\n---\n\n")
      .slice(0, 6000); // keep within token limits

    // ── STEP 2: Groq structures it into dashboard JSON ──
    let prompt;

    if (mode === "battlecard") {
      prompt = `You are a senior product marketing analyst.
Using the context below about "${competitor}", generate a head-to-head sales battlecard comparing "${myCompany}" vs "${competitor}".

CONTEXT:
${rawContext}

Respond ONLY with a valid JSON object. No markdown, no backticks.
{
  "youWin": "2 specific sentences: when ${myCompany} wins deals against ${competitor}",
  "theyWin": "2 specific sentences: when ${competitor} wins deals against ${myCompany}",
  "topObjection": "most common objection a ${myCompany} prospect raises after evaluating ${competitor}",
  "objectionHandle": "a confident specific response a ${myCompany} rep should give to that objection"
}`;
    } else {
      prompt = `You are a senior product marketing analyst.
Using the web research context below, generate a comprehensive competitor intelligence brief for "${competitor}".

CONTEXT FROM WEB RESEARCH:
${rawContext}

Respond ONLY with a valid JSON object. No markdown, no backticks, no preamble.
{
  "name": "display name",
  "tagline": "their actual tagline or positioning statement",
  "founded": "year",
  "headquarters": "city, country",
  "employees": "e.g. 500-1000",
  "funding": "e.g. $120M Series C",
  "category": "e.g. Project Management",
  "threatLevel": "High or Medium or Low",
  "threatReason": "one sentence explaining the threat level in general terms",
  "gradient": "two hex colors e.g. #4f46e5,#7c3aed",
  "scores": {
    "productStrength": 0-100,
    "marketPresence": 0-100,
    "brandAwareness": 0-100,
    "customerSatisfaction": 0-100
  },
  "icp": "2 sentence ICP description",
  "positioning": "2 sentence positioning summary",
  "strengths": ["s1","s2","s3","s4"],
  "weaknesses": ["w1","w2","w3"],
  "keyMessages": ["m1","m2","m3"],
  "g2": {
    "overallRating": 4.3,
    "totalReviews": 1240,
    "ratings": {
      "Ease of Use": 4.5,
      "Quality of Support": 4.2,
      "Ease of Setup": 4.1,
      "Value for Money": 4.0
    },
    "reviews": [
      {"reviewer": "Marketing Manager, Mid-Market", "stars": 5, "text": "paraphrased positive highlight from real reviews"},
      {"reviewer": "Ops Lead, SMB", "stars": 3, "text": "paraphrased mixed review with a real criticism"},
      {"reviewer": "Director, Enterprise", "stars": 4, "text": "paraphrased review praising something but noting a limitation"}
    ]
  },
  "pricing": [
    {"tier":"Free","price":"$0","period":"forever","desc":"Core features for individuals","featured":false},
    {"tier":"Pro","price":"$X","period":"per user/mo","desc":"Advanced tools for teams","featured":true},
    {"tier":"Business","price":"$X","period":"per user/mo","desc":"Admin controls and integrations","featured":false},
    {"tier":"Enterprise","price":"Custom","period":"annual","desc":"Security, SSO, dedicated support","featured":false}
  ],
  "positioningMap": {
    "xAxis": "Ease of Use",
    "yAxis": "Feature Depth",
    "competitors": [
      {"name":"${competitor}","x":0-100,"y":0-100,"isMain":true},
      {"name":"Competitor B","x":0-100,"y":0-100,"isMain":false},
      {"name":"Competitor C","x":0-100,"y":0-100,"isMain":false},
      {"name":"Competitor D","x":0-100,"y":0-100,"isMain":false}
    ]
  },
  "recentMoves": ["move 1","move 2","move 3"]
}`;
    }

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 2400,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const groqData = await groqResp.json();

    if (groqData.error) {
      throw new Error(groqData.error.message || "Groq API error");
    }

    const text = groqData.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("Empty response from Groq.");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: text }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

async function tavilySearch(query, apiKey) {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
    }),
  });
  return resp.json();
}
