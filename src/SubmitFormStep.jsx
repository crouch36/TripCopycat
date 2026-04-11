import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { C, REGIONS, TAGS, catConfig } from "./constants.js";

// ── SubmitFormStep ─────────────────────────────────────────────────────────────
// Owns all text-field state: form, submitterName, submitterEmail, agreedToTerms.
//
// PERFORMANCE FIX: form state lives here, not in SubmitTripModal.
// Keystrokes only re-render SubmitFormStep — SubmitTripModal (and its header/X
// button) never re-renders on keystrokes. This fixes the X-button freeze.
//
// SubmitTripModal keeps this always mounted (display:none when hidden) so form
// state survives step transitions (hybrid-processing, photo-supplement, etc.)
//
// Parent reads values at submit time via ref:
//   formStepRef.current.getForm()          → current form object
//   formStepRef.current.getSubmitterInfo() → { submitterName, submitterEmail, agreedToTerms }
//   formStepRef.current.mergeForm(data)    → merge HybridProcessor output into form
//   formStepRef.current.setFormData(data)  → replace form wholesale (load draft)

const SubmitFormStep = forwardRef(function SubmitFormStep({
  // Initial values — used only at mount to seed internal state
  initialForm,
  initialSubmitterName,
  initialSubmitterEmail,
  // Navigation callback
  onPhotoSupplement,
  // Cover photo state lives in SubmitTripModal (needed by handleSubmit / upload)
  coverPhoto, setCoverPhoto, coverPhotoPreview, setCoverPhotoPreview,
  focalPoint, setFocalPoint, photoError, handlePhotoChange,
  // Gallery state lives in SubmitTripModal (needed by handleSubmit / upload)
  galleryFiles, galleryError, handleGalleryAdd, removeGalleryPhoto, updateCaption,
  // Submit callbacks
  onBack, onSubmit, submitError,
}, ref) {

  // ── Internal state (NOT lifted to parent — this is the perf fix) ────────
  const [form, setForm] = useState(initialForm);
  const [submitterName, setSubmitterName] = useState(initialSubmitterName || "");
  const [submitterEmail, setSubmitterEmail] = useState(initialSubmitterEmail || "");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Keep latest values in refs so parent can read without causing re-renders
  const formRef = useRef(form);
  const submitterRef = useRef({ submitterName, submitterEmail, agreedToTerms });
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => {
    submitterRef.current = { submitterName, submitterEmail, agreedToTerms };
  }, [submitterName, submitterEmail, agreedToTerms]);

  // Persist form to localStorage on every change — zero network cost, no data loss
  useEffect(() => {
    try { localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(form)); } catch {}
  }, [form]);

  // Final save on unmount — catches any unsaved changes when modal closes
  useEffect(() => {
    return () => {
      try { localStorage.setItem("tripcopycat_draft_fallback", JSON.stringify(formRef.current)); } catch {}
    };
  }, []);

  // ── Imperative API exposed to SubmitTripModal via ref ────────────────────
  useImperativeHandle(ref, () => ({
    // Read current form (used by handleSubmit and auto-save)
    getForm: () => formRef.current,

    // Read submitter info (used by handleSubmit for validation + submission)
    getSubmitterInfo: () => submitterRef.current,

    // Merge HybridProcessor / photo import output into current form
    mergeForm: (data) => {
      const mergeRows = (existing, incoming) => {
        if (!incoming?.length) return existing;
        const incomingNames = incoming.map(r => r.item.toLowerCase());
        const kept = existing.filter(r =>
          r.item && !incomingNames.some(n => {
            const el = r.item.toLowerCase();
            return n === el || n.includes(el) || el.includes(n);
          })
        );
        return [...incoming, ...kept];
      };
      const better = (a, b) => { if (!a) return b; if (!b) return a; return b.length > a.length ? b : a; };
      setForm(p => ({
        ...p,
        title:        better(p.title, data.title),
        destination:  better(p.destination, data.destination),
        region:       data.region        || p.region,
        date:         better(p.date, data.date),
        duration:     better(p.duration, data.duration),
        travelers:    better(p.travelers, data.travelers),
        tags:         data.tags?.length ? [...new Set([...p.tags, ...data.tags])] : p.tags,
        loves:        better(p.loves, data.loves),
        doNext:       better(p.doNext, data.doNext),
        airfare:      mergeRows(p.airfare, data.airfare),
        hotels:       mergeRows(p.hotels, data.hotels),
        restaurants:  mergeRows(p.restaurants, data.restaurants),
        bars:         mergeRows(p.bars, data.bars),
        activities:   mergeRows(p.activities, data.activities),
        days:         data.days?.length && !p.days?.length ? data.days : p.days,
      }));
    },

    // Replace form wholesale — used by loadDraft
    setFormData: (data) => setForm(data),
  }), []);

  // ── Form row helpers ─────────────────────────────────────────────────────
  const updRow = (cat,i,f,v) => setForm(p => { const u=[...p[cat]]; u[i]={...u[i],[f]:v}; return {...p,[cat]:u}; });
  const addRow = cat => setForm(p => ({...p,[cat]:[...p[cat],{item:"",detail:"",tip:""}]}));
  const delRow = (cat,i) => setForm(p => ({...p,[cat]:p[cat].filter((_,idx)=>idx!==i)}));
  const toggleTag = tag => setForm(p => {
    if (!p.tags.includes(tag) && p.tags.length >= 8) return p;
    return {...p, tags: p.tags.includes(tag) ? p.tags.filter(t=>t!==tag) : [...p.tags, tag]};
  });

  // UI-only refs — never cause re-renders
  const focalDragging = useRef(false);
  const photoRef = useRef(null);
  const galleryRef = useRef(null);

  const inp = { width:"100%", padding:"8px 11px", borderRadius:"7px", border:`1px solid ${C.tide}`, fontSize:"12px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate };
  const lbl = { fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" };

  return (
    <>
      {/* ── Scrollable form body ───────────────────────────────────────────── */}
      <div style={{ padding:"20px 28px", maxHeight:"65vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>

        {/* Draft tip + supplement photos prompt */}
        <div style={{ background:C.seafoam, border:`1px solid ${C.tide}`, borderRadius:"10px", padding:"10px 14px", marginBottom:"14px" }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:"10px", marginBottom:"10px" }}>
            <span style={{ fontSize:"16px", flexShrink:0 }}>💾</span>
            <div style={{ fontSize:"11px", color:C.slateMid, lineHeight:1.6 }}>
              <strong style={{ color:C.slate }}>Fill in what you know — come back anytime.</strong> Your draft saves automatically. You don't need to complete everything now. Submit a partial trip and edit it later, or save a draft and return when you have more details.
            </div>
          </div>
          <button onClick={onPhotoSupplement} style={{ width:"100%", padding:"9px 14px", borderRadius:"8px", border:`1.5px solid ${C.amber}`, background:C.amberBg, color:C.slate, fontSize:"12px", fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:"8px", justifyContent:"center" }}>
            <span style={{ fontSize:"14px" }}>📸</span>
            Supplement with photos → let AI fill in missing details
          </button>
        </div>

        {/* Core fields */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"14px" }}>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Trip Title</label><input style={inp} value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} /></div>
          <div><label style={lbl}>Destination</label><input style={inp} value={form.destination} onChange={e=>setForm(p=>({...p,destination:e.target.value}))} /></div>
          <div><label style={lbl}>Region</label><select style={inp} value={form.region} onChange={e=>setForm(p=>({...p,region:e.target.value}))}>{REGIONS.filter(r=>r!=="All Regions").map(r=><option key={r}>{r}</option>)}</select></div>
          <div><label style={lbl}>Duration</label><input style={inp} value={form.duration} onChange={e=>setForm(p=>({...p,duration:e.target.value}))} /></div>
          <div><label style={lbl}>Date</label><input style={inp} value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} /></div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Who Traveled</label><input style={inp} value={form.travelers} onChange={e=>setForm(p=>({...p,travelers:e.target.value}))} /></div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={lbl}>Tags</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"5px", marginTop:"3px" }}>
              {TAGS.filter(t=>t!=="All").map(tag=>(
                <button key={tag} onClick={()=>toggleTag(tag)} style={{ padding:"3px 10px", borderRadius:"20px", fontSize:"11px", fontWeight:600, cursor:"pointer", border:`1px solid ${form.tags.includes(tag)?C.azure:C.tide}`, background:form.tags.includes(tag)?C.azure:C.white, color:form.tags.includes(tag)?C.white:C.slateLight }}>{tag}</button>
              ))}
            </div>
          </div>
          <div style={{ gridColumn:"1/-1" }}><label style={{...lbl,color:C.green}}>What did you love?</label><textarea style={{...inp,height:"100px",resize:"vertical"}} value={form.loves} onChange={e=>setForm(p=>({...p,loves:e.target.value}))} /></div>
          <div style={{ gridColumn:"1/-1" }}><label style={{...lbl,color:C.amber}}>What would you do differently?</label><textarea style={{...inp,height:"100px",resize:"vertical"}} value={form.doNext} onChange={e=>setForm(p=>({...p,doNext:e.target.value}))} /></div>
        </div>

        {/* Category rows */}
        {Object.entries(catConfig).map(([key,cfg]) => (
          <div key={key} style={{ marginBottom:"14px" }}>
            <div style={{ fontSize:"12px", fontWeight:700, color:cfg.color, marginBottom:"6px" }}>{cfg.label}</div>
            {form[key].map((row,i) => (
              <div key={i} style={{ background:C.seafoam, borderRadius:"8px", padding:"10px", marginBottom:"8px", border:`1px solid ${C.tide}` }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"6px", marginBottom:"5px" }}>
                  <input style={inp} placeholder="Name" value={row.item} onChange={e=>updRow(key,i,"item",e.target.value)} />
                  <button onClick={()=>delRow(key,i)} style={{ padding:"5px 10px", borderRadius:"5px", border:`1px solid ${C.red}`, background:C.redBg, color:C.red, cursor:"pointer", fontSize:"12px" }}>✕</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"5px" }}>
                  <textarea style={{...inp, height:"52px", resize:"vertical", fontSize:"11px"}} placeholder="Details / Cost" value={row.detail} onChange={e=>updRow(key,i,"detail",e.target.value)} />
                  <textarea style={{...inp, height:"52px", resize:"vertical", fontSize:"11px"}} placeholder="Insider tip" value={row.tip} onChange={e=>updRow(key,i,"tip",e.target.value)} />
                </div>
              </div>
            ))}
            <button onClick={()=>addRow(key)} style={{ fontSize:"11px", color:cfg.color, background:"none", border:`1px dashed ${cfg.color}`, padding:"3px 10px", borderRadius:"5px", cursor:"pointer", fontWeight:600 }}>+ Add</button>
          </div>
        ))}

        {/* Cover photo */}
        <div style={{ borderTop:`1px solid ${C.tide}`, paddingTop:"14px", marginTop:"6px" }}>
          <div style={{ fontSize:"12px", fontWeight:700, color:C.slate, marginBottom:"6px" }}>📸 Cover Photo <span style={{ fontWeight:400, color:C.muted }}>(optional)</span></div>
          <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/avif,image/tiff" style={{ display:"none" }} onChange={handlePhotoChange} />
          {coverPhotoPreview ? (
            <div style={{ marginBottom:"8px" }}>
              <div style={{ position:"relative", height:"160px", borderRadius:"10px", overflow:"hidden", border:`1px solid ${C.tide}`, cursor:"crosshair", userSelect:"none" }}
                onMouseDown={e => { focalDragging.current = true; const rect = e.currentTarget.getBoundingClientRect(); setFocalPoint({ x: Math.round(((e.clientX - rect.left) / rect.width) * 100), y: Math.round(((e.clientY - rect.top) / rect.height) * 100) }); }}
                onMouseMove={e => { if (!focalDragging.current) return; const rect = e.currentTarget.getBoundingClientRect(); setFocalPoint({ x: Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100))), y: Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100))) }); }}
                onMouseUp={() => { focalDragging.current = false; }}
                onMouseLeave={() => { focalDragging.current = false; }}
                onTouchStart={e => { const t = e.touches[0]; const rect = e.currentTarget.getBoundingClientRect(); setFocalPoint({ x: Math.round(((t.clientX - rect.left) / rect.width) * 100), y: Math.round(((t.clientY - rect.top) / rect.height) * 100) }); }}
                onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; const rect = e.currentTarget.getBoundingClientRect(); setFocalPoint({ x: Math.max(0, Math.min(100, Math.round(((t.clientX - rect.left) / rect.width) * 100))), y: Math.max(0, Math.min(100, Math.round(((t.clientY - rect.top) / rect.height) * 100))) }); }}>
                <img src={coverPhotoPreview} alt="Cover preview" style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:`${focalPoint.x}% ${focalPoint.y}%`, display:"block", pointerEvents:"none" }} />
                <div style={{ position:"absolute", left:`${focalPoint.x}%`, top:`${focalPoint.y}%`, transform:"translate(-50%,-50%)", pointerEvents:"none" }}>
                  <div style={{ width:"28px", height:"28px", borderRadius:"50%", border:"2px solid white", boxShadow:"0 0 0 1px rgba(0,0,0,0.4)", background:"rgba(255,255,255,0.2)" }} />
                  <div style={{ position:"absolute", top:"50%", left:"0", right:"0", height:"1px", background:"white", transform:"translateY(-50%)", boxShadow:"0 0 2px rgba(0,0,0,0.5)" }} />
                  <div style={{ position:"absolute", left:"50%", top:"0", bottom:"0", width:"1px", background:"white", transform:"translateX(-50%)", boxShadow:"0 0 2px rgba(0,0,0,0.5)" }} />
                </div>
                <button onClick={e => { e.stopPropagation(); setCoverPhoto(null); setCoverPhotoPreview(null); setFocalPoint({x:50,y:50}); photoRef.current.value=""; }} style={{ position:"absolute", top:"8px", right:"8px", background:"rgba(0,0,0,0.5)", border:"none", color:C.white, borderRadius:"50%", width:"26px", height:"26px", cursor:"pointer", fontSize:"14px", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
              </div>
              <div style={{ fontSize:"10px", color:C.muted, marginTop:"4px", textAlign:"center" }}>Drag to reposition the focal point · Card will crop to this area</div>
            </div>
          ) : (
            <div onClick={() => photoRef.current.click()} style={{ border:`2px dashed ${C.tide}`, borderRadius:"10px", padding:"20px", textAlign:"center", cursor:"pointer", background:C.seafoam, marginBottom:"8px" }} className="tc-hover-border">
              <div style={{ fontSize:"24px", marginBottom:"6px" }}>🖼️</div>
              <div style={{ fontSize:"12px", fontWeight:600, color:C.slateMid }}>Upload a cover photo</div>
              <div style={{ fontSize:"10px", color:C.muted, marginTop:"3px" }}>JPG, PNG, WEBP, HEIC · Max 5MB</div>
            </div>
          )}
          {photoError && <div style={{ fontSize:"11px", color:C.red, marginBottom:"6px" }}>{photoError}</div>}

          {/* Gallery */}
          <div style={{ borderTop:`1px solid ${C.tide}`, paddingTop:"14px", marginTop:"6px", marginBottom:"6px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
              <div style={{ fontSize:"12px", fontWeight:700, color:C.slate }}>📷 Gallery Photos <span style={{ fontWeight:400, color:C.muted }}>(up to 5 · optional)</span></div>
              <span style={{ fontSize:"10px", color:C.muted }}>{galleryFiles.length}/5</span>
            </div>
            <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple style={{ display:"none" }} onChange={handleGalleryAdd} />
            {galleryFiles.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:"8px", marginBottom:"8px" }}>
                {galleryFiles.map((gf, idx) => (
                  <div key={idx} style={{ borderRadius:"8px", overflow:"hidden", border:`1px solid ${C.tide}`, position:"relative" }}>
                    <div style={{ height:"80px", position:"relative" }}>
                      <img src={gf.preview} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                      <button onClick={() => removeGalleryPhoto(idx)} style={{ position:"absolute", top:"4px", right:"4px", background:"rgba(0,0,0,0.55)", border:"none", color:"#fff", borderRadius:"50%", width:"20px", height:"20px", cursor:"pointer", fontSize:"12px", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>×</button>
                    </div>
                    <input placeholder="Caption (optional)" value={gf.caption} onChange={e => updateCaption(idx, e.target.value)} style={{ width:"100%", padding:"5px 7px", border:"none", borderTop:`1px solid ${C.tide}`, fontSize:"10px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate }} />
                  </div>
                ))}
              </div>
            )}
            {galleryFiles.length < 5 && (
              <div onClick={() => galleryRef.current.click()} className="tc-hover-border" style={{ border:`2px dashed ${C.tide}`, borderRadius:"8px", padding:"12px", textAlign:"center", cursor:"pointer", background:C.seafoam, fontSize:"11px", color:C.slateMid, fontWeight:600 }}>
                + Add photos ({5 - galleryFiles.length} remaining)
              </div>
            )}
            {galleryError && <div style={{ fontSize:"11px", color:C.amber, marginTop:"4px" }}>{galleryError}</div>}
          </div>
        </div>

        {/* Submitter details */}
        <div style={{ borderTop:`1px solid ${C.tide}`, paddingTop:"14px", marginTop:"6px" }}>
          <div style={{ fontSize:"12px", fontWeight:700, color:C.slate, marginBottom:"10px" }}>Your details</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
            <div><label style={lbl}>Your Name</label><input style={inp} value={submitterName} onChange={e=>setSubmitterName(e.target.value)} /></div>
            <div><label style={lbl}>Your Email</label><input style={inp} value={submitterEmail} onChange={e=>setSubmitterEmail(e.target.value)} /></div>
          </div>
          <div style={{ fontSize:"10px", color:C.muted, marginTop:"5px" }}>Email never displayed publicly.</div>
        </div>
      </div>

      {/* ── Error bar ─────────────────────────────────────────────────────────── */}
      {submitError && (
        <div style={{ padding:"10px 28px", background:C.redBg, borderTop:`1px solid ${C.red}` }}>
          <div style={{ fontSize:"12px", color:C.red, fontWeight:600 }}>⚠️ {submitError}</div>
        </div>
      )}

      {/* ── Sticky footer ─────────────────────────────────────────────────────── */}
      <div className="tc-modal-footer" style={{ padding:"14px 28px", paddingBottom:"calc(14px + env(safe-area-inset-bottom))", borderTop:`1px solid ${C.tide}`, background:C.seafoam }}>
        <label style={{ display:"flex", alignItems:"flex-start", gap:"10px", marginBottom:"12px", cursor:"pointer" }}>
          <input type="checkbox" checked={agreedToTerms} onChange={e=>setAgreedToTerms(e.target.checked)} style={{ marginTop:"2px", accentColor:C.amber, width:"15px", height:"15px", flexShrink:0 }} />
          <span style={{ fontSize:"11px", color:C.slateMid, lineHeight:1.6 }}>
            I agree to the <span onClick={e=>{e.preventDefault();window.__setShowLegal&&window.__setShowLegal(true);}} style={{ color:C.amber, fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>Terms of Service</span> and grant TripCopycat permission to share my itinerary with the community.
          </span>
        </label>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <button onClick={onBack} style={{ padding:"9px 18px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Back</button>
          <button onClick={onSubmit} disabled={!agreedToTerms} style={{ padding:"9px 24px", borderRadius:"8px", border:"none", background:agreedToTerms?C.cta:C.tide, color:agreedToTerms?C.ctaText:C.muted, fontSize:"12px", fontWeight:700, cursor:agreedToTerms?"pointer":"not-allowed", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}>Submit Trip</button>
        </div>
      </div>
    </>
  );
});

export default SubmitFormStep;
