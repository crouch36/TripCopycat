import { ImageResponse } from "@vercel/og";
import React from "react";

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://wnjxtjeospeblvqdqsdj.supabase.co";
const SITE_URL = "https://www.tripcopycat.com";
const COPYCAT_LOGO = "data:image/png;base64,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";

export default async function handler(req) {
  const { searchParams } = new URL(req.url, SITE_URL);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  let title = "TripCopycat";
  let destination = "";
  let image = null;
  let duration = "";
  let region = "";

  try {
const key = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Induanh0amVvc3BlYmx2cWRxc2RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTI2MjQsImV4cCI6MjA4OTI4ODYyNH0.l3OHQ9_v5__lkX_AryEkmg2uYGgxnTR4KqViV8foNls";
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?id=eq.${id}&status=eq.published&select=title,destination,image,duration,region&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const rows = await res.json();
      const trip = rows?.[0];
      if (trip) {
        title       = trip.title       ?? title;
        destination = trip.destination ?? destination;
image = trip.image ? (trip.image.startsWith('http') ? trip.image : `${SITE_URL}${trip.image}`) : null;
        duration    = trip.duration    ?? duration;
        region      = trip.region      ?? region;
      }
    }
  } catch (_) {
    // Fall through to branded fallback
  }

  const meta = [region, duration].filter(Boolean).join("  ·  ");
  const titleFontSize = title.length > 55 ? 46 : title.length > 35 ? 54 : 62;
  const STRIP_H = 100;

  return new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#2C3E50",
        },
      },

      // Cover photo — full bleed
      image
        ? React.createElement("img", {
            src: image,
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: "1200px",
              height: "630px",
              objectFit: "cover",
              objectPosition: "center",
            },
          })
        : null,

      // Gradient overlay
      React.createElement("div", {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: "1200px",
          height: "630px",
          background: image
            ? "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 40%, rgba(0,0,0,0.1) 100%)"
            : "linear-gradient(135deg, #1C2B3A 0%, #2C3E50 100%)",
        },
      }),

      // Trip text — pinned above the strip
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            bottom: STRIP_H + 8,
            left: 0,
            right: 0,
            display: "flex",
            flexDirection: "column",
            padding: "0 56px 28px",
          },
        },

        meta
          ? React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  fontSize: "19px",
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.65)",
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  marginBottom: "12px",
                },
              },
              meta
            )
          : null,

        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              fontSize: `${titleFontSize}px`,
              fontWeight: 700,
              color: "#FFFFFF",
              lineHeight: 1.15,
              marginBottom: "10px",
              maxWidth: "1060px",
            },
          },
          title
        ),

        destination
          ? React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  fontSize: "26px",
                  color: "rgba(255,255,255,0.80)",
                  fontWeight: 400,
                },
              },
              destination
            )
          : null
      ),

      // Bottom branding strip
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "1200px",
            height: `${STRIP_H}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "rgba(20,30,38,0.96)",
            padding: "0 48px",
          },
        },

        // Left: wordmark
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                fontSize: "30px",
                fontWeight: 700,
                color: "#C4A882",
                letterSpacing: "0.02em",
              },
            },
            "TripCopycat"
          ),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                fontSize: "15px",
                color: "rgba(196,168,130,0.6)",
                letterSpacing: "0.04em",
              },
            },
            "tripcopycat.com"
          )
        ),

        // Right: copycat logo
        React.createElement("img", {
          src: COPYCAT_LOGO,
          style: {
            height: "60px",
            width: "60px",
            objectFit: "contain",
          },
        })
      )
    ),
    { width: 1200, height: 630 }
  );
}
