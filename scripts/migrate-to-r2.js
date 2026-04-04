#!/usr/bin/env node
/**
 * migrate-to-r2.js
 * One-time script: copies images from Supabase Storage → Cloudflare R2
 * and updates trips.image and trips.gallery with new R2 URLs.
 *
 * Usage:
 *   node scripts/migrate-to-r2.js            # live run
 *   node scripts/migrate-to-r2.js --dry-run  # preview without making any changes
 *
 * Requires env vars (loaded from .env or src/.env at project root):
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME, R2_PUBLIC_URL
 */

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");

// ── Env loader ────────────────────────────────────────────────────────────────
function loadEnv(relPath) {
  try {
    const lines = readFileSync(join(__dirname, "..", relPath), "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch (_) {}
}
loadEnv(".env");
loadEnv("src/.env");

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.VITE_SUPABASE_URL    ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const R2_ACCOUNT_ID    = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY    = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY    = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET        = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL    = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

const missing = [
  !SUPABASE_URL     && "VITE_SUPABASE_URL",
  !SUPABASE_SERVICE && "SUPABASE_SERVICE_KEY",
  !R2_ACCOUNT_ID    && "R2_ACCOUNT_ID",
  !R2_ACCESS_KEY    && "R2_ACCESS_KEY_ID",
  !R2_SECRET_KEY    && "R2_SECRET_ACCESS_KEY",
  !R2_BUCKET        && "R2_BUCKET_NAME",
  !R2_PUBLIC_URL    && "R2_PUBLIC_URL",
].filter(Boolean);

if (missing.length) {
  console.error("Missing required env vars:", missing.join(", "));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const SUPABASE_HOST = new URL(SUPABASE_URL).hostname;

// ── Helpers ───────────────────────────────────────────────────────────────────
function isSupabaseStorageUrl(url) {
  return (
    typeof url === "string" &&
    url.includes(SUPABASE_HOST) &&
    url.includes("/storage/")
  );
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return { buffer, contentType };
}

async function uploadToR2(buffer, contentType, folder, originalUrl) {
  const rawExt = originalUrl.split("?")[0].split(".").pop() ?? "jpg";
  const ext    = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const key    = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

// Gallery items may be stored as { url, caption } objects or plain strings
function getUrl(item)             { return typeof item === "string" ? item : item?.url ?? null; }
function setUrl(item, newUrl)     { return typeof item === "string" ? newUrl : { ...item, url: newUrl }; }

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  if (DRY_RUN) {
    console.log("DRY RUN — no changes will be written\n");
  } else {
    console.log("LIVE RUN — Supabase Storage URLs will be migrated to R2\n");
  }

  const { data: trips, error } = await supabase
    .from("trips")
    .select("id, image, gallery");

  if (error) {
    console.error("Failed to fetch trips:", error.message);
    process.exit(1);
  }

  console.log(`Fetched ${trips.length} trip(s)\n`);

  let migrated = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const trip of trips) {
    const updates  = {};
    let   anyWork  = false;

    // ── Cover photo ──────────────────────────────────────────────────────────
    if (isSupabaseStorageUrl(trip.image)) {
      anyWork = true;
      if (DRY_RUN) {
        console.log(`[dry] ${trip.id}  cover  ${trip.image}`);
      } else {
        try {
          const { buffer, contentType } = await downloadImage(trip.image);
          const r2url = await uploadToR2(buffer, contentType, "photos", trip.image);
          updates.image = r2url;
          console.log(`  cover  ✓  ${trip.id}\n         →  ${r2url}`);
        } catch (err) {
          console.error(`  cover  ✗  ${trip.id}  ${err.message}`);
          errors++;
          // Skip rest of this trip so the row stays consistent
          continue;
        }
      }
    }

    // ── Gallery ──────────────────────────────────────────────────────────────
    if (Array.isArray(trip.gallery) && trip.gallery.length > 0) {
      const newGallery   = trip.gallery.map((item) => ({ ...item })); // shallow copy
      let   galleryDirty = false;

      for (let i = 0; i < trip.gallery.length; i++) {
        const itemUrl = getUrl(trip.gallery[i]);
        if (!isSupabaseStorageUrl(itemUrl)) continue;

        anyWork = true;

        if (DRY_RUN) {
          console.log(`[dry] ${trip.id}  gallery[${i}]  ${itemUrl}`);
          galleryDirty = true;
          continue;
        }

        try {
          const { buffer, contentType } = await downloadImage(itemUrl);
          const r2url = await uploadToR2(buffer, contentType, "gallery", itemUrl);
          newGallery[i] = setUrl(trip.gallery[i], r2url);
          console.log(`  gallery[${i}]  ✓  ${trip.id}\n              →  ${r2url}`);
          galleryDirty = true;
        } catch (err) {
          console.error(`  gallery[${i}]  ✗  ${trip.id}  ${err.message}`);
          errors++;
        }
      }

      if (galleryDirty && !DRY_RUN) {
        updates.gallery = newGallery;
      }
    }

    if (!anyWork) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      migrated++;
      continue;
    }

    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await supabase
        .from("trips")
        .update(updates)
        .eq("id", trip.id);

      if (upErr) {
        console.error(`  DB update ✗  ${trip.id}  ${upErr.message}`);
        errors++;
      } else {
        migrated++;
      }
    }
  }

  console.log(`
── Summary ──────────────────────────────────
  Migrated : ${migrated}
  Skipped  : ${skipped}  (no Supabase Storage URLs)
  Errors   : ${errors}
─────────────────────────────────────────────`);

  if (DRY_RUN) {
    console.log("\nRe-run without --dry-run to apply changes.");
  } else if (errors === 0) {
    console.log("\nAll done. Supabase Storage images are unchanged — delete manually when ready.");
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
