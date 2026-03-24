export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    res.status(400).send("Missing url");
    return;
  }

  // Only allow proxying from our Supabase bucket
  const allowed = "wnjxtjeospeblvqdqsdj.supabase.co";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).send("Invalid url");
    return;
  }

  if (!parsed.hostname.endsWith(allowed)) {
    res.status(403).send("Forbidden");
    return;
  }

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) {
      res.status(502).send("Upstream error");
      return;
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = await upstream.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(Buffer.from(buffer));
  } catch {
    res.status(504).send("Timeout");
  }
}
