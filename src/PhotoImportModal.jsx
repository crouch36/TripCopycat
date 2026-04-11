import { useState, useRef } from "react";
import { C } from "./constants.js";

// ── EXIF / GPS Helpers ────────────────────────────────────────────────────────

// Extract EXIF GPS and timestamp from image file (client-side, no upload needed)
async function extractExif(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const buf = e.target.result;
      const view = new DataView(buf);
      try {
        if (view.getUint16(0) !== 0xFFD8) return resolve({});
        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset);
          if (marker === 0xFFE1) {
            const len = view.getUint16(offset + 2);
            const exifStr = String.fromCharCode(...new Uint8Array(buf, offset + 4, 6));
            if (exifStr.startsWith("Exif")) {
              const tiffOffset = offset + 10;
              const little = view.getUint16(tiffOffset) === 0x4949;
              const rd = (o, s) => s === 2 ? view.getUint16(tiffOffset + o, little) : view.getUint32(tiffOffset + o, little);
              const ifdOffset = rd(4, 4);
              const entries = rd(ifdOffset, 2);
              let gpsOff = null, dateStr = null;
              for (let i = 0; i < entries; i++) {
                const eOff = tiffOffset + ifdOffset + 2 + i * 12;
                const tag = view.getUint16(eOff, little);
                if (tag === 0x8825) gpsOff = tiffOffset + view.getUint32(eOff + 8, little);
                if (tag === 0x9003) {
                  const cnt = view.getUint32(eOff + 4, little);
                  const valOff = cnt <= 4 ? eOff + 8 : tiffOffset + view.getUint32(eOff + 8, little);
                  dateStr = String.fromCharCode(...new Uint8Array(buf, valOff, cnt - 1));
                }
              }
              let lat = null, lon = null;
              if (gpsOff) {
                try {
                  const gpsEntries = rd(gpsOff - tiffOffset, 2);
                  let latVal, lonVal, latRef, lonRef;
                  for (let i = 0; i < gpsEntries; i++) {
                    const ge = gpsOff + 2 + i * 12;
                    const gtag = view.getUint16(ge, little);
                    const gvoff = tiffOffset + view.getUint32(ge + 8, little);
                    const readRat = off => view.getUint32(off, little) / (view.getUint32(off + 4, little) || 1);
                    if (gtag === 1) latRef = String.fromCharCode(view.getUint8(ge + 8));
                    if (gtag === 2) latVal = readRat(gvoff) + readRat(gvoff+8)/60 + readRat(gvoff+16)/3600;
                    if (gtag === 3) lonRef = String.fromCharCode(view.getUint8(ge + 8));
                    if (gtag === 4) lonVal = readRat(gvoff) + readRat(gvoff+8)/60 + readRat(gvoff+16)/3600;
                  }
                  if (latVal != null && lonVal != null) {
                    lat = latRef === "S" ? -latVal : latVal;
                    lon = lonRef === "W" ? -lonVal : lonVal;
                  }
                } catch(e) {}
              }
              return resolve({ lat, lon, dateStr, filename: file.name });
            }
          }
          if (marker === 0xFFDA) break;
          offset += 2 + view.getUint16(offset + 2);
        }
      } catch(e) {}
      resolve({ filename: file.name });
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

// Compress image via Canvas to ~200KB max
async function compressImage(file, maxW = 640, quality = 0.5) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(",")[1]);
        reader.readAsDataURL(blob);
        URL.revokeObjectURL(url);
      }, "image/jpeg", quality);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Reverse geocode lat/lon to place name using OpenStreetMap (free, no key needed)
async function reverseGeocode(lat, lon) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: { "Accept-Language": "en" }, signal: controller.signal
    });
    clearTimeout(t);
    const data = await res.json();
    const a = data.address || {};
    return [a.tourism || a.amenity || a.leisure || a.building, a.city || a.town || a.village, a.country]
      .filter(Boolean).join(", ");
  } catch { return null; }
}

// ── PhotoImportModal ──────────────────────────────────────────────────────────
// Upload trip photos → extract EXIF → upload to R2 → Gemini analysis → review
// R2 upload flow: compress blob → POST /api/upload-image?folder=temp → pass URLs
// to /api/gemini as { imageUrls: [...], prompt: "..." } — avoids Vercel 4.5MB limit

