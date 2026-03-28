const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "API key not configured on server" });
    return;
  }

  try {
    // Disable thinking to get clean JSON output and avoid parsing issues
    const body = {
      ...req.body,
      generationConfig: {
        ...(req.body.generationConfig || {}),
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error("Gemini API error:", JSON.stringify(data).slice(0, 500));
      res.status(upstream.status).json({ error: data?.error?.message || "Gemini API error", detail: data });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    if (err.name === "AbortError") {
      res.status(504).json({ error: "Request timed out" });
    } else {
      res.status(500).json({ error: err.message || "Internal error" });
    }
  }
}
