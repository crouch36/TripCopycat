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

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: "Failed to parse request body: " + e.message });
    return;
  }

  // New format: imageUrls + prompt (server fetches images to avoid client 4.5MB payload limit)
  if (body.imageUrls && body.prompt) {
    const imageParts = [];
    for (const url of body.imageUrls) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const buf = await r.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          imageParts.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
        }
      } catch {}
    }
    body = { contents: [{ parts: [{ text: body.prompt }, ...imageParts] }] };
  }

  if (!body || !body.contents) {
    res.status(400).json({ error: "Invalid body — missing contents", received: typeof body });
    return;
  }

  const requestBody = {
    ...body,
    generationConfig: {
      ...(body.generationConfig || {}),
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: data?.error?.message || "Gemini API error",
        code: data?.error?.code,
      });
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
