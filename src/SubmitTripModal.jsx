import { useState, useRef, useEffect } from "react";
import supabase from "./supabaseClient.js";
import { C, REGIONS } from "./constants.js";
import HybridProcessor from "./HybridProcessor.jsx";
import PhotoImportModal from "./PhotoImportModal.jsx";
import SubmitFormStep from "./SubmitFormStep.jsx";

// ── Inline helpers (self-contained, no external deps beyond supabase) ─────────

const PROFANITY = ["spam","scam","xxx","porn","casino","viagra"];
function runContentFilter(trip) {
  const { image, gallery, ...textFields } = trip;
  const text = JSON.stringify(textFields).toLowerCase();
  const flags = [];
  PROFANITY.forEach(w => { if (text.includes(w)) flags.push("Contains flagged word: " + w); });
  if ((text.match(/http/g)||[]).length > 2) flags.push("Multiple URLs detected");
  if (!trip.title || trip.title.length < 5) flags.push("Trip title too short");
  if (!trip.loves || trip.loves.length < 20) flags.push("What you loved section too brief");
  if (text.length < 200) flags.push("Submission content too thin");
  const lv = (trip.loves||"").replace(/[^A-Za-z]/g,"");
  const capsRatio = lv.split("").filter(c=>c===c.toUpperCase()&&c!==c.toLowerCase()).length / Math.max(lv.length,1);
  if (capsRatio > 0.6 && lv.length > 20) flags.push("Excessive capitals detected");
  return { passed: flags.length === 0, flags };
}

const getSessionId = () => {
  let sid = sessionStorage.getItem("tc_sid");
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("tc_sid", sid);
  }
  return sid;
};

const trackEvent = (eventType, eventData = {}) => {
  try {
    supabase.from("analytics_events").insert([{
      event_type: eventType,
      event_data: eventData,
      session_id: getSessionId(),
    }]).then(() => {});
  } catch (_) {}
};

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title:"", destination:"", region:"Europe", duration:"", travelers:"", date:"", tags:[], loves:"", doNext:"",
  airfare:[{item:"",detail:"",tip:""}], hotels:[{item:"",detail:"",tip:""}],
  restaurants:[{item:"",detail:"",tip:""}], bars:[{item:"",detail:"",tip:""}],
  activities:[{item:"",detail:"",tip:""}], days:[], focalPoint:{x:50,y:50}, gallery:[]
};

const AI_SUBMISSION_PROMPT = `You are helping me document a trip I took so I can share it on TripCopycat.

Please ask me questions about my trip conversationally, one section at a time. When you have gathered all the information, output ONLY a JSON object in this exact format with no other text before or after it:

{
  "title": "Trip title e.g. Ireland Guys Trip",
  "destination": "City/Region, Country",
  "region": "Europe",
  "date": "Month Year",
  "duration": "N days",
  "travelers": "e.g. Guys trip, Family of 4, Couple",
  "tags": ["food & wine", "culture"],
  "loves": "3-5 sentences about highlights",
  "doNext": "2-3 sentences of honest advice",
  "airfare": [
    { "item": "Airline and route", "detail": "~$X per person", "tip": "booking tip" }
  ],
  "hotels": [
    { "item": "Hotel name", "detail": "N nights, ~$X/night", "tip": "tip" }
  ],
  "restaurants": [
    { "item": "Restaurant name", "detail": "~$X per person", "tip": "tip" }
  ],
  "bars": [
    { "item": "Bar name", "detail": "~$X per person", "tip": "tip" }
  ],
  "activities": [
    { "item": "Activity name", "detail": "~$X per person", "tip": "tip" }
  ],
  "days": [
    {
      "day": 1,
      "date": "Mar 14",
      "title": "Arrival in Dublin",
      "items": [
        { "time": "2:00 PM", "type": "activity", "label": "What you did", "note": "" }
      ]
    }
  ]
}

Valid region values: Europe, Asia, North America, Central America, South America, Africa, Oceania
Valid tag values: family-friendly, romantic, adventure, food & wine, culture, beach, wildlife, scenic drives

Start by asking: Where did you go and when?`;

// ── DocExtractor ──────────────────────────────────────────────────────────────
// Loads PDF.js + mammoth from CDN, extracts text from user-uploaded PDF/DOCX.
// Only used within SubmitTripModal so lives here rather than as its own file.

