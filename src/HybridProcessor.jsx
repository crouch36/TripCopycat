import { useState, useEffect } from "react";

// ── HybridProcessor ───────────────────────────────────────────────────────────
// Receives brain-dump text + photo File array, uploads photos to R2, calls
// Gemini, and returns structured trip data via onComplete.
//
// R2 upload flow: compress blob → POST /api/upload-image?folder=temp
// → pass { imageUrls: [...], prompt } to /api/gemini (no inline base64,
//   avoids Vercel 4.5MB payload limit — do NOT revert to inline base64)

export default function HybridProcessor({ text, photos, onComplete, onBack }) {
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("Preparing...");
  const [error, setError] = useState(null);

  const compressOne = (file) => new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { URL.revokeObjectURL(url); resolve(blob); }, "image/jpeg", 0.7);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });

  useEffect(() => {
    const run = async () => {

      // Step 1: compress and upload photos to R2
      const photoUrls = [];
      if (photos.length > 0) {
        setLabel(`Uploading ${photos.length} photo${photos.length!==1?"s":""}...`);
        for (let i = 0; i < photos.length; i++) {
          const blob = await compressOne(photos[i]);
          if (blob) {
            try {
              const ext = (photos[i].name.split(".").pop() || "jpg").toLowerCase();
              const resp = await fetch(`/api/upload-image?folder=temp&type=image%2Fjpeg&name=photo.${ext}`, {
                method: "POST",
                body: blob
              });
              const upData = await resp.json();
              if (upData.url) photoUrls.push(upData.url);
            } catch {}
          }
          setProgress(Math.round((i + 1) / photos.length * 40));
        }
      } else {
        setProgress(40);
      }

      setLabel("Analysing with AI...");
      setProgress(50);

      const hasText = text.trim().length > 0;
      const hasPhotos = photoUrls.length > 0;

      const prompt = `You are helping a traveller document a trip for a crowd-sourced travel platform called TripCopycat.

${hasText ? `The traveller wrote this brain dump about their trip:\n\n"${text}"\n\n` : ""}${hasPhotos ? `They have also provided ${photoUrls.length} photos from the trip. Use GPS data, visible signage, and landmarks in the photos to identify specific venues and locations.\n\n` : ""}Your job is to extract and structure everything into a trip itinerary. Be as specific as possible — use real venue names from the text or photos. For anything not mentioned, leave it as an empty string or empty array rather than guessing.

IMPORTANT: Never reference photos by number (e.g. "photo 1", "image 3", "in photo 17") anywhere in the output. Never mention photos at all in any field values. All output must read as if written by the traveller from memory, not derived from images.

Return ONLY a valid JSON object with no other text:
{
  "title": "Short descriptive trip title",
  "destination": "City/Region, Country",
  "region": "Europe|Asia|North America|Central America|South America|Africa|Oceania",
  "date": "Month Year",
  "duration": "N days",
  "travelers": "e.g. Couple, Family of 4, Guys trip",
  "tags": [],
  "loves": "What stood out — be specific with place names if mentioned",
  "doNext": "Honest advice for future travellers",
  "airfare": [{"item": "Airline and route", "detail": "~$X per person", "tip": ""}],
  "hotels": [{"item": "Hotel name", "detail": "N nights, ~$X/night", "tip": ""}],
  "restaurants": [{"item": "Restaurant name", "detail": "cuisine, ~$X per person", "tip": ""}],
  "bars": [{"item": "Bar name", "detail": "type", "tip": ""}],
  "activities": [{"item": "Activity name", "detail": "~$X per person", "tip": ""}],
  "days": [{"day": 1, "date": "", "title": "Day title", "items": [{"time": "", "type": "activity|restaurant|bar|hotel|transport", "label": "what happened", "note": ""}]}]
}
Valid tags: family-friendly, romantic, adventure, food & wine, culture, beach, wildlife, scenic drives`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrls: photoUrls, prompt }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        setProgress(90);
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = raw.replace(/```json\n?|```\n?/g, "").match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        const parsed = JSON.parse(jsonMatch[0]);
        setProgress(100);
        setTimeout(() => onComplete(parsed), 300);
      } catch(e) {
        setError(e.name === "AbortError" ? "Request timed out — try with fewer photos or check your connection." : `Analysis failed: ${e.message}`);
      }
    };
    run();
  }, []);

  if (error) return (
    <div style={{ padding:"40px 28px", textAlign:"center" }}>
      <div style={{ fontSize:"32px", marginBottom:"12px" }}>😕</div>
      <div style={{ fontSize:"14px", fontWeight:700, color:"#2C3E50", marginBottom:"8px" }}>Something went wrong</div>
      <div style={{ fontSize:"12px", color:"#7F8C8D", marginBottom:"20px", lineHeight:1.6 }}>{error}</div>
      <div style={{ display:"flex", gap:"8px", justifyContent:"center" }}>
        <button onClick={onBack} style={{ padding:"9px 20px", borderRadius:"8px", border:"1px solid #BDC3C7", background:"#fff", color:"#7F8C8D", fontSize:"12px", cursor:"pointer" }}>← Back</button>
        <button onClick={() => { setError(null); setProgress(0); }} style={{ padding:"9px 20px", borderRadius:"8px", border:"none", background:"#C4A882", color:"#2C3E50", fontSize:"12px", fontWeight:700, cursor:"pointer" }}>Try Again</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding:"56px 28px", textAlign:"center" }}>
      <div style={{ fontSize:"40px", marginBottom:"16px" }}>
        {progress < 40 ? "🗜️" : progress < 80 ? "🤖" : "✨"}
      </div>
      <div style={{ fontSize:"16px", fontWeight:700, color:"#2C3E50", marginBottom:"6px" }}>{label}</div>
      <div style={{ fontSize:"12px", color:"#7F8C8D", marginBottom:"24px" }}>
        {photos.length > 0 && text.trim() ? "Combining your notes and photos..." : photos.length > 0 ? "Reading your photos..." : "Structuring your notes..."}
      </div>
      <div style={{ maxWidth:"360px", margin:"0 auto 16px" }}>
        <div style={{ height:"6px", background:"#ECF0F1", borderRadius:"3px", overflow:"hidden" }}>
          <div style={{ height:"100%", background:"#C4A882", borderRadius:"3px", transition:"width .4s", width:`${progress}%` }} />
        </div>
        <div style={{ marginTop:"8px", fontSize:"11px", color:"#BDC3C7" }}>{progress}%</div>
      </div>
      <button onClick={onBack} style={{ padding:"7px 16px", borderRadius:"7px", border:"1px solid #BDC3C7", background:"#fff", color:"#7F8C8D", fontSize:"11px", cursor:"pointer" }}>Cancel</button>
    </div>
  );
}
