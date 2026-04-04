import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Parse metadata from query string — body is raw binary
  const reqUrl = new URL(req.url, "https://tripcopycat.com");
  const folder      = reqUrl.searchParams.get("folder") ?? "photos";
  const contentType = reqUrl.searchParams.get("type")   ?? "image/jpeg";
  const origName    = reqUrl.searchParams.get("name")   ?? "upload.jpg";

  if (!contentType.startsWith("image/")) {
    res.status(400).json({ error: "Only image uploads are allowed" });
    return;
  }

  // Buffer the raw body (no automatic body parsing for non-Next.js Node functions)
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  if (!buffer.length) {
    res.status(400).json({ error: "Empty file" });
    return;
  }

  const ext = origName.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
  } catch (err) {
    console.error("R2 upload error:", err);
    res.status(500).json({ error: "Storage upload failed" });
    return;
  }

  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  res.status(200).json({ url });
}
