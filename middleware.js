import { NextResponse } from "next/server";

export const config = {
  matcher: ["/trip/:id*"],
};

const SUPABASE_URL = "https://wnjxtjeospeblvqdqsdj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Induanh0amVvc3BlYmx2cWRxc2RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTI2MjQsImV4cCI6MjA4OTI4ODYyNH0.l3OHQ9_v5__lkX_AryEkmg2uYGgxnTR4KqViV8foNls";
const SITE_URL = "https://www.tripcopycat.com";

export default async function middleware(req) {
  const url = new URL(req.url);
  // Extract trip ID from /trip/123
  const match = url.pathname.match(/^\/trip\/([^/]+)/);
  if (!match) return NextResponse.next();

  const id = match[1];

  let title = "TripCopycat — Real Itineraries from Real Travelers";
  let description = "Copy real trips planned by real travelers. Browse free travel itineraries and submit your own.";
  let ogImage = `${SITE_URL}/TripCopycat_OG.png`;
  let canonicalUrl = `${SITE_URL}/trip/${id}`;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?id=eq.${id}&status=eq.published&select=title,destination,image,duration,region,loves&limit=1`,
      {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (res.ok) {
      const rows = await res.json();
      const trip = rows?.[0];
      if (trip) {
        title = `${trip.title} — TripCopycat`;
        description = trip.loves
          ? trip.loves.slice(0, 160)
          : `${trip.destination} · ${trip.duration} · Real traveler itinerary on TripCopycat`;
        if (trip.image) {
          ogImage = trip.image.startsWith("http") ? trip.image : `${SITE_URL}${trip.image}`;
        } else {
          // Fall back to generated OG image
          ogImage = `${SITE_URL}/api/og?id=${id}`;
        }
      }
    }
  } catch (_) {
    // Fall through to defaults
  }

  // Rewrite to index.html but inject meta tags via response headers isn't possible —
  // we need to return modified HTML. Fetch the base index.html and inject.
  const indexRes = await fetch(`${SITE_URL}/index.html`);
  let html = await indexRes.text();

  // Replace generic OG tags with trip-specific ones
  html = html
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(title)}</title>`
    )
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escapeHtml(description)}" />`
    )
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escapeHtml(title)}" />`
    )
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`
    )
    .replace(
      /<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${canonicalUrl}" />`
    )
    .replace(
      /<meta property="og:image"[^>]*>/,
      `<meta property="og:image" content="${ogImage}" />`
    )
    .replace(
      /<meta property="og:image:secure_url"[^>]*>/,
      `<meta property="og:image:secure_url" content="${ogImage}" />`
    )
    .replace(
      /<link rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${canonicalUrl}" />`
    );

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