export default function PhotoImportModal({ onClose, onComplete, skipCloseOnComplete }) {
  const [phase, setPhase] = useState("drop");
  const [photos, setPhotos] = useState([]);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [rawDebug, setRawDebug] = useState("");
  const fileRef = useRef();

  const processPhotos = async (files) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files).slice(0, 30);
    setPhase("processing");
    setProgress(0);

    // Step 1: Extract EXIF from all photos
    setProgressLabel("Reading GPS & timestamps…");
    const metaArr = [];
    for (let i = 0; i < fileArr.length; i++) {
      const meta = await extractExif(fileArr[i]);
      // Reverse geocode if GPS available
      if (meta.lat && meta.lon) {
        meta.placeName = await reverseGeocode(meta.lat, meta.lon);
      }
      metaArr.push(meta);
      setProgress(Math.round((i + 1) / fileArr.length * 30));
    }

    // Step 2: Compress photos to blob and upload to R2 (avoids Vercel 4.5MB client payload limit)
    setProgressLabel("Uploading photos for analysis…");
    const photoUrls = [];
    for (let i = 0; i < fileArr.length; i++) {
      const blob = await new Promise(resolve => {
        const objUrl = URL.createObjectURL(fileArr[i]);
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1200 / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(b => { URL.revokeObjectURL(objUrl); resolve(b); }, "image/jpeg", 0.7);
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
        img.src = objUrl;
      });
      if (blob) {
        try {
          const ext = (fileArr[i].name.split(".").pop() || "jpg").toLowerCase();
          const resp = await fetch(`/api/upload-image?folder=temp&type=image%2Fjpeg&name=photo.${ext}`, {
            method: "POST",
            body: blob
          });
          const upData = await resp.json();
          if (upData.url) photoUrls.push({ url: upData.url, meta: metaArr[i] });
        } catch {}
      }
      setProgress(30 + Math.round((i + 1) / fileArr.length * 40));
    }

    // Step 3: Send R2 URLs to Gemini server function (server fetches images — no client payload limit)
    setProgressLabel("Analysing with AI…");
    setProgress(70);

    const metaSummary = photoUrls.map((p, i) => {
      const m = p.meta;
      const parts = [`Photo ${i + 1}: ${m.filename || "photo"}`];
      if (m.placeName) parts.push(`GPS location: ${m.placeName}`);
      else if (m.lat && m.lon) parts.push(`GPS: ${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}`);
      if (m.dateStr) parts.push(`Taken: ${m.dateStr}`);
      return parts.join(" | ");
    }).join("\n");

    const geminiPrompt = `You are analysing a travel photo album to reconstruct a trip itinerary. Here is the GPS location and timestamp metadata extracted from each photo:\n\n${metaSummary}\n\nIMPORTANT: Use the GPS location data to identify SPECIFIC venue names. If GPS shows a photo was taken at a specific street address or named place, use that exact place name. Do not use generic descriptions like "local restaurant" or "hotel balcony" — always try to name the specific venue based on GPS coordinates, visible signage, or recognisable landmarks.\n\nReturn ONLY a JSON object with this exact structure, no other text:\n{\n  "destination": "City, Country",\n  "region": "Europe|Asia|North America|Central America|South America|Africa|Oceania",\n  "duration": "N days",\n  "travelers": "description e.g. Couple, Family, Guys trip",\n  "tags": ["tag1", "tag2"],\n  "loves": "2-4 sentences about specific highlights visible in the photos — name actual places",\n  "doNext": "1-2 sentences of honest advice",\n  "hotels": [{"item": "hotel name from GPS or signage", "detail": "location", "tip": ""}],\n  "restaurants": [{"item": "restaurant name from GPS or signage", "detail": "cuisine type", "tip": ""}],\n  "bars": [{"item": "bar name from GPS or signage", "detail": "type", "tip": ""}],\n  "activities": [{"item": "specific activity or landmark name", "detail": "description", "tip": ""}],\n  "days": [{"day": 1, "date": "", "title": "Day title", "items": [{"time": "", "type": "activity|restaurant|bar|hotel|transport", "label": "specific venue or activity name", "note": ""}]}]\n}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrls: photoUrls.map(p => p.url), prompt: geminiPrompt }),
          signal: controller.signal
        });
      clearTimeout(timeoutId);
      const data = await res.json();
      const rawText = JSON.stringify(data).slice(0, 800);
      setRawDebug(rawText);
      console.log("Gemini response:", rawText);
      setProgress(95);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log("Gemini text:", text.slice(0, 300));
      const jsonMatch = text.replace(/```json\n?|```\n?/g, "").match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);
      setResult(parsed);
      setPhase("review");
      setProgress(100);
    } catch(e) {
      console.error("Gemini API error:", e);
      let msg;
      if (e.name === "AbortError") {
        msg = "Request timed out after 45 seconds. Try with fewer photos or on a stronger connection.";
      } else if (e.message?.includes("413") || e.message?.includes("too large") || e.message?.includes("payload")) {
        msg = "Photos are too large to process. Try selecting fewer photos (10-15) and try again.";
      } else {
        msg = `Analysis failed: ${e.message}. Please try again.`;
      }
      setError(msg);
      setPhase("error");
    }
  };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.7)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:"28px 16px", overflowY:"hidden", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"680px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.22)`, border:`1px solid ${C.tide}` }}>

        {/* header */}
        <div style={{ padding:"22px 30px", borderBottom:`1px solid ${C.tide}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:C.seafoam }}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
            <span style={{ fontSize:"22px" }}>📸</span>
            <div>
              <div style={{ fontSize:"16px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Import from Photos</div>
              <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>AI reads your photos to reconstruct the trip</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
        </div>

        {/* drop zone */}
        {phase === "drop" && (
          <div style={{ padding:"44px 32px", textAlign:"center", background:C.white }}>
            <input ref={fileRef} type="file" multiple accept="image/*" style={{ display:"none" }} onChange={e => processPhotos(e.target.files)} />
            <div onDrop={e => { e.preventDefault(); processPhotos(e.dataTransfer.files); }}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current.click()}
              style={{ border:`2px dashed ${C.tide}`, borderRadius:"16px", padding:"48px 32px", cursor:"pointer", background:C.seafoam, transition:"border-color .2s" }}
              className="tc-hover-border">
              <div style={{ fontSize:"44px", marginBottom:"14px" }}>📁</div>
              <div style={{ fontSize:"17px", fontWeight:700, color:C.slate, marginBottom:"6px" }}>Drop your trip photos here</div>
              <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"20px" }}>Or click to browse · Up to 30 photos · JPEG, PNG, HEIC</div>
              <div style={{ display:"flex", justifyContent:"center", gap:"8px", flexWrap:"wrap" }}>
                {["📍 GPS → place names", "🕐 Timestamps → timeline", "👁️ AI identifies venues", "🗜️ Auto-compressed"].map(t => (
                  <span key={t} style={{ fontSize:"11px", background:C.white, color:C.slateMid, padding:"4px 12px", borderRadius:"20px", border:`1px solid ${C.tide}` }}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* processing */}
        {phase === "processing" && (
          <div style={{ padding:"48px 32px", textAlign:"center", background:C.white }}>
            <div style={{ fontSize:"44px", marginBottom:"20px" }}>
              {progress < 30 ? "📍" : progress < 70 ? "🗜️" : "🤖"}
            </div>
            <div style={{ fontSize:"17px", fontWeight:700, color:C.slate, marginBottom:"6px" }}>{progressLabel}</div>
            <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"28px" }}>This takes about 15–20 seconds for 30 photos</div>
            <div style={{ maxWidth:"380px", margin:"0 auto" }}>
              <div style={{ height:"8px", background:C.seafoamDeep, borderRadius:"4px", overflow:"hidden" }}>
                <div style={{ height:"100%", background:`linear-gradient(90deg,${C.azure},${C.amber})`, borderRadius:"4px", transition:"width .3s", width:`${progress}%` }} />
              </div>
              <div style={{ marginTop:"10px", fontSize:"12px", color:C.muted }}>{progress}%</div>
            </div>
            <div style={{ marginTop:"24px", display:"flex", justifyContent:"center", gap:"7px", flexWrap:"wrap" }}>
              {[["📍 GPS", 0], ["🗜️ Compress", 30], ["🤖 AI Analysis", 70], ["✓ Done", 95]].map(([label, threshold]) => (
                <span key={label} style={{ fontSize:"11px", padding:"4px 11px", borderRadius:"20px", background:progress >= threshold ? C.seafoamDeep : C.sand, color:progress >= threshold ? C.azureDeep : C.muted, transition:"background-color .4s ease, color .4s ease" }}>{label}</span>
              ))}
            </div>
            <button onClick={() => setPhase("drop")} style={{ marginTop:"24px", padding:"8px 20px", borderRadius:"7px", border:`1px solid ${C.tide}`, background:C.white, color:C.muted, fontSize:"12px", cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        )}

        {/* review result */}
        {phase === "review" && result && (
          <div style={{ padding:"24px 28px", maxHeight:"60vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
            <div style={{ background:C.greenBg, border:`1px solid ${C.green}`, borderRadius:"12px", padding:"14px 18px", marginBottom:"20px", display:"flex", alignItems:"center", gap:"10px" }}>
              <span style={{ fontSize:"20px" }}>✅</span>
              <div>
                <div style={{ fontSize:"13px", fontWeight:700, color:C.slate }}>Trip reconstructed from your photos</div>
                <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>Review the details below, then import to your form</div>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"14px" }}>
              {[["📍 Destination", result.destination], ["🌍 Region", result.region], ["⏱️ Duration", result.duration], ["👥 Travelers", result.travelers]].map(([label, val]) => val && (
                <div key={label} style={{ background:C.seafoam, borderRadius:"8px", padding:"10px 12px", border:`1px solid ${C.tide}` }}>
                  <div style={{ fontSize:"10px", color:C.muted, marginBottom:"2px" }}>{label}</div>
                  <div style={{ fontSize:"12px", fontWeight:600, color:C.slate }}>{val}</div>
                </div>
              ))}
            </div>

            {result.loves && (
              <div style={{ marginBottom:"12px" }}>
                <div style={{ fontSize:"11px", fontWeight:700, color:C.green, marginBottom:"4px" }}>❤️ WHAT THEY LOVED</div>
                <div style={{ fontSize:"12px", color:C.slateMid, lineHeight:1.65 }}>{result.loves}</div>
              </div>
            )}

            {["bars", "restaurants", "activities", "hotels"].map(cat => result[cat]?.length > 0 && (
              <div key={cat} style={{ marginBottom:"12px" }}>
                <div style={{ fontSize:"11px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:"6px" }}>
                  {cat === "bars" ? "🍸 Bars" : cat === "restaurants" ? "🍽️ Restaurants" : cat === "activities" ? "🎯 Activities" : "🏨 Hotels"}
                </div>
                {result[cat].map((item, i) => (
                  <div key={i} style={{ fontSize:"12px", color:C.slate, padding:"5px 0", borderBottom:`1px solid ${C.seafoamDeep}` }}>
                    <strong>{item.item}</strong>{item.detail ? ` — ${item.detail}` : ""}
                  </div>
                ))}
              </div>
            ))}

            <div style={{ display:"flex", gap:"10px", marginTop:"20px" }}>
              <button onClick={onClose} style={{ flex:1, padding:"10px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Cancel</button>
              <button onClick={() => { onComplete && onComplete(result); if (!skipCloseOnComplete) onClose(); }} style={{ flex:2, padding:"10px", borderRadius:"8px", border:"none", background:C.cta, color:C.ctaText, fontSize:"13px", fontWeight:700, cursor:"pointer" }}>
                Import to Trip Form →
              </button>
            </div>
          </div>
        )}

        {/* error */}
        {phase === "error" && (
          <div style={{ padding:"32px 28px", textAlign:"center" }}>
            <div style={{ fontSize:"36px", marginBottom:"12px" }}>😕</div>
            <div style={{ fontSize:"16px", fontWeight:700, color:C.slate, marginBottom:"8px" }}>Something went wrong</div>
            <div style={{ fontSize:"13px", color:C.slateLight, marginBottom:"16px" }}>{error}</div>
            {rawDebug && (
              <div style={{ background:C.seafoam, border:`1px solid ${C.tide}`, borderRadius:"8px", padding:"10px 12px", marginBottom:"16px", textAlign:"left", maxHeight:"120px", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
                <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, marginBottom:"4px" }}>DEBUG — API Response:</div>
                <div style={{ fontSize:"10px", color:C.slateMid, wordBreak:"break-all", lineHeight:1.5 }}>{rawDebug}</div>
              </div>
            )}
            <button onClick={() => setPhase("drop")} style={{ padding:"10px 24px", borderRadius:"8px", border:"none", background:C.cta, color:C.ctaText, fontWeight:700, cursor:"pointer" }}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  );
}
