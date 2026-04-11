/**
 * Build-time sitemap generator.
 * Fetches all published trips from Supabase and writes public/sitemap.xml.
 * Runs as part of `npm run build` so the updated file is copied into dist/ by Vite.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Public anon credentials — safe to hardcode (already shipped in the client bundle)
const SUPABASE_URL = "https://wnjxtjeospeblvqdqsdj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8usxe69F1Loh3l3-dYHp4g_dnXxwWY7";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITE_URL = "https://www.tripcopycat.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function generate() {
  const { data: trips, error } = await supabase
    .from("trips")
    .select("id, created_at")
    .eq("status", "published");

  if (error) {
    console.error("generate-sitemap: Supabase error —", error.message);
    process.exit(1);
  }

  const homepageEntry = [
    "  <url>",
    `    <loc>${SITE_URL}/</loc>`,
    "    <changefreq>daily</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
  ].join("\n");

  const tripEntries = (trips ?? []).map((t) => {
    const lastmod = t.created_at ? t.created_at.split("T")[0] : null;
    return [
      "  <url>",
      `    <loc>${SITE_URL}/trips/${t.id}</loc>`,
      lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
      "    <changefreq>monthly</changefreq>",
      "    <priority>0.8</priority>",
      "  </url>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    homepageEntry,
    ...tripEntries,
    "</urlset>",
    "",
  ].join("\n");

  const outPath = join(__dirname, "..", "public", "sitemap.xml");
  writeFileSync(outPath, xml, "utf8");

  console.log(
    `generate-sitemap: wrote ${(trips ?? []).length} trip URL(s) + homepage → public/sitemap.xml`
  );
}

generate();
