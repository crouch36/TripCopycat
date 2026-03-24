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