function DocExtractor({ onExtracted }) {
  const [status, setStatus] = useState(null);
  const [fileName, setFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [libsLoaded, setLibsLoaded] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const loadScript = (src) => new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    Promise.all([
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js")
    ]).then(() => {
      if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      setLibsLoaded(true);
    }).catch(() => setLibsLoaded(true));
  }, []);

  const extractPDF = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
          let text = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(" ") + "\n";
          }
          resolve(text.trim());
        } catch(err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const extractDOCX = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const result = await window.mammoth.extractRawText({ arrayBuffer: e.target.result });
          resolve(result.value.trim());
        } catch(err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setStatus("loading");
    setErrorMsg("");
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        if (!window.pdfjsLib) throw new Error("PDF library still loading — try again in a moment.");
        text = await extractPDF(file);
      } else if (file.name.toLowerCase().endsWith(".docx") || file.type.includes("wordprocessingml")) {
        if (!window.mammoth) throw new Error("DOCX library still loading — try again in a moment.");
        text = await extractDOCX(file);
      } else {
        throw new Error("Please use a PDF or DOCX file.");
      }
      if (!text) throw new Error("Could not extract text from this file — it may be image-based.");
      onExtracted(text);
      setStatus("done");
    } catch(err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
    e.target.value = "";
  };

  return (
    <div>
      <input ref={ref} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display:"none" }} onChange={handleFile} />
      {status === "done" ? (
        <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px", background:"#EAF3DE", borderRadius:"8px", border:"1px solid #97C459" }}>
          <span style={{ fontSize:"16px" }}>✅</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"12px", fontWeight:700, color:"#3B6D11" }}>Text extracted from {fileName}</div>
            <div style={{ fontSize:"10px", color:"#639922" }}>Added to your brain dump above</div>
          </div>
          <button onClick={() => { setStatus(null); setFileName(""); }} style={{ fontSize:"10px", color:"#639922", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>Remove</button>
        </div>
      ) : status === "loading" ? (
        <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px", background:C.seafoam, borderRadius:"8px", border:`1px solid ${C.tide}` }}>
          <span style={{ fontSize:"16px" }}>⏳</span>
          <div style={{ fontSize:"12px", color:C.slateMid }}>Extracting text from {fileName}…</div>
        </div>
      ) : status === "error" ? (
        <div style={{ padding:"10px 12px", background:"#FCEBEB", borderRadius:"8px", border:"1px solid #F09595", fontSize:"12px", color:"#A32D2D" }}>
          {errorMsg} <button onClick={() => ref.current.click()} style={{ marginLeft:"8px", color:"#A32D2D", background:"none", border:"none", cursor:"pointer", textDecoration:"underline", fontSize:"12px" }}>Try again</button>
        </div>
      ) : (
        <div onClick={() => libsLoaded ? ref.current.click() : null} style={{ border:`2px dashed ${C.tide}`, borderRadius:"8px", padding:"12px 16px", cursor:libsLoaded?"pointer":"wait", background:C.white, display:"flex", alignItems:"center", gap:"10px" }}
          onMouseEnter={e=>{ if(libsLoaded) e.currentTarget.style.borderColor=C.amber; }}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.tide}>
          <span style={{ fontSize:"24px" }}>📎</span>
          <div>
            <div style={{ fontSize:"12px", fontWeight:600, color:C.slate }}>{libsLoaded ? "Upload a PDF or Word document" : "Loading document reader…"}</div>
            <div style={{ fontSize:"10px", color:C.muted, marginTop:"2px" }}>Booking confirmations, travel itineraries, email printouts — text extracted automatically</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HybridPhotoSelector ───────────────────────────────────────────────────────
// Simple multi-photo picker used in the brain dump step (AI-analysis photos only).
// Only used within SubmitTripModal so lives here.

function HybridPhotoSelector({ onChange }) {
  const [files, setFiles] = useState([]);
  const ref = useRef();

  const add = (e) => {
    const added = Array.from(e.target.files).slice(0, 30 - files.length);
    const newFiles = [...files, ...added].slice(0, 30);
    setFiles(newFiles);
    onChange && onChange(newFiles);
    e.target.value = "";
  };

  const remove = (idx) => {
    const updated = files.filter((_, i) => i !== idx);
    setFiles(updated);
    onChange && onChange(updated);
  };

  return (
    <div>
      <input ref={ref} type="file" multiple accept="image/*" style={{ display:"none" }} onChange={add} />
      {files.length > 0 ? (
        <div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", marginBottom:"8px" }}>
            {files.map((f, i) => (
              <div key={i} style={{ position:"relative", width:"52px", height:"52px", borderRadius:"6px", overflow:"hidden", border:`1px solid ${C.tide}` }}>
                <img src={URL.createObjectURL(f)} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                <button onClick={() => remove(i)} style={{ position:"absolute", top:"1px", right:"1px", background:"rgba(0,0,0,0.6)", border:"none", color:"#fff", borderRadius:"50%", width:"16px", height:"16px", cursor:"pointer", fontSize:"10px", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>×</button>
              </div>
            ))}
            {files.length < 30 && (
              <div onClick={() => ref.current.click()} style={{ width:"52px", height:"52px", borderRadius:"6px", border:`2px dashed ${C.tide}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"20px", color:C.muted, background:C.seafoam }}
                className="tc-hover-border">+</div>
            )}
          </div>
          <div style={{ fontSize:"10px", color:C.muted }}>{files.length} photo{files.length!==1?"s":""} selected · {30-files.length} remaining · Used for AI analysis only</div>
        </div>
      ) : (
        <div onClick={() => ref.current.click()} style={{ border:`2px dashed ${C.tide}`, borderRadius:"8px", padding:"14px", textAlign:"center", cursor:"pointer", background:C.white, fontSize:"12px", color:C.slateMid }}
          className="tc-hover-border">
          Tap to add trip photos · up to 30 · Used for AI analysis only
        </div>
      )}
    </div>
  );
}

// ── SubmitTripModal ───────────────────────────────────────────────────────────
// Multi-step modal: prompt → (hybrid-processing | ai-prompt | photo-import |
//   photo-supplement) → form → submitting → done/flagged
//
// Performance note: draftSaving/draftSaved state REMOVED — draft status updates
// use document.getElementById("draft-status") DOM manipulation to avoid
// re-rendering the form on every save tick. Do NOT add those state vars back.

export default function SubmitTripModal({ onClose, currentUser, displayName, onSubmitSuccess, prefillData }) {
  const [step, setStep] = useState(prefillData ? "form" : "prompt");
  const [pastedText, setPastedText] = useState("");
  const [filterResult, setFilterResult] = useState(null);
  const [submitterName, setSubmitterName] = useState(displayName || "");
  const [submitterEmail, setSubmitterEmail] = useState(currentUser?.email || "");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [coverPhoto, setCoverPhoto] = useState(null);
  const [coverPhotoPreview, setCoverPhotoPreview] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [focalPoint, setFocalPoint] = useState({ x: 50, y: 50 });
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [galleryError, setGalleryError] = useState("");
  const [draftExists, setDraftExists] = useState(false);
  const [checkingDraft, setCheckingDraft] = useState(true);
  const autoSaveTimer = useRef(null);
  const [submitError, setSubmitError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");

  // ── Draft: check on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) {
      const fallback = localStorage.getItem("tripcopycat_draft_fallback");
      if (fallback) {
        try { const p = JSON.parse(fallback); if (p.destination || p.title) setDraftExists(true); } catch(e) {}
      }
      setCheckingDraft(false);
      return;
    }
    supabase.from("drafts").select("form_data, updated_at").eq("user_id", currentUser.id).maybeSingle()
      .then(({ data }) => {
        if (data?.form_data) setDraftExists(true);
        else {
          const fallback = localStorage.getItem("tripcopycat_draft_fallback");
          if (fallback) {
            try { const p = JSON.parse(fallback); if (p.destination || p.title) setDraftExists(true); } catch(e) {}
          }
        }
        setCheckingDraft(false);
      });
  }, []);

  // ── Draft: DOM-manipulation status helper (zero re-renders) ──────────────
  const updateDraftStatus = (msg, color) => {
    const el = document.getElementById("draft-status");
    if (el) { el.textContent = msg; el.style.color = color; }
  };

  const saveDraft = async (formData, showIndicator = false) => {
    if (!currentUser) { localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(formData)); return; }
    if (showIndicator) updateDraftStatus("Saving…", C.amber);
    try {
      await supabase.auth.getSession();
      const { error } = await supabase.from("drafts").upsert({
        user_id: currentUser.id,
        form_data: formData,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (error) {
        localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(formData));
        updateDraftStatus("✓ Saved locally", C.amber);
      } else {
        localStorage.removeItem("tripcopycat_draft_fallback");
        updateDraftStatus("✓ Draft saved", C.green);
      }
    } catch(e) {
      localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(formData));
      updateDraftStatus("✓ Saved locally", C.amber);
    }
    if (showIndicator) setTimeout(() => updateDraftStatus("Auto-saving", C.muted), 2500);
  };

  const loadDraft = async () => {
    if (currentUser) {
      const { data } = await supabase.from("drafts").select("form_data").eq("user_id", currentUser.id).maybeSingle();
      if (data?.form_data) { setForm(data.form_data); setDraftExists(false); setStep("form"); return; }
    }
    const fallback = localStorage.getItem("tripcopycat_draft_fallback");
    if (fallback) {
      try { setForm(JSON.parse(fallback)); setDraftExists(false); setStep("form"); } catch(e) {}
    }
  };

  const clearDraft = async () => {
    await supabase.from("drafts").delete().eq("user_id", currentUser.id);
    localStorage.removeItem("tripcopycat_draft_fallback");
    setDraftExists(false);
  };

  // ── Photo upload helpers ──────────────────────────────────────────────────
  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ["image/jpeg","image/png","image/webp","image/heic","image/heif","image/gif","image/avif","image/tiff"];
    if (!allowed.includes(file.type)) { setPhotoError("File type not supported. Please use JPG, PNG, WEBP, HEIC, or similar."); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError("Photo must be under 5MB."); return; }
    setPhotoError("");
    setCoverPhoto(file);
    setCoverPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async () => {
    if (!coverPhoto) return null;
    const ext = coverPhoto.name.split(".").pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("trip-photos").upload(path, coverPhoto, { contentType: coverPhoto.type, upsert: false });
    if (error) { console.error("Photo upload error:", error); return null; }
    const { data } = supabase.storage.from("trip-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const compressForUpload = (file) => new Promise(resolve => {
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

  const uploadGallery = async (onProgress) => {
    if (!galleryFiles.length) return [];
    const urls = [];
    for (let i = 0; i < galleryFiles.length; i++) {
      const gf = galleryFiles[i];
      if (onProgress) onProgress(`Uploading photo ${i + 1} of ${galleryFiles.length}…`);
      const compressed = await compressForUpload(gf.file);
      if (!compressed) continue;
      const path = `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { error } = await supabase.storage.from("trip-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (error) { console.error("Gallery upload error:", error); continue; }
      const { data } = supabase.storage.from("trip-photos").getPublicUrl(path);
      urls.push({ url: data.publicUrl, caption: gf.caption || "" });
    }
    return urls;
  };

  const handleGalleryAdd = (e) => {
    const files = Array.from(e.target.files);
    const allowed = ["image/jpeg","image/png","image/webp","image/heic","image/heif"];
    const valid = files.filter(f => allowed.includes(f.type) && f.size <= 5*1024*1024);
    if (valid.length < files.length) setGalleryError("Some files were skipped (unsupported type or over 5MB).");
    else setGalleryError("");
    const remaining = 5 - galleryFiles.length;
    const toAdd = valid.slice(0, remaining).map(f => ({ file: f, preview: URL.createObjectURL(f), caption: "" }));
    setGalleryFiles(p => [...p, ...toAdd]);
    e.target.value = "";
  };

  const removeGalleryPhoto = (idx) => {
    setGalleryFiles(p => { URL.revokeObjectURL(p[idx].preview); return p.filter((_,i) => i !== idx); });
  };

  const updateCaption = (idx, caption) => {
    setGalleryFiles(p => p.map((g,i) => i === idx ? {...g, caption} : g));
  };

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState(() => prefillData ? {
    title: prefillData?.destination ? `${prefillData.destination} Trip` : "",
    destination: prefillData?.destination || "",
    region: prefillData?.region || "Europe",
    duration: prefillData?.duration || "",
    travelers: prefillData?.travelers || "",
    date: "",
    tags: prefillData?.tags || [],
    loves: prefillData?.loves || "",
    doNext: prefillData?.doNext || "",
    airfare: [{item:"",detail:"",tip:""}],
    hotels: prefillData?.hotels?.length ? prefillData.hotels : [{item:"",detail:"",tip:""}],
    restaurants: prefillData?.restaurants?.length ? prefillData.restaurants : [{item:"",detail:"",tip:""}],
    bars: prefillData?.bars?.length ? prefillData.bars : [{item:"",detail:"",tip:""}],
    activities: prefillData?.activities?.length ? prefillData.activities : [{item:"",detail:"",tip:""}],
    days: prefillData?.days || []
  } : EMPTY_FORM);

  // Keep latest form in ref — zero re-renders, used by auto-save
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
    // Always persist to localStorage immediately on every change — zero network cost, prevents data loss
    try { localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(form)); } catch {}
  }, [form]);

  // Auto-save to Supabase every 20 seconds — runs silently, no state updates
  useEffect(() => {
    if (step !== "form") return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveDraft(formRef.current, false), 20000);
    return () => clearTimeout(autoSaveTimer.current);
  }, [step]);

  // Also save on unmount to catch any unsaved changes
  useEffect(() => {
    return () => {
      if (formRef.current) {
        try { localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(formRef.current)); } catch {}
      }
    };
  }, []);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const updRow = (cat,i,f,v) => setForm(p => { const u=[...p[cat]]; u[i]={...u[i],[f]:v}; return {...p,[cat]:u}; });
  const addRow = cat => setForm(p => ({...p,[cat]:[...p[cat],{item:"",detail:"",tip:""}]}));
  const delRow = (cat,i) => setForm(p => ({...p,[cat]:p[cat].filter((_,idx)=>idx!==i)}));
  const toggleTag = tag => setForm(p => { if (!p.tags.includes(tag) && p.tags.length >= 8) return p; return {...p, tags: p.tags.includes(tag) ? p.tags.filter(t=>t!==tag) : [...p.tags, tag]}; });

  // ── AI prompt step ────────────────────────────────────────────────────────
  const copyPrompt = () => {
    navigator.clipboard.writeText(AI_SUBMISSION_PROMPT);
    setCopiedPrompt(true); setTimeout(() => setCopiedPrompt(false), 2500);
  };

  const parseAIOutput = () => {
    const raw = pastedText.trim();
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { alert("Could not find structured data in the output. Make sure you copied the full response including the JSON block."); return; }
    try {
      const d = JSON.parse(jsonMatch[0]);
      const ensureRows = (arr) => (Array.isArray(arr) && arr.length)
        ? arr.map(r => ({ item: r.item||"", detail: r.detail||"", tip: r.tip||"" }))
        : [{item:"",detail:"",tip:""}];
      setForm(p => ({
        ...p,
        title:        d.title        || p.title,
        destination:  d.destination  || p.destination,
        region:       REGIONS.find(r => r !== "All Regions" && r.toLowerCase() === (d.region||"").toLowerCase()) || p.region,
        date:         d.date         || p.date,
        duration:     d.duration     || p.duration,
        travelers:    d.travelers    || p.travelers,
        tags:         Array.isArray(d.tags) && d.tags.length ? d.tags : p.tags,
        loves:        d.loves        || p.loves,
        doNext:       d.doNext       || p.doNext,
        airfare:      ensureRows(d.airfare),
        hotels:       ensureRows(d.hotels),
        restaurants:  ensureRows(d.restaurants),
        bars:         ensureRows(d.bars),
        activities:   ensureRows(d.activities),
        days:         Array.isArray(d.days) && d.days.length ? d.days : p.days,
      }));
      setStep("form");
    } catch(e) {
      alert("Could not parse the JSON output. Please make sure you copied the complete response.");
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!submitterName || !submitterEmail) { alert("Please add your name and email."); return; }
    setSubmitError("");
    setStep("submitting");
    trackEvent("submit_start", { has_photo: !!coverPhoto, gallery_count: galleryFiles.length });
    try {
      const photoUrl = await Promise.race([
        uploadPhoto(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Photo upload timed out")), 30000))
      ]).catch(() => null);
      if (galleryFiles.length > 0) setUploadStatus("Uploading cover photo…");
      const galleryUrls = await Promise.race([
        uploadGallery((msg) => setUploadStatus(msg)),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Gallery upload timed out")), 30000))
      ]).catch(() => []);
      setUploadStatus("Saving your trip…");

      const tripWithPhoto = { ...form, image: photoUrl || "", focalPoint, gallery: galleryUrls };
      const result = runContentFilter(tripWithPhoto);
      setFilterResult(result);

      const { error } = await supabase.from("submissions").insert([{
        trip_data: tripWithPhoto, submitter_name: submitterName, submitter_email: submitterEmail,
        status: result.passed ? "pending" : "flagged",
        ai_flagged: !result.passed,
        ai_flag_reason: result.flags.join("; "),
        user_id: currentUser?.id || null
      }]);

      if (error) throw error;
      if (currentUser) await supabase.from("drafts").delete().eq("user_id", currentUser.id);
      trackEvent("submit_complete", { has_photo: !!photoUrl, gallery_count: galleryUrls.length });
      setStep("flagged");
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitError(err.message || "Submission failed. Your draft is saved — please try again.");
      setStep("form");
    }
  };

  // ── HybridProcessor onComplete handler ───────────────────────────────────
  const handleHybridComplete = (data) => {
    const mergeRows = (existing, incoming) => {
      if (!incoming?.length) return existing;
      const incomingNames = incoming.map(r => r.item.toLowerCase());
      const keptExisting = existing.filter(r =>
        r.item && !incomingNames.some(n => {
          const el = r.item.toLowerCase();
          return n === el || n.includes(el) || el.includes(n);
        })
      );
      return [...incoming, ...keptExisting];
    };
    const betterText = (a, b) => { if (!a) return b; if (!b) return a; return b.length > a.length ? b : a; };
    setForm(p => ({
      ...p,
      title:        betterText(p.title, data.title),
      destination:  betterText(p.destination, data.destination),
      region:       data.region       || p.region,
      date:         betterText(p.date, data.date),
      duration:     betterText(p.duration, data.duration),
      travelers:    betterText(p.travelers, data.travelers),
      tags:         data.tags?.length ? [...new Set([...p.tags, ...data.tags])] : p.tags,
      loves:        betterText(p.loves, data.loves),
      doNext:       betterText(p.doNext, data.doNext),
      airfare:      mergeRows(p.airfare, data.airfare),
      hotels:       mergeRows(p.hotels, data.hotels),
      restaurants:  mergeRows(p.restaurants, data.restaurants),
      bars:         mergeRows(p.bars, data.bars),
      activities:   mergeRows(p.activities, data.activities),
      days:         data.days?.length && !p.days?.length ? data.days : p.days,
    }));
    window.__hybridPhotos = [];
    window.__supplementPhotos = [];
    window.__hybridText = "";
    setStep("form");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:"28px 16px", overflowY:"hidden", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"720px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.22)`, border:`1px solid ${C.tide}` }}>

        {/* ── Modal header ────────────────────────────────────────────────── */}
        <div style={{ padding:"20px 28px", borderBottom:`1px solid ${C.tide}`, background:C.seafoam, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Submit a Trip</div>
            <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>Share your trip with the TripCopycat community</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            {step === "form" && (
              <>
                <span id="draft-status" style={{ fontSize:"10px", color:C.muted, fontWeight:600, transition:"color .3s" }}>Auto-saving</span>
                <button onClick={() => saveDraft(form, true)} style={{ fontSize:"11px", padding:"5px 12px", borderRadius:"6px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateMid, cursor:"pointer", fontWeight:600 }}>Save Draft</button>
              </>
            )}
            <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
          </div>
        </div>

        {/* ── Step: prompt ────────────────────────────────────────────────── */}
        {step === "prompt" && (
          <div style={{ padding:"28px", maxHeight:"70vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
            {/* Draft resume banner */}
            {draftExists && !checkingDraft && (
              <div style={{ background:C.amberBg, border:`1px solid ${C.amber}`, borderRadius:"12px", padding:"14px 18px", marginBottom:"20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"2px" }}>📝 You have a saved draft</div>
                  <div style={{ fontSize:"11px", color:C.slateMid }}>Pick up where you left off or start fresh.</div>
                </div>
                <div style={{ display:"flex", gap:"8px" }}>
                  <button onClick={loadDraft} style={{ padding:"7px 16px", borderRadius:"7px", border:"none", background:C.amber, color:C.white, fontSize:"12px", fontWeight:700, cursor:"pointer" }}>Continue Draft →</button>
                  <button onClick={clearDraft} style={{ padding:"7px 12px", borderRadius:"7px", border:`1px solid ${C.tide}`, background:C.white, color:C.muted, fontSize:"12px", cursor:"pointer" }}>Discard</button>
                </div>
              </div>
            )}
            <div style={{ textAlign:"center", marginBottom:"20px" }}>
              <div style={{ fontSize:"28px", marginBottom:"8px" }}>✈️</div>
              <div style={{ fontSize:"16px", fontWeight:700, color:C.slate, marginBottom:"4px" }}>Tell us about your trip</div>
              <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.6 }}>Brain dump what you remember — then add photos and let AI fill in the gaps. You can always come back later to add more detail.</div>
            </div>

            {/* Hybrid: text + photos */}
            <div style={{ background:C.seafoam, borderRadius:"14px", border:`1.5px solid ${C.amber}`, padding:"18px", marginBottom:"14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"12px" }}>
                <span style={{ fontSize:"18px" }}>🧠</span>
                <div style={{ fontSize:"13px", fontWeight:700, color:C.slate }}>Step 1 — Brain dump</div>
                <span style={{ fontSize:"9px", fontWeight:700, background:C.amber, color:C.white, padding:"2px 8px", borderRadius:"20px" }}>Start here</span>
              </div>
              <div style={{ fontSize:"11px", color:C.slateMid, marginBottom:"8px", lineHeight:1.6 }}>
                Write anything you remember — as little or as much as you like. Destination, dates, who you went with, hotels, restaurants, highlights, costs. Don't worry about format.
              </div>
              <textarea
                id="hybrid-brain-dump"
                placeholder={`e.g. "Ireland trip, 4 guys, 4 days in October. Flew into Dublin, stayed at The Meyrick in Galway for 3 nights. Highlights: Cliffs of Moher, Sean's Bar was incredible, Bowe's in Dublin. Rented a car ~€80/day. Recommend going in shoulder season."`}
                style={{ width:"100%", minHeight:"90px", padding:"10px 12px", borderRadius:"8px", border:`1px solid ${C.tide}`, fontSize:"12px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate, resize:"vertical", lineHeight:1.6 }}
              />

              {/* Document upload */}
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"14px", marginBottom:"8px" }}>
                <span style={{ fontSize:"18px" }}>📄</span>
                <div style={{ fontSize:"13px", fontWeight:700, color:C.slate }}>Got a PDF or Word doc? <span style={{ fontSize:"11px", fontWeight:400, color:C.muted }}>(optional)</span></div>
              </div>
              <div style={{ fontSize:"11px", color:C.slateMid, marginBottom:"8px", lineHeight:1.6 }}>
                Have an itinerary, booking confirmation, or travel doc? Upload it and we'll extract the text automatically — no copy-pasting needed.
              </div>
              <DocExtractor onExtracted={(text) => {
                const ta = document.getElementById("hybrid-brain-dump");
                if (ta) { ta.value = (ta.value ? ta.value + "\n\n" : "") + text; }
              }} />

              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"14px", marginBottom:"10px" }}>
                <span style={{ fontSize:"18px" }}>📸</span>
                <div style={{ fontSize:"13px", fontWeight:700, color:C.slate }}>Step 2 — Add photos <span style={{ fontSize:"11px", fontWeight:400, color:C.muted }}>(optional but powerful)</span></div>
              </div>
              <div style={{ fontSize:"11px", color:C.slateMid, marginBottom:"10px", lineHeight:1.6, background:C.white, borderRadius:"8px", padding:"10px 12px", border:`1px solid ${C.tide}` }}>
                <strong style={{ color:C.slate }}>These photos are for AI analysis only</strong> — AI reads GPS location data and identifies venues from signage to fill in details your brain dump might have missed. You'll add your actual cover photo and gallery on the next step.
              </div>
              <HybridPhotoSelector onChange={(files) => { window.__hybridPhotos = files; }} />

              <button
                onClick={() => {
                  const text = document.getElementById("hybrid-brain-dump")?.value || "";
                  const photos = window.__hybridPhotos || [];
                  if (!text.trim() && !photos.length) { alert("Please add some text, a document, or photos to get started."); return; }
                  setStep("hybrid-processing");
                  window.__hybridText = text;
                }}
                style={{ width:"100%", marginTop:"14px", padding:"12px", borderRadius:"8px", border:"none", background:C.cta, color:C.ctaText, fontSize:"13px", fontWeight:700, cursor:"pointer", fontFamily:"'Nunito',sans-serif" }}>
                Build My Itinerary →
              </button>
            </div>

            {/* Secondary options */}
            <div style={{ display:"flex", gap:"8px", alignItems:"stretch" }}>
              <button onClick={() => setStep("ai-prompt")} style={{ flex:1, padding:"12px", borderRadius:"10px", border:`1px solid ${C.tide}`, background:C.white, cursor:"pointer", textAlign:"left" }}>
                <div style={{ fontSize:"16px", marginBottom:"4px" }}>🤖</div>
                <div style={{ fontSize:"12px", fontWeight:700, color:C.slate }}>AI Prompt</div>
                <div style={{ fontSize:"10px", color:C.slateLight, marginTop:"2px", lineHeight:1.4 }}>Chat with Claude or ChatGPT, paste the output back</div>
              </button>
              <button onClick={() => setStep("photo-import")} style={{ flex:1, padding:"12px", borderRadius:"10px", border:`1px solid ${C.tide}`, background:C.white, cursor:"pointer", textAlign:"left" }}>
                <div style={{ fontSize:"16px", marginBottom:"4px" }}>📷</div>
                <div style={{ fontSize:"12px", fontWeight:700, color:C.slate }}>Photos Only</div>
                <div style={{ fontSize:"10px", color:C.slateLight, marginTop:"2px", lineHeight:1.4 }}>Upload photos and let AI reconstruct everything</div>
              </button>
              <button onClick={() => setStep("form")} style={{ flex:1, padding:"12px", borderRadius:"10px", border:`1px solid ${C.tide}`, background:C.white, cursor:"pointer", textAlign:"left" }}>
                <div style={{ fontSize:"16px", marginBottom:"4px" }}>✏️</div>
                <div style={{ fontSize:"12px", fontWeight:700, color:C.slate }}>Manual</div>
                <div style={{ fontSize:"10px", color:C.slateLight, marginTop:"2px", lineHeight:1.4 }}>Fill the form fields yourself</div>
              </button>
            </div>
          </div>
        )}

        {/* ── Step: hybrid-processing ──────────────────────────────────────── */}
        {step === "hybrid-processing" && (
          <HybridProcessor
            text={typeof window !== "undefined" ? window.__hybridText || "" : ""}
            photos={typeof window !== "undefined" ? window.__hybridPhotos || [] : []}
            onComplete={handleHybridComplete}
            onBack={() => setStep(window.__supplementPhotos?.length ? "photo-supplement" : "prompt")}
          />
        )}

        {/* ── Step: photo-supplement ───────────────────────────────────────── */}
        {step === "photo-supplement" && (
          <div style={{ padding:"24px 28px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"16px" }}>
              <button onClick={() => setStep("form")} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:"20px", padding:0, lineHeight:1 }}>←</button>
              <div>
                <div style={{ fontSize:"15px", fontWeight:700, color:C.slate }}>Supplement with photos</div>
                <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>AI will read your photos and fill in anything missing from your current form — without overwriting what's already there.</div>
              </div>
            </div>
            <div style={{ background:C.amberBg, border:`1px solid ${C.amber}44`, borderRadius:"10px", padding:"10px 14px", marginBottom:"16px", fontSize:"11px", color:C.slateMid, lineHeight:1.6 }}>
              <strong style={{ color:C.slate }}>These photos are for AI analysis only</strong> — AI will enhance vague entries with specific names from signage (e.g. "a hotel" → "The Meyrick Hotel"), add new venues it spots, and fill any gaps — without removing data you've already entered.
            </div>
            <HybridPhotoSelector onChange={(files) => { window.__supplementPhotos = files; }} />
            <button
              onClick={() => {
                const photos = window.__supplementPhotos || [];
                if (!photos.length) { alert("Please select at least one photo."); return; }
                window.__hybridPhotos = photos;
                window.__hybridText = `Here is what I already have filled in about this trip. For each field, use the photos to ENHANCE or make more specific — if a photo shows a venue name that matches a vague description, use the specific name. Add new items the photos reveal that aren't already listed. Keep existing specific data as-is.\n\nTitle: ${form.title}\nDestination: ${form.destination}\nRegion: ${form.region}\nDuration: ${form.duration}\nDate: ${form.date}\nTravelers: ${form.travelers}\nLoves: ${form.loves}\nDo Next: ${form.doNext}\nHotels already listed: ${form.hotels?.filter(h=>h.item).map(h=>h.item).join(", ")||"none"}\nRestaurants already listed: ${form.restaurants?.filter(r=>r.item).map(r=>r.item).join(", ")||"none"}\nBars already listed: ${form.bars?.filter(b=>b.item).map(b=>b.item).join(", ")||"none"}\nActivities already listed: ${form.activities?.filter(a=>a.item).map(a=>a.item).join(", ")||"none"}\n\nFor the JSON output: include ALL items (existing + new from photos). If a photo reveals the specific name of something listed vaguely (e.g. "a hotel" → "The Meyrick Hotel"), return the improved version.`;
                setStep("hybrid-processing");
              }}
              style={{ width:"100%", marginTop:"14px", padding:"12px", borderRadius:"8px", border:"none", background:C.cta, color:C.ctaText, fontSize:"13px", fontWeight:700, cursor:"pointer" }}>
              Analyse Photos & Fill Gaps →
            </button>
          </div>
        )}

        {/* ── Step: photo-import ───────────────────────────────────────────── */}
        {step === "photo-import" && (
          <PhotoImportModal
            onClose={() => setStep("prompt")}
            onComplete={(data) => {
              setForm(p => ({
                ...p,
                title: data.destination ? `${data.destination} Trip` : p.title,
                destination: data.destination || p.destination,
                region: data.region || p.region,
                duration: data.duration || p.duration,
                travelers: data.travelers || p.travelers,
                tags: data.tags?.length ? data.tags : p.tags,
                loves: data.loves || p.loves,
                doNext: data.doNext || p.doNext,
                hotels: data.hotels?.length ? data.hotels : p.hotels,
                restaurants: data.restaurants?.length ? data.restaurants : p.restaurants,
                bars: data.bars?.length ? data.bars : p.bars,
                activities: data.activities?.length ? data.activities : p.activities,
                days: data.days?.length ? data.days : p.days,
              }));
              setStep("form");
            }}
            skipCloseOnComplete
          />
        )}

        {/* ── Step: ai-prompt ─────────────────────────────────────────────── */}
        {step === "ai-prompt" && (
          <div style={{ padding:"24px 28px", maxHeight:"70vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
            <div style={{ fontSize:"13px", color:C.slateLight, marginBottom:"14px", lineHeight:1.6 }}>Copy this prompt and paste it into Claude, ChatGPT, or any AI. Answer its questions about your trip. When done, copy the full output and paste it below.</div>
            <pre style={{ background:C.seafoam, border:`1px solid ${C.tide}`, borderRadius:"10px", padding:"14px", fontSize:"10.5px", lineHeight:1.7, color:C.slateMid, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:"200px", overflowY:"auto", WebkitOverflowScrolling:"touch", fontFamily:"monospace", marginBottom:"14px" }}>
              {AI_SUBMISSION_PROMPT}
            </pre>
            <button onClick={copyPrompt} style={{ width:"100%", padding:"10px", borderRadius:"8px", border:"none", background:copiedPrompt?C.green:`linear-gradient(135deg,${C.azureDark},${C.azure})`, color:C.white, fontWeight:700, fontSize:"13px", cursor:"pointer", marginBottom:"16px", transition:"background .2s" }}>
              {copiedPrompt ? "Copied!" : "Copy Prompt"}
            </button>
            <div style={{ fontSize:"12px", fontWeight:600, color:C.slate, marginBottom:"6px" }}>Paste your AI output here:</div>
            <textarea value={pastedText} onChange={e=>setPastedText(e.target.value)} placeholder="Paste the full output from your AI session here..." style={{ width:"100%", height:"130px", padding:"10px 12px", borderRadius:"8px", border:`1px solid ${C.tide}`, fontSize:"12px", outline:"none", boxSizing:"border-box", resize:"vertical", fontFamily:"inherit", color:C.slate }} />
            <div style={{ display:"flex", gap:"10px", marginTop:"12px" }}>
              <button onClick={() => setStep("prompt")} style={{ padding:"9px 18px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Back</button>
              <button onClick={parseAIOutput} disabled={pastedText.length < 50} style={{ flex:1, padding:"9px", borderRadius:"8px", border:"none", background:pastedText.length<50?C.tide:`linear-gradient(135deg,${C.azureDark},${C.azure})`, color:C.white, fontWeight:700, fontSize:"13px", cursor:pastedText.length<50?"not-allowed":"pointer" }}>
                Auto-populate form
              </button>
            </div>
          </div>
        )}

        {/* ── Step: form ──────────────────────────────────────────────────── */}
        {step === "form" && (
          <SubmitFormStep
            form={form} setForm={setForm}
            updRow={updRow} addRow={addRow} delRow={delRow} toggleTag={toggleTag}
            onPhotoSupplement={() => setStep("photo-supplement")}
            coverPhoto={coverPhoto} setCoverPhoto={setCoverPhoto}
            coverPhotoPreview={coverPhotoPreview} setCoverPhotoPreview={setCoverPhotoPreview}
            focalPoint={focalPoint} setFocalPoint={setFocalPoint}
            photoError={photoError} handlePhotoChange={handlePhotoChange}
            galleryFiles={galleryFiles} galleryError={galleryError}
            handleGalleryAdd={handleGalleryAdd}
            removeGalleryPhoto={removeGalleryPhoto} updateCaption={updateCaption}
            submitterName={submitterName} setSubmitterName={setSubmitterName}
            submitterEmail={submitterEmail} setSubmitterEmail={setSubmitterEmail}
            agreedToTerms={agreedToTerms} setAgreedToTerms={setAgreedToTerms}
            onBack={() => setStep("prompt")}
            onSubmit={handleSubmit}
            submitError={submitError}
          />
        )}

        {/* ── Step: submitting ─────────────────────────────────────────────── */}
        {step === "submitting" && (
          <div style={{ padding:"60px 28px", textAlign:"center" }}>
            <div style={{ fontSize:"36px", marginBottom:"14px", animation:"spin 1.5s linear infinite", display:"inline-block" }}>⏳</div>
            <div style={{ fontSize:"16px", fontWeight:700, color:C.slate, marginBottom:"6px" }}>Submitting your trip…</div>
            <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"8px" }}>
              {uploadStatus || "Uploading photos and saving…"}
            </div>
            <div style={{ width:"200px", height:"4px", background:C.seafoam, borderRadius:"2px", margin:"0 auto 24px", overflow:"hidden" }}>
              <div style={{ height:"100%", background:C.amber, borderRadius:"2px", animation:"progress-pulse 1.5s ease-in-out infinite", width:"60%" }} />
            </div>
            <button onClick={() => { setStep("form"); setSubmitError("Submission cancelled — your draft is still here."); setUploadStatus(""); }} style={{ fontSize:"11px", color:C.muted, background:"none", border:`1px solid ${C.tide}`, borderRadius:"6px", padding:"6px 16px", cursor:"pointer" }}>Cancel</button>
          </div>
        )}

        {/* ── Step: done ───────────────────────────────────────────────────── */}
        {step === "done" && (
          <div style={{ padding:"60px 28px", textAlign:"center" }}>
            <div style={{ fontSize:"48px", marginBottom:"14px" }}>🎉</div>
            <div style={{ fontSize:"20px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif", marginBottom:"8px" }}>Itinerary Published!</div>
            <div style={{ fontSize:"13px", color:C.slateLight, maxWidth:"380px", margin:"0 auto 24px", lineHeight:1.6 }}>Your trip passed all checks and is now live on TripCopycat.</div>
            <button className="tc-btn" onClick={onClose} style={{ padding:"11px 28px", borderRadius:"10px", border:"none", background:C.cta, color:C.white, fontWeight:700, fontSize:"13px", cursor:"pointer" }}>View the site</button>
          </div>
        )}

        {/* ── Step: flagged ────────────────────────────────────────────────── */}
        {step === "flagged" && (
          <div style={{ padding:"50px 28px", textAlign:"center" }}>
            <div style={{ fontSize:"40px", marginBottom:"14px" }}>🎉</div>
            <div style={{ fontSize:"18px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif", marginBottom:"8px" }}>Trip Submitted!</div>
            <div style={{ fontSize:"13px", color:C.slateLight, maxWidth:"380px", margin:"0 auto 16px", lineHeight:1.6 }}>Thanks for contributing to TripCopycat! Your trip is under review and will be published shortly. We'll be in touch at <strong>{submitterEmail}</strong>.</div>
            <button className="tc-btn" onClick={onClose} style={{ padding:"11px 28px", borderRadius:"10px", border:"none", background:C.cta, color:C.ctaText, fontWeight:700, fontSize:"13px", cursor:"pointer" }}>Done</button>
          </div>
        )}

      </div>
    </div>
  );
}
