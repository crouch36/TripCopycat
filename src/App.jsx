import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import supabase from "./supabaseClient.js";
import { C, REGIONS, PRIMARY_TAGS, EXTENDED_TAGS, TAGS, DURATION_FILTERS, catConfig, typeStyles, REGION_GRADIENTS, REGION_EMOJI } from "./constants.js";
import PhotoImportModal from "./PhotoImportModal.jsx";
import HybridProcessor from "./HybridProcessor.jsx";
import SubmitTripModal from "./SubmitTripModal.jsx";

// ── Analytics ─────────────────────────────────────────────────────────────────
const getSessionId = () => {
  let sid = sessionStorage.getItem("tc_sid");
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("tc_sid", sid);
  }
  return sid;
};

const trackEvent = (eventType, eventData = {}) => {
  // Fire and forget — never block UI
  try {
    supabase.from("analytics_events").insert([{
      event_type: eventType,
      event_data: eventData,
      session_id: getSessionId(),
    }]).then(() => {});
  } catch (_) {}
};

// ── Global interaction styles injected once ───────────────────────────────────
const GLOBAL_STYLES = `
  /* Remove iOS tap flash on all interactive elements */
  button, [role="button"], a, input, textarea, select {
    -webkit-tap-highlight-color: transparent;
  }

  /* Button press state — gives physical "click" feel on mobile */
  button:active {
    transform: scale(0.97) !important;
    opacity: 0.85 !important;
  }

  /* Trip card hover */
  .tc-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 32px rgba(28,43,58,0.15) !important;
    border-color: #C4A882 !important;
  }
  .tc-card:active {
    transform: translateY(-1px) scale(0.99);
  }

  /* Standard button hover */
  .tc-btn:hover {
    filter: brightness(1.06);
  }

  /* Ghost/outline button hover */
  .tc-btn-ghost:hover {
    background-color: rgba(196,168,130,0.12) !important;
    border-color: #C4A882 !important;
  }

  /* Tag pill hover */
  .tc-tag:hover {
    background-color: #1C2B3A !important;
    color: #fff !important;
    border-color: #1C2B3A !important;
  }

  /* Focus ring for accessibility */
  button:focus-visible {
    outline: 2px solid #C4A882;
    outline-offset: 2px;
  }
  input:focus, textarea:focus, select:focus {
    border-color: #C4A882 !important;
    box-shadow: 0 0 0 3px rgba(196,168,130,0.15) !important;
  }

  /* Smooth scrollbar */
  * { scrollbar-width: thin; scrollbar-color: #E8DDD0 transparent; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #E8DDD0; border-radius: 99px; }

  /* Border highlight on hover — replaces JS onMouseEnter handlers */
  .tc-hover-border:hover { border-color: #C4A882 !important; }

  /* Lift card hover — for profile cards and related trip cards */
  .tc-lift:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(28,43,58,0.12) !important;
    border-color: #C4A882 !important;
  }
  .tc-lift:active { transform: translateY(0) scale(0.99); }

  /* Sidebar/filter hover */
  .tc-sidebar-btn:hover { background-color: rgba(196,168,130,0.1) !important; }

  /* iOS safe area for modal footers */
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .tc-modal-footer {
      padding-bottom: calc(14px + env(safe-area-inset-bottom)) !important;
    }
  }

  /* Spinner animation */
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes progress-pulse {
    0% { transform: translateX(-100%); }
    50% { transform: translateX(60%); }
    100% { transform: translateX(200%); }
  }

  /* Modal entry animation */
  @keyframes tc-modal-in {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes tc-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .tc-modal-card {
    animation: tc-modal-in 0.18s cubic-bezier(0.34, 1.2, 0.64, 1) both;
  }
  .tc-modal-overlay {
    animation: tc-overlay-in 0.15s ease both;
  }
`;

function GlobalStyles() {
  return <style dangerouslySetInnerHTML={{ __html: GLOBAL_STYLES }} />;
}


// ── Content Filter ────────────────────────────────────────────────────────────
const PROFANITY = ["spam","scam","xxx","porn","casino","viagra"];
function runContentFilter(trip) {
  // Exclude image/gallery fields from URL check — they legitimately contain multiple URLs
  const { image, gallery, ...textFields } = trip;
  const text = JSON.stringify(textFields).toLowerCase();
  const flags = [];
  PROFANITY.forEach(w => { if (text.includes(w)) flags.push('Contains flagged word: ' + w); });
  if ((text.match(/http/g)||[]).length > 2) flags.push("Multiple URLs detected");
  if (!trip.title || trip.title.length < 5) flags.push("Trip title too short");
  if (!trip.loves || trip.loves.length < 20) flags.push("What you loved section too brief");
  if (text.length < 200) flags.push("Submission content too thin");
  const lv = (trip.loves||"").replace(/[^A-Za-z]/g,"");
  const capsRatio = lv.split("").filter(c=>c===c.toUpperCase()&&c!==c.toLowerCase()).length / Math.max(lv.length,1);
  if (capsRatio > 0.6 && lv.length > 20) flags.push("Excessive capitals detected");
  return { passed: flags.length === 0, flags };
}


const SAMPLE_TRIPS = [];


const ADMIN_PASSWORDS = ["Guinness"];

const MOCK_PHOTOS = [
  { id:"p1",  filename:"IMG_0421.jpg", date:"Mar 12, 2:14 PM", location:"Shinjuku, Tokyo",  detectedPlace:"Shinjuku Granbell Hotel",           category:"hotel",      confidence:0.94, accepted:null },
  { id:"p2",  filename:"IMG_0435.jpg", date:"Mar 12, 6:32 PM", location:"Shibuya, Tokyo",   detectedPlace:"Ichiran Ramen Shibuya",              category:"restaurant", confidence:0.91, accepted:null },
  { id:"p3",  filename:"IMG_0502.jpg", date:"Mar 13,10:08 AM", location:"Harajuku, Tokyo",  detectedPlace:"Meiji Shrine",                      category:"activity",   confidence:0.97, accepted:null },
  { id:"p4",  filename:"IMG_0561.jpg", date:"Mar 13, 5:44 PM", location:"Shibuya, Tokyo",   detectedPlace:"Shibuya Crossing",                  category:"activity",   confidence:0.99, accepted:null },
  { id:"p5",  filename:"IMG_0633.jpg", date:"Mar 14, 7:12 AM", location:"Asakusa, Tokyo",   detectedPlace:"Senso-ji Temple",                   category:"activity",   confidence:0.98, accepted:null },
  { id:"p6",  filename:"IMG_0701.jpg", date:"Mar 14, 1:22 PM", location:"Asakusa, Tokyo",   detectedPlace:"Tokyo Skytree",                     category:"activity",   confidence:0.95, accepted:null },
  { id:"p7",  filename:"IMG_0744.jpg", date:"Mar 15, 9:03 AM", location:"Odaiba, Tokyo",    detectedPlace:"teamLab Borderless",                category:"activity",   confidence:0.96, accepted:null },
  { id:"p8",  filename:"IMG_0812.jpg", date:"Mar 15, 6:18 PM", location:"Toyosu, Tokyo",    detectedPlace:"Sushi Dai Toyosu Market",           category:"restaurant", confidence:0.88, accepted:null },
  { id:"p9",  filename:"IMG_0899.jpg", date:"Mar 16, 2:55 PM", location:"Ginza, Tokyo",     detectedPlace:"The Celestine Ginza",               category:"hotel",      confidence:0.87, accepted:null },
  { id:"p10", filename:"IMG_0921.jpg", date:"Mar 16, 5:38 PM", location:"Shibuya, Tokyo",   detectedPlace:"Shibuya Sky Observation Deck",      category:"activity",   confidence:0.99, accepted:null },
  { id:"p11", filename:"IMG_0934.jpg", date:"Mar 17,11:20 AM", location:"Shinjuku, Tokyo",  detectedPlace:"Unknown restaurant (menu detected)",category:"restaurant", confidence:0.61, accepted:null },
  { id:"p12", filename:"IMG_0977.jpg", date:"Mar 17, 3:15 PM", location:"Harajuku, Tokyo",  detectedPlace:"Takeshita Street",                  category:"activity",   confidence:0.92, accepted:null },
];

const MOCK_EMAILS = [
  { id:"e1", source:"United Airlines", subject:"Booking confirmation – JFK→NRT",           extracted:"United Airlines JFK → NRT · Mar 12 · Business class",        category:"airfare",   date:"Mar 12",    accepted:null },
  { id:"e2", source:"Booking.com",     subject:"Reservation confirmed: Shinjuku Granbell", extracted:"Shinjuku Granbell Hotel · Mar 12–16 · $220/night",            category:"hotel",     date:"Mar 12–16", accepted:null },
  { id:"e3", source:"Booking.com",     subject:"Reservation confirmed: The Celestine Ginza",extracted:"The Celestine Ginza · Mar 16–19 · $310/night",               category:"hotel",     date:"Mar 16–19", accepted:null },
  { id:"e4", source:"teamLab",         subject:"Your teamLab Borderless tickets",           extracted:"teamLab Borderless · Mar 15 · 9:00 AM · 2 adults, 2 children",category:"activity",  date:"Mar 15",    accepted:null },
  { id:"e5", source:"Viator",          subject:"Booking confirmed: Ghibli Museum entry",    extracted:"Ghibli Museum · Mar 18 · $15/person · 4 tickets",             category:"activity",  date:"Mar 18",    accepted:null },
  { id:"e6", source:"OpenTable",       subject:"Reservation at Sushi Dai confirmed",         extracted:"Sushi Dai Toyosu · Mar 15 · 6:00 PM · Party of 4",           category:"restaurant",date:"Mar 15",    accepted:null },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPlainText(trip) {
  if (!trip) return "";
  const L = [];
  L.push(`TRIPCOPYCAT — ${trip.title.toUpperCase()}`);
  L.push(`${trip.destination}  ·  ${trip.duration}  ·  ${trip.date}`);
  L.push(`Travelers: ${trip.travelers}`);
  if (trip.days?.length) {
    L.push(""); L.push("DAILY ITINERARY");
    L.push("────────────────────────────────────────");
    trip.days.forEach(d => {
      L.push(""); L.push(`Day ${d.day} — ${d.title}  (${d.date})`);
      d.items.forEach(it => L.push(`  ${it.time.padEnd(8)}·  ${it.label}${it.note ? `  —  ${it.note}` : ""}`));
    });
  }
  L.push(""); L.push("TRIP DETAILS");
  L.push("────────────────────────────────────────");
  Object.entries(catConfig).forEach(([key, cfg]) => {
    if (!trip[key]?.length) return;
    L.push(""); L.push(cfg.label);
    trip[key].forEach(it => L.push(`  •  ${it.item}  |  ${it.detail}  |  Tip: ${it.tip}`));
  });
  L.push(""); L.push("FEEDBACK");
  L.push("────────────────────────────────────────");
  L.push(`Loved:       ${trip.loves}`);
  L.push(`Next time:   ${trip.doNext}`);
  return L.join("\n");
}

function Pill({ category }) {
  const map = { hotel:C.cerulean, restaurant:C.red, activity:C.green, bar:C.amber, airfare:C.azureDeep, transport:C.azureDeep };
  const col = map[category] || C.slateLight;
  return <span style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", padding:"2px 9px", borderRadius:"20px", background:col+"22", color:col }}>{category}</span>;
}

function ConfBar({ val }) {
  const pct = Math.round(val * 100);
  const col = pct >= 90 ? C.green : pct >= 70 ? C.amber : C.red;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"7px" }}>
      <div style={{ flex:1, height:"4px", background:C.tide, borderRadius:"2px" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:col, borderRadius:"2px" }} />
      </div>
      <span style={{ fontSize:"10px", fontWeight:700, color:col, width:"30px" }}>{pct}%</span>
    </div>
  );
}


// ── Email Import ──────────────────────────────────────────────────────────────

function EmailImportModal({ onClose }) {
  const [phase, setPhase] = useState("connect");
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState([]);

  const startScan = () => {
    setPhase("scanning"); setProgress(0);
    const t = setInterval(() => setProgress(p => {
      if (p >= 100) { clearInterval(t); setPhase("review"); setItems(MOCK_EMAILS.map(x => ({ ...x, accepted:null }))); return 100; }
      return p + 3;
    }), 48);
  };

  const toggle   = (id, v) => setItems(is => is.map(i => i.id === id ? { ...i, accepted:v } : i));
  const acceptAll = () => setItems(is => is.map(i => ({ ...i, accepted:true })));
  const nAcc = items.filter(i => i.accepted === true).length;
  const catIcon  = { airfare:"✈️", hotel:"🏨", activity:"🎯", restaurant:"🍽️" };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.7)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:"28px 16px", overflowY:"hidden", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"740px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.22)`, border:`1px solid ${C.tide}` }}>

        <div style={{ padding:"22px 30px", borderBottom:`1px solid ${C.tide}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:C.seafoam }}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
            <span style={{ fontSize:"22px" }}>📧</span>
            <div>
              <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Email & Booking Import</div>
              <div style={{ fontSize:"11px", color:C.slateLight }}>Parses flight, hotel, restaurant & tour confirmations automatically</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
        </div>

        {phase === "connect" && (
          <div style={{ padding:"32px 28px", background:C.white }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px", marginBottom:"24px" }}>
              {[
                { icon:"📬", title:"Connect Gmail", desc:"Read-only OAuth. We scan for: confirmation, booking, reservation, itinerary.", input:true, btnLabel:"Connect & Scan" },
                { icon:"📮", title:"Forward Emails", desc:"No login needed. Forward booking confirmations to your personal import address.", addr:true, btnLabel:"Demo: Parse sample emails" },
              ].map((opt,i) => (
                <div key={i} style={{ background:C.seafoam, borderRadius:"14px", padding:"22px", border:`1px solid ${C.tide}` }}>
                  <div style={{ fontSize:"26px", marginBottom:"10px" }}>{opt.icon}</div>
                  <div style={{ fontSize:"14px", fontWeight:700, color:C.slate, marginBottom:"5px" }}>{opt.title}</div>
                  <div style={{ fontSize:"11px", color:C.slateLight, marginBottom:"14px", lineHeight:1.6 }}>{opt.desc}</div>
                  {opt.input && <input placeholder="your@gmail.com" style={{ width:"100%", padding:"8px 11px", borderRadius:"7px", border:`1px solid ${C.tide}`, background:C.white, color:C.slate, fontSize:"12px", outline:"none", boxSizing:"border-box", marginBottom:"9px" }} />}
                  {opt.addr && <div style={{ background:C.white, border:`1px solid ${C.tide}`, borderRadius:"7px", padding:"9px 11px", fontSize:"11px", color:C.azureDeep, fontFamily:"monospace", marginBottom:"9px", userSelect:"all" }}>import@parse.tripcopycat.com</div>}
                  <button onClick={startScan} style={{ width:"100%", padding:"9px", borderRadius:"8px", border:`1px solid ${C.azure}`, background:i===0?C.azure:C.white, color:i===0?C.white:C.azure, fontWeight:700, cursor:"pointer", fontSize:"12px" }}>{opt.btnLabel}</button>
                </div>
              ))}
            </div>
            <div style={{ background:C.seafoam, borderRadius:"10px", padding:"12px 16px", border:`1px solid ${C.tide}` }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:"7px" }}>Recognized sources</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                {["United Airlines","Delta","American","Booking.com","Marriott","Hilton","Airbnb","OpenTable","Resy","Viator","GetYourGuide","Amtrak","Eurostar"].map(s => (
                  <span key={s} style={{ fontSize:"11px", background:C.white, color:C.slateMid, padding:"2px 9px", borderRadius:"12px", border:`1px solid ${C.tide}` }}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {phase === "scanning" && (
          <div style={{ padding:"64px 32px", textAlign:"center", background:C.white }}>
            <div style={{ fontSize:"44px", marginBottom:"18px" }}>📧</div>
            <div style={{ fontSize:"17px", fontWeight:700, color:C.slate, marginBottom:"6px" }}>Scanning inbox…</div>
            <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"24px" }}>Parsing travel confirmation emails</div>
            <div style={{ maxWidth:"340px", margin:"0 auto" }}>
              <div style={{ height:"5px", background:C.seafoamDeep, borderRadius:"3px", overflow:"hidden" }}>
                <div style={{ height:"100%", background:`linear-gradient(90deg,${C.azure},${C.green})`, borderRadius:"3px", transition:"width .1s", width:`${progress}%` }} />
              </div>
              <div style={{ marginTop:"9px", fontSize:"12px", color:C.muted }}>Found {Math.floor(progress/17)} confirmations…</div>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div>
            <div style={{ padding:"12px 28px", background:C.seafoam, borderBottom:`1px solid ${C.tide}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:"12px", color:C.slateLight }}><strong style={{ color:C.slate }}>{items.length}</strong> confirmations detected · <strong style={{ color:C.green }}>{nAcc}</strong> accepted</div>
              <button className="tc-btn" onClick={acceptAll} style={{ padding:"5px 14px", borderRadius:"7px", border:"none", background:C.green, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>Accept All</button>
            </div>
            <div style={{ padding:"14px 22px", maxHeight:"400px", overflowY:"auto", WebkitOverflowScrolling:"touch", background:C.white }}>
              {items.map(item => (
                <div key={item.id} style={{ background:C.white, borderRadius:"11px", padding:"14px 16px", marginBottom:"9px", border:`1px solid ${item.accepted===true?C.green:item.accepted===false?C.red:C.tide}`, display:"flex", gap:"12px", alignItems:"center", boxShadow:`0 1px 4px rgba(44,62,80,0.06)` }}>
                  <div style={{ fontSize:"22px", flexShrink:0 }}>{catIcon[item.category]||"📄"}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:"10px", color:C.muted, marginBottom:"2px" }}>{item.source} · {item.subject}</div>
                    <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"4px" }}>{item.extracted}</div>
                    <div style={{ display:"flex", gap:"7px", alignItems:"center" }}>
                      <Pill category={item.category} />
                      <span style={{ fontSize:"10px", color:C.muted }}>{item.date}</span>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:"5px", flexShrink:0 }}>
                    <button onClick={() => toggle(item.id,true)} style={{ padding:"6px 12px", borderRadius:"7px", border:"none", cursor:"pointer", background:item.accepted===true?C.green:C.greenBg, color:item.accepted===true?C.white:C.green, fontWeight:700, fontSize:"12px" }}>✓</button>
                    <button onClick={() => toggle(item.id,false)} style={{ padding:"6px 12px", borderRadius:"7px", border:"none", cursor:"pointer", background:item.accepted===false?C.red:C.redBg, color:item.accepted===false?C.white:C.red, fontWeight:700, fontSize:"12px" }}>✗</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding:"14px 28px", borderTop:`1px solid ${C.tide}`, display:"flex", justifyContent:"space-between", background:C.seafoam }}>
              <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Cancel</button>
              <button onClick={onClose} style={{ padding:"9px 22px", borderRadius:"8px", border:"none", background:`linear-gradient(135deg,${C.azure},${C.azureDark})`, color:C.white, fontSize:"12px", fontWeight:700, cursor:"pointer" }}>Add {nAcc} items to Trip →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Smart Import Hub ──────────────────────────────────────────────────────────

function SmartImportHub({ onClose, onPhotoComplete }) {
  const [active, setActive] = useState(null);
  if (active === "photo") return <PhotoImportModal onClose={() => setActive(null)} onComplete={(data) => { onPhotoComplete && onPhotoComplete(data); onClose(); }} />;
  if (active === "email") return <EmailImportModal onClose={() => setActive(null)} />;

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.65)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)", padding:"20px" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"540px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.2)`, border:`1px solid ${C.tide}` }}>
        <div style={{ padding:"26px 30px", borderBottom:`1px solid ${C.tide}`, display:"flex", justifyContent:"space-between", alignItems:"flex-start", background:C.seafoam }}>
          <div>
            <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Smart Import</div>
            <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"3px" }}>Auto-build your itinerary from existing data</div>
          </div>
          <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
        </div>
        <div style={{ padding:"22px 26px", display:"flex", flexDirection:"column", gap:"12px", background:C.white }}>
          {[
            { id:"photo", icon:"📸", title:"Photo Album Import", desc:"AI reads GPS, timestamps & image content to rebuild your journey", badge:"Most Magical", bc:C.azure,
              bullets:["Upload photos → EXIF GPS → auto place names","Timestamps → day-by-day timeline","AI reads menus, signs, venue interiors","~80% auto-fill accuracy"] },
            { id:"email", icon:"📧", title:"Email & Bookings Import", desc:"Parse flight, hotel, restaurant & activity confirmations automatically", badge:"Most Accurate", bc:C.green,
              bullets:["Connect Gmail (read-only) or forward emails","Reads: airline, hotel, reservation dates, cost","~95% accuracy on structured bookings","Works with 40+ booking platforms"] },
          ].map(opt => (
            <button key={opt.id} onClick={() => setActive(opt.id)} style={{ textAlign:"left", padding:"18px 20px", borderRadius:"14px", border:`1px solid ${C.tide}`, background:C.seafoam, cursor:"pointer", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}
              className="tc-hover-border">
              <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"9px" }}>
                <span style={{ fontSize:"26px" }}>{opt.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:"14px", color:C.slate }}>{opt.title}</div>
                  <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>{opt.desc}</div>
                </div>
                <span style={{ fontSize:"10px", fontWeight:700, padding:"2px 9px", borderRadius:"20px", background:opt.bc+"22", color:opt.bc, flexShrink:0 }}>{opt.badge}</span>
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                {opt.bullets.map(b => <span key={b} style={{ fontSize:"10px", color:C.slateMid, background:C.white, padding:"2px 9px", borderRadius:"12px", border:`1px solid ${C.tide}` }}>{b}</span>)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function matchesDuration(trip, filter) {
  if (filter === "Any Length") return true;
  const n = parseInt(trip.duration) || 0;
  if (filter === "Weekend (1-3 days)") return n >= 1 && n <= 3;
  if (filter === "1 Week (4-7 days)") return n >= 4 && n <= 7;
  if (filter === "2 Weeks (8-14 days)") return n >= 8 && n <= 14;
  if (filter === "2+ Weeks (15+ days)") return n >= 15;
  return true;
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function useBookmarks() {
  const [bookmarks, setBookmarks] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tc_bookmarks") || "[]"); } catch { return []; }
  });
  const toggle = (id) => {
    setBookmarks(prev => {
      const next = prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id];
      localStorage.setItem("tc_bookmarks", JSON.stringify(next));
      return next;
    });
  };
  return { bookmarks, toggle };
}

// ── Export Modal ──────────────────────────────────────────────────────────────

function ExportModal({ trip, onClose }) {
  const [copied, setCopied] = useState(false);
  const text = buildPlainText(trip);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); });

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.7)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:"36px 16px", overflowY:"hidden", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"660px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.22)`, border:`1px solid ${C.tide}` }}>
        <div style={{ padding:"22px 26px", borderBottom:`1px solid ${C.tide}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:C.seafoam }}>
          <div>
            <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Export Itinerary</div>
            <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>Plain text · paste into Notes, iMessage, email, WhatsApp</div>
          </div>
          <div style={{ display:"flex", gap:"7px" }}>
            <button onClick={copy} style={{ padding:"8px 18px", borderRadius:"8px", border:"none", background:copied?C.green:C.azure, color:C.white, fontWeight:700, fontSize:"12px", cursor:"pointer", transition:"background .2s" }}>
              {copied ? "✓ Copied!" : "📋 Copy All"}
            </button>
            <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
          </div>
        </div>
        <pre style={{ margin:0, padding:"22px 26px", fontSize:"11.5px", lineHeight:1.95, color:C.slateMid, fontFamily:"'Fira Code','Courier New',monospace", maxHeight:"540px", overflowY:"auto", WebkitOverflowScrolling:"touch", whiteSpace:"pre-wrap", wordBreak:"break-word", background:C.seafoam }}>
          {text}
        </pre>
        <div style={{ padding:"10px 26px", borderTop:`1px solid ${C.tide}`, background:C.white }}>
          <span style={{ fontSize:"11px", color:C.muted }}>Format: Day N — Activity — Location — Note</span>
        </div>
      </div>
    </div>
  );
}

// ── Daily Itinerary ───────────────────────────────────────────────────────────

function DailyItinerary({ days }) {
  const [active, setActive] = useState(0);
  const d = days[active];
  return (
    <div>
      <div style={{ display:"flex", gap:"7px", overflowX:"auto", paddingBottom:"10px", marginBottom:"22px" }}>
        {days.map((day, i) => (
          <button key={i} onClick={() => setActive(i)} style={{ padding:"9px 15px", borderRadius:"10px", border:`1px solid ${active===i?C.slate:C.tide}`, cursor:"pointer", flexShrink:0, textAlign:"left", background:active===i?C.slate:C.white, color:active===i?C.white:C.slateLight, boxShadow:active===i?`0 4px 12px rgba(28,43,58,0.22)`:"none", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}>
            <div style={{ fontSize:"9px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", opacity:.75 }}>Day {day.day}</div>
            <div style={{ fontSize:"12px", fontWeight:700, marginTop:"2px" }}>{day.date}</div>
            <div style={{ fontSize:"10px", marginTop:"2px", opacity:.85 }}>{day.title}</div>
          </button>
        ))}
      </div>
      <div style={{ marginBottom:"18px" }}>
        <div style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.muted, marginBottom:"3px" }}>Day {d.day} · {d.date}</div>
        <div style={{ fontSize:"21px", fontWeight:700, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>{d.title}</div>
      </div>
      <div style={{ position:"relative" }}>
        <div style={{ position:"absolute", left:"68px", top:0, bottom:0, width:"1px", background:C.tide }} />
        {d.items.map((item, i) => {
          const ts = typeStyles[item.type] || typeStyles.activity;
          return (
            <div key={i} style={{ display:"flex", gap:"12px", marginBottom:"16px" }}>
              <div style={{ width:"56px", flexShrink:0, textAlign:"right", paddingTop:"8px" }}>
                <span style={{ fontSize:"10px", fontWeight:700, color:C.muted }}>{item.time}</span>
              </div>
              <div style={{ width:"26px", flexShrink:0, display:"flex", alignItems:"flex-start", paddingTop:"6px", justifyContent:"center", zIndex:1 }}>
                <div style={{ width:"26px", height:"26px", borderRadius:"50%", background:ts.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", boxShadow:`0 0 0 3px ${C.white}` }}>{ts.icon}</div>
              </div>
              <div style={{ flex:1, background:C.white, border:`1px solid ${C.tide}`, borderRadius:"10px", padding:"10px 14px", boxShadow:`0 1px 4px rgba(44,62,80,0.05)` }}>
                <span style={{ fontSize:"9px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:ts.color, background:ts.bg, padding:"2px 7px", borderRadius:"20px" }}>{item.type}</span>
                <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginTop:"4px" }}>{item.label}</div>
                {item.note && <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"3px", lineHeight:1.5, fontStyle:"italic" }}>{item.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Trip Modal ────────────────────────────────────────────────────────────────

function TripModal({ trip, onClose, allTrips, isBookmarked, onBookmark, isAdmin }) {
  const [view, setView] = useState("overview");
  const [tab, setTab] = useState("all");
  const [showExport, setShowExport] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [showRelated, setShowRelated] = useState(false);
  const [showBlueprintPreview, setShowBlueprintPreview] = useState(false);

  // Always include cover photo as first lightbox image (Option C)
  const coverEntry = trip.image ? [{ url: trip.image, caption: "Cover photo" }] : [];
  const galleryEntries = (trip.gallery || []).filter(g => g.url !== trip.image);
  const gallery = [...coverEntry, ...galleryEntries];

  // Related trips algorithm: prioritise same author, then matching tags, then same region
  const related = (allTrips || []).filter(t => t.id !== trip.id).map(t => {
    let score = 0;
    if (t.author === trip.author) score += 10;
    const sharedTags = (t.tags || []).filter(tag => (trip.tags || []).includes(tag)).length;
    score += sharedTags * 3;
    if (t.region === trip.region) score += 2;
    return { ...t, _score: score };
  }).filter(t => t._score > 0).sort((a, b) => b._score - a._score).slice(0, 6);

  const handleShare = () => {
    const url = `${window.location.origin}/trip/${trip.id}`;
    navigator.clipboard.writeText(url).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); });
    trackEvent("share_click", { trip_id: String(trip.id), title: trip.title });
  };

  const handleTwitterShare = () => {
    const url = `${window.location.origin}/trip/${trip.id}`;
    const text = `Check out this trip: ${trip.title} on TripCopycat`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
  };

  return (
    <>
      <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.6)", zIndex:1000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 16px", overflowY:"auto", WebkitOverflowScrolling:"touch", backdropFilter:"blur(6px)" }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"880px", boxShadow:`0 32px 64px rgba(44,62,80,0.2)`, border:`1px solid ${C.tide}`, overflow:"hidden", marginTop:"8px", marginBottom:"20px" }}>

          {/* header */}
          <div style={{ position:"relative", background:`linear-gradient(135deg,#2C1810 0%,#3D2B1F 100%)`, padding:"20px 20px 20px 30px", color:C.white, overflow:"hidden" }}>
            {trip.image && <img src={trip.image} alt={trip.title} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", objectPosition:`${trip.focalPoint?.x||50}% ${trip.focalPoint?.y||50}%`, opacity:0.35 }} />}
            <div style={{ position:"relative", zIndex:1, display:"flex", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:"10px", fontWeight:800, letterSpacing:"0.1em", color:"rgba(255,255,255,0.95)", textTransform:"uppercase", marginBottom:"7px", textShadow:"0 1px 4px rgba(0,0,0,0.5)" }}>{trip.region} · {trip.duration} · {trip.date}</div>
                <h2 style={{ margin:0, fontSize:"27px", fontWeight:700, fontFamily:"'Playfair Display',Georgia,serif", color:"#FFFFFF", textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>{trip.title}</h2>
                <div style={{ marginTop:"4px", fontSize:"14px", color:"rgba(255,255,255,0.95)", fontWeight:500, textShadow:"0 1px 4px rgba(0,0,0,0.5)" }}>{trip.destination}</div>
              </div>
              <div style={{ display:"flex", gap:"5px", flexWrap:"wrap", justifyContent:"flex-end", alignSelf:"flex-start" }}>
                  <button onClick={handleShare} onTouchEnd={e=>{e.preventDefault();handleShare();}} style={{ background:"rgba(196,168,130,0.2)", border:"1px solid rgba(196,168,130,0.4)", color:"#FAF7F2", borderRadius:"8px", padding:"5px 10px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation", whiteSpace:"nowrap" }}>{shareCopied ? "✓" : "🔗"}</button>
                  <button onClick={handleTwitterShare} onTouchEnd={e=>{e.preventDefault();handleTwitterShare();}} style={{ background:"rgba(196,168,130,0.2)", border:"1px solid rgba(196,168,130,0.4)", color:"#FAF7F2", borderRadius:"8px", padding:"5px 10px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation" }}>𝕏</button>
                  <button onClick={() => onBookmark && onBookmark(trip.id)} onTouchEnd={e=>{e.preventDefault(); onBookmark && onBookmark(trip.id);}} style={{ background:"rgba(196,168,130,0.2)", border:"1px solid rgba(196,168,130,0.4)", color:"#FAF7F2", borderRadius:"8px", padding:"5px 10px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation" }}>{isBookmarked ? "🔖" : "🏷️"}</button>
                  <button onClick={() => setShowExport(true)} onTouchEnd={e=>{e.preventDefault();setShowExport(true);}} style={{ background:"rgba(196,168,130,0.2)", border:"1px solid rgba(196,168,130,0.4)", color:"#FAF7F2", borderRadius:"8px", padding:"5px 10px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation" }}>📤</button>
                  {/* Blueprint purchase button — admin only until launch */}
                  {isAdmin && (() => {
                    const handleBlueprint = async () => {
                      try {
                        const res = await fetch("/api/create-checkout", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ tripId: trip.id, tripTitle: trip.title }),
                        });
                        const { url, error } = await res.json();
                        if (error) { alert("Could not start checkout: " + error); return; }
                        window.location.href = url;
                      } catch (e) {
                        alert("Checkout failed. Please try again.");
                      }
                    };
                    return (
                      <button onClick={handleBlueprint} onTouchEnd={e=>{e.preventDefault();handleBlueprint();}} style={{ background:"#FAF7F2", color:"#1C2B3A", border:"2px solid #C4A882", borderRadius:"6px", padding:"5px 12px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation", whiteSpace:"nowrap", display:"inline-flex", alignItems:"center", gap:"7px" }}>
                        <span style={{ display:"inline-block", transform:"rotate(-45deg)", fontSize:"13px", lineHeight:1, color:"#C4A882" }}>▲</span>
                        GET BLUEPRINT
                        <span style={{ background:"#1C2B3A", color:"#C4A882", fontSize:"9px", fontWeight:700, padding:"1px 6px", borderRadius:"20px", letterSpacing:"0.05em" }}>PREMIUM</span>
                        <span style={{ background:"#C4A882", color:"#1C2B3A", fontSize:"9px", fontWeight:700, padding:"1px 6px", borderRadius:"20px", letterSpacing:"0.05em" }}>$1.99</span>
                      </button>
                    );
                  })()}
                  {/* Admin-only Instagram post button */}
                  {isAdmin && (
                    <button onClick={e => { e.stopPropagation(); setShowBlueprintPreview(true); }} onTouchEnd={e=>{e.stopPropagation();e.preventDefault();setShowBlueprintPreview(true);}} style={{ background:"rgba(70,130,90,0.3)", border:"1px solid rgba(70,180,100,0.5)", color:"#FAF7F2", borderRadius:"8px", padding:"5px 10px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation", whiteSpace:"nowrap" }}>🗺 Preview</button>
                  )}
                  {isAdmin && (() => {
                    const handleGenPost = (e) => {
                      e.stopPropagation();
                      const rests = (trip.restaurants || []).slice(0,3).map(r => r.item).filter(Boolean);
                      const quote = (trip.loves || "").slice(0, 160);
                      const params = new URLSearchParams({
                        dest: trip.destination || "",
                        duration: `${trip.duration || ""}${trip.travelers ? " · " + trip.travelers : ""}`,
                        quote,
                        photo: trip.image || "",
                        r1: rests[0] || "",
                        r2: rests[1] || "",
                        r3: rests[2] || "",
                      });
                      const url = `/instagram-template.html?${params.toString()}`;
                      const a = document.createElement("a");
                      a.href = url;
                      a.target = "_blank";
                      a.rel = "noopener noreferrer";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    };
                    return (
                      <button onClick={handleGenPost} onTouchEnd={e=>{e.stopPropagation();e.preventDefault();handleGenPost(e);}} style={{ background:"rgba(193,105,42,0.3)", border:"1px solid rgba(193,105,42,0.6)", color:"#FAF7F2", borderRadius:"8px", padding:"5px 10px", cursor:"pointer", fontSize:"11px", fontWeight:700, touchAction:"manipulation", whiteSpace:"nowrap" }}>📸 Post</button>
                    );
                  })()}
                </div>
            </div>
            <div style={{ marginTop:"12px", display:"flex", gap:"10px", flexWrap:"wrap", alignItems:"center", position:"relative", zIndex:1 }}>
              <span style={{ fontSize:"12px", color:"rgba(255,255,255,0.95)", fontWeight:500, textShadow:"0 1px 3px rgba(0,0,0,0.4)" }}>by <strong onClick={() => { onClose(); setTimeout(() => window.__setViewingProfile && window.__setViewingProfile(trip.author), 200); }} style={{ cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted", color:"#C4A882" }}>{trip.author}</strong></span>
              <span style={{ fontSize:"12px", color:"rgba(255,255,255,0.95)", fontWeight:500, textShadow:"0 1px 3px rgba(0,0,0,0.4)" }}>{trip.travelers}</span>
              {trip.tags.map(t => <span key={t} style={{ fontSize:"10px", fontWeight:700, padding:"2px 9px", borderRadius:"20px", background:"rgba(0,0,0,0.3)", color:"#FFFFFF", border:"1px solid rgba(255,255,255,0.4)" }}>{t}</span>)}
            </div>
          </div>

          {/* tabs */}
          <div style={{ display:"flex", borderBottom:`1px solid ${C.tide}`, background:C.seafoam }}>
            {[{id:"overview",l:"Overview"},{id:"daily",l:"📅 Daily Itinerary"},{id:"details",l:"🗂️ All Details"}].map(t => (
              <button key={t.id} onClick={() => { setView(t.id); trackEvent("tab_click", { tab: t.id, trip_id: String(trip.id) }); }} style={{ padding:"12px 20px", fontSize:"13px", fontWeight:700, border:"none", cursor:"pointer", background:"transparent", color:view===t.id?C.azureDeep:C.muted, borderBottom:view===t.id?`2px solid ${C.amber}`:"2px solid transparent", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}>{t.l}</button>
            ))}
          </div>

          {/* Gallery strip */}
          {gallery.length > 0 && (
            <div style={{ padding:"12px 20px", borderBottom:`1px solid ${C.tide}`, background:C.white, display:"flex", gap:"8px", overflowX:"auto" }}>
              {gallery.map((g, idx) => (
                <div key={idx} onClick={() => setLightboxIdx(idx)} style={{ flexShrink:0, width:"80px", height:"60px", borderRadius:"6px", overflow:"hidden", cursor:"pointer", border:`1.5px solid ${C.tide}`, position:"relative" }}
                  className="tc-hover-border">
                  <img src={g.url} alt={g.caption||""} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
                </div>
              ))}
              <div style={{ flexShrink:0, display:"flex", alignItems:"center", paddingLeft:"4px" }}>
                <span style={{ fontSize:"10px", color:C.muted, fontWeight:600 }}>{gallery.length} photo{gallery.length!==1?"s":""}</span>
              </div>
            </div>
          )}

          {/* Lightbox */}
          {lightboxIdx !== null && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setLightboxIdx(null)}>
              <button onClick={e => { e.stopPropagation(); setLightboxIdx(i => Math.max(0, i-1)); }} style={{ position:"absolute", left:"20px", background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", borderRadius:"50%", width:"44px", height:"44px", fontSize:"20px", cursor:"pointer", display:lightboxIdx===0?"none":"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
              <div onClick={e => e.stopPropagation()} style={{ maxWidth:"90vw", maxHeight:"85vh", display:"flex", flexDirection:"column", alignItems:"center" }}>
                <img src={gallery[lightboxIdx]?.url} alt={gallery[lightboxIdx]?.caption||""} style={{ maxWidth:"100%", maxHeight:"75vh", objectFit:"contain", borderRadius:"8px" }} />
                {gallery[lightboxIdx]?.caption && <div style={{ color:"rgba(255,255,255,0.8)", fontSize:"13px", marginTop:"12px", textAlign:"center" }}>{gallery[lightboxIdx].caption}</div>}
                <div style={{ color:"rgba(255,255,255,0.4)", fontSize:"11px", marginTop:"8px" }}>{lightboxIdx+1} / {gallery.length}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); setLightboxIdx(i => Math.min(gallery.length-1, i+1)); }} style={{ position:"absolute", right:"20px", background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", borderRadius:"50%", width:"44px", height:"44px", fontSize:"20px", cursor:"pointer", display:lightboxIdx===gallery.length-1?"none":"flex", alignItems:"center", justifyContent:"center" }}>›</button>
              <button onClick={() => setLightboxIdx(null)} style={{ position:"absolute", top:"20px", right:"20px", background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", borderRadius:"50%", width:"36px", height:"36px", fontSize:"18px", cursor:"pointer" }}>×</button>
            </div>
          )}

          {view === "overview" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:`1px solid ${C.tide}` }}>
                <div style={{ padding:"20px 24px", borderRight:`1px solid ${C.tide}`, background:C.white }}>
                  <div style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:C.green, marginBottom:"8px" }}>❤️ What They Loved</div>
                  <p style={{ margin:0, fontSize:"13px", color:C.slate, lineHeight:1.75, fontWeight:500 }}>{trip.loves}</p>
                </div>
                <div style={{ padding:"20px 24px", background:C.white }}>
                  <div style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:C.amber, marginBottom:"8px" }}>🔄 Do Differently</div>
                  <p style={{ margin:0, fontSize:"13px", color:C.slate, lineHeight:1.75, fontWeight:500 }}>{trip.doNext}</p>
                </div>
              </div>
              <div style={{ padding:"20px 24px", background:C.white }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"9px", marginBottom:"18px" }}>
                  {Object.entries(catConfig).map(([key,cfg]) => {
                    const count = trip[key]?.length||0;
                    return (
                      <button key={key} onClick={() => { setView("details"); setTab(key); }} disabled={count===0}
                        style={{ textAlign:"center", padding:"12px 6px", background:count>0?C.seafoam:"#f8f8f6", borderRadius:"10px", border:`1px solid ${count>0?C.tide:"#eee"}`, cursor:count>0?"pointer":"default", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease", opacity:count>0?1:0.5 }}
                        onMouseEnter={e => { if(count>0) { e.currentTarget.style.background=C.amberBg; e.currentTarget.style.borderColor=C.amber; }}}
                        onMouseLeave={e => { e.currentTarget.style.background=count>0?C.seafoam:"#f8f8f6"; e.currentTarget.style.borderColor=count>0?C.tide:"#eee"; }}>
                        <div style={{ fontSize:"17px", marginBottom:"3px" }}>{cfg.label.split(" ")[0]}</div>
                        <div style={{ fontSize:"19px", fontWeight:800, color:cfg.color }}>{count}</div>
                        <div style={{ fontSize:"9px", color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{key}</div>
                        {count>0 && <div style={{ fontSize:"8px", color:C.amber, marginTop:"3px", fontWeight:700 }}>View →</div>}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setView("daily")} style={{ width:"100%", padding:"12px", background:C.cta, color:C.white, border:"none", borderRadius:"10px", fontSize:"13px", fontWeight:700, cursor:"pointer" }}>
                  📅 View Day-by-Day Itinerary →
                </button>
              </div>
            </div>
          )}

          {view === "daily" && (
            <div style={{ padding:"24px 28px", background:C.white }}>
              {trip.days?.length
                ? <DailyItinerary days={trip.days} />
                : <div style={{ textAlign:"center", padding:"56px 20px", color:C.muted }}><div style={{ fontSize:"34px", marginBottom:"12px" }}>📅</div><div style={{ fontWeight:600 }}>No daily itinerary yet</div></div>
              }
            </div>
          )}

          {view === "details" && (
            <div style={{ padding:"16px 24px", background:C.white }}>
              {Object.entries(catConfig).map(([key,cfg]) => {
                if (!trip[key]?.length) return null;
                const isOpen = tab === key || tab === "all";
                return (
                  <div key={key} style={{ marginBottom:"8px", borderRadius:"10px", border:`1px solid ${isOpen ? cfg.color+"44" : C.tide}`, overflow:"hidden", transition:"transform .18s ease, box-shadow .18s ease, border-color .18s ease" }}>
                    <button onClick={() => setTab(isOpen && tab !== "all" ? "all" : key)}
                      style={{ width:"100%", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", background:isOpen ? cfg.color+"11" : C.white, border:"none", cursor:"pointer", textAlign:"left" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                        <span style={{ fontSize:"16px" }}>{cfg.label.split(" ")[0]}</span>
                        <span style={{ fontSize:"13px", fontWeight:700, color:cfg.color }}>{cfg.label.split(" ").slice(1).join(" ")}</span>
                        <span style={{ fontSize:"11px", background:cfg.color+"22", color:cfg.color, borderRadius:"20px", padding:"1px 8px", fontWeight:700 }}>{trip[key].length}</span>
                      </div>
                      <span style={{ fontSize:"12px", color:C.muted, transition:"transform .2s", display:"inline-block", transform:isOpen?"rotate(180deg)":"rotate(0deg)" }}>▾</span>
                    </button>
                    {isOpen && (
                      <div style={{ borderTop:`1px solid ${cfg.color+"22"}` }}>
                        {trip[key].map((it, i) => (
                          <div key={i} style={{ padding:"12px 16px", borderBottom:i < trip[key].length-1 ? `1px solid ${C.seafoamDeep}` : "none", display:"grid", gridTemplateColumns:"1fr auto", gap:"8px" }}>
                            <div>
                              <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"2px" }}>{it.item}</div>
                              {it.detail && <div style={{ fontSize:"11px", color:C.slateMid, marginBottom:"3px" }}>{it.detail}</div>}
                              {it.tip && <div style={{ fontSize:"11px", color:C.amber, fontStyle:"italic" }}>💡 {it.tip}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Related trips — collapsed by default */}
      {related.length > 0 && (
        <div style={{ borderTop:`1px solid ${C.tide}`, background:C.seafoam }}>
          <button
            onClick={() => setShowRelated(p => !p)}
            style={{ width:"100%", padding:"14px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
              <span style={{ fontSize:"11px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>You Might Also Like</span>
              <span style={{ fontSize:"10px", background:C.tide, color:C.slateLight, borderRadius:"20px", padding:"2px 8px", fontWeight:600 }}>{related.length}</span>
            </div>
            <span style={{ fontSize:"18px", color:C.muted, lineHeight:1 }}>{showRelated ? "−" : "+"}</span>
          </button>
          {showRelated && (
            <div style={{ padding:"0 28px 20px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(min(180px,100%),1fr))", gap:"10px" }}>
                {related.map(t => {
                  const grad = REGION_GRADIENTS[t.region] || "linear-gradient(135deg,#8B7355,#C4A882)";
                  const isSameAuthor = t.author === trip.author;
                  return (
                    <div key={t.id} onClick={() => { window.__openTrip && window.__openTrip(t); }}
                      style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, overflow:"hidden", cursor:"pointer", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}
                      className="tc-hover-border">
                      <div style={{ height:"65px", background:t.image?"transparent":grad, position:"relative", overflow:"hidden" }}>
                        {t.image && <img src={t.image} alt={t.title} style={{ width:"100%", height:"100%", objectFit:"cover" }} />}
                        {t.image && <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.2)" }} />}
                        {isSameAuthor && <div style={{ position:"absolute", top:"5px", left:"6px", background:"rgba(196,168,130,0.9)", borderRadius:"20px", padding:"2px 7px", fontSize:"9px", color:"#fff", fontWeight:700 }}>Same author</div>}
                      </div>
                      <div style={{ padding:"8px 10px" }}>
                        <div style={{ fontSize:"11px", fontWeight:700, color:C.slate, lineHeight:1.3, marginBottom:"2px" }}>{t.title}</div>
                        <div style={{ fontSize:"10px", color:C.muted }}>{t.destination} · {t.duration}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {showBlueprintPreview && (
        <div style={{ position:"fixed", inset:0, zIndex:3000, overflowY:"auto" }}>
          <BlueprintPage tripId={trip.id} onClose={() => setShowBlueprintPreview(false)} />
          <div style={{ position:"fixed", top:"16px", right:"16px", zIndex:4000 }}>
            <button onClick={() => setShowBlueprintPreview(false)} style={{ background:"rgba(28,43,58,0.9)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:"8px", padding:"8px 16px", fontSize:"12px", fontWeight:700, cursor:"pointer" }}>✕ Close Preview</button>
          </div>
        </div>
      )}
      {showExport && <ExportModal trip={trip} onClose={() => setShowExport(false)} />}
      {/* X button fixed at viewport level — completely outside scroll container so iOS can never intercept */}
      <button
        onClick={onClose}
        onTouchStart={e => { e.stopPropagation(); }}
        onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onClose(); }}
        style={{ position:"fixed", top:"16px", right:"16px", zIndex:1100, background:"rgba(0,0,0,0.6)", border:"2px solid rgba(255,255,255,0.6)", color:"#fff", borderRadius:"50%", width:"48px", height:"48px", cursor:"pointer", fontSize:"24px", touchAction:"manipulation", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1, WebkitTapHighlightColor:"transparent" }}>×</button>
    </>
  );
}


// ── Region gradient map for card image placeholders ──────────────────────────

// ── Trip Card ─────────────────────────────────────────────────────────────────

function TripCard({ trip, onClick, isBookmarked, onBookmark }) {
  const grad = REGION_GRADIENTS[trip.region] || "linear-gradient(135deg,#8B7355,#C4A882)";
  const emoji = REGION_EMOJI[trip.region] || "🌍";
  return (
    <div onClick={() => onClick(trip)} className="tc-card" style={{ background:C.white, border:`${trip.featured?"2px solid #C4A882":"1px solid "+C.tide}`, borderRadius:"16px", overflow:"hidden", cursor:"pointer", transition:"transform .18s ease, box-shadow .18s ease, border-color .18s ease", boxShadow:trip.featured?`0 4px 20px rgba(196,168,130,0.25)`:`0 2px 12px rgba(44,62,80,0.07)` }}>
      {/* Image / placeholder */}
      <div style={{ height:"148px", background:trip.image ? "transparent" : grad, position:"relative", display:"flex", alignItems:"flex-end", padding:"14px", overflow:"hidden" }}>
        {trip.image
          ? <img src={trip.image} alt={trip.title} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", objectPosition:`${trip.focalPoint?.x||50}% ${trip.focalPoint?.y||50}%` }} />
          : <span style={{ fontSize:"42px", position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-60%)", opacity:0.35 }}>{emoji}</span>
        }
        {trip.image && <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.1) 60%)" }} />}
        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ fontSize:"9px", fontWeight:700, letterSpacing:"0.1em", color:"rgba(255,255,255,0.8)", textTransform:"uppercase", marginBottom:"3px" }}>{trip.region}</div>
          <div style={{ fontSize:"16px", fontWeight:700, color:"#FFFFFF", fontFamily:"'Playfair Display',Georgia,serif", lineHeight:1.2, textShadow:"0 1px 4px rgba(0,0,0,0.3)" }}>{trip.title}</div>
        </div>
        <div style={{ position:"absolute", top:"12px", right:"12px", background:"rgba(0,0,0,0.25)", borderRadius:"20px", padding:"3px 10px", fontSize:"10px", color:"rgba(255,255,255,0.9)", fontWeight:600 }}>{trip.duration}</div>
        {trip.featured && <div style={{ position:"absolute", top:"12px", left:"44px", background:"linear-gradient(135deg,#C4A882,#A8896A)", borderRadius:"20px", padding:"3px 10px", fontSize:"10px", color:"#fff", fontWeight:700, display:"flex", alignItems:"center", gap:"4px" }}>✦ Featured</div>}
        {/* Bookmark button */}
        <button onClick={e => { e.stopPropagation(); onBookmark && onBookmark(trip.id); }} style={{ position:"absolute", top:"10px", left:"12px", background:"rgba(0,0,0,0.3)", border:"none", borderRadius:"50%", width:"28px", height:"28px", cursor:"pointer", fontSize:"14px", display:"flex", alignItems:"center", justifyContent:"center", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}
          title={isBookmarked ? "Remove bookmark" : "Bookmark this trip"}>
          {isBookmarked ? "🔖" : "🏷️"}
        </button>
      </div>
      {/* Card body */}
      <div style={{ padding:"16px 18px" }}>
        <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"9px" }}>{trip.destination}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", marginBottom:"10px" }}>
          {trip.tags.map(t => <span key={t} style={{ fontSize:"10px", fontWeight:600, padding:"2px 8px", borderRadius:"20px", background:C.seafoam, color:C.slateMid, border:`1px solid ${C.tide}` }}>{t}</span>)}
        </div>
        <div style={{ fontSize:"12px", color:C.slateMid, lineHeight:1.65, marginBottom:"12px" }}>
          <span style={{ fontWeight:700, color:C.green }}>❤️ </span>{trip.loves.substring(0,100)}…
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:`1px solid ${C.seafoamDeep}`, paddingTop:"10px" }}>
          <div style={{ fontSize:"11px", color:C.muted }}>by <strong onClick={e => { e.stopPropagation(); if (window.__closeTripModal) window.__closeTripModal(); setTimeout(() => window.__setViewingProfile && window.__setViewingProfile(trip.author), window.__closeTripModal ? 200 : 0); }} style={{ color:C.amber, cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted" }}>{trip.author}</strong> · {trip.date}</div>
          <div style={{ fontSize:"11px", color:C.slateMid, fontWeight:600 }}>{trip.travelers}</div>
        </div>
      </div>
    </div>
  );
}

// ── Add Trip Modal ────────────────────────────────────────────────────────────

function AddTripModal({ onClose, onAdd }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: "", destination: "", region: "Europe", duration: "", travelers: "",
    date: "", tags: [], loves: "", doNext: "",
    airfare: [{item:"",detail:"",tip:""}], hotels: [{item:"",detail:"",tip:""}],
    restaurants: [{item:"",detail:"",tip:""}], bars: [{item:"",detail:"",tip:""}],
    activities: [{item:"",detail:"",tip:""}], days: []
  });

  const updRow   = (cat,i,f,v) => setForm(p => { const u=[...p[cat]]; u[i]={...u[i],[f]:v}; return {...p,[cat]:u}; });
  const addRow   = cat => setForm(p => ({...p,[cat]:[...p[cat],{item:"",detail:"",tip:""}]}));
  const toggleTag = tag => setForm(p => { if (!p.tags.includes(tag) && p.tags.length >= 8) return p; return {...p, tags: p.tags.includes(tag) ? p.tags.filter(t=>t!==tag) : [...p.tags, tag]}; });
  const inp = { width:"100%", padding:"8px 11px", borderRadius:"7px", border:`1px solid ${C.tide}`, fontSize:"12px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate };
  const lbl = { fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.65)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:"36px 16px", overflowY:"hidden", backdropFilter:"blur(6px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"680px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.2)`, border:`1px solid ${C.tide}` }}>
        {/* header */}
        <div style={{ background:C.cta, padding:"24px 30px", color:C.white, display:"flex", justifyContent:"space-between" }}>
          <div>
            <div style={{ display:"flex", gap:"7px", marginBottom:"9px", alignItems:"center" }}>
              {["Overview","Feedback","Details"].map((s,i) => (<span key={s} style={{ display:"flex", alignItems:"center", gap:"5px" }}>
                <span style={{ width:"19px", height:"19px", borderRadius:"50%", background:step-1===i?C.white:"rgba(255,255,255,.25)", color:step-1===i?C.azureDark:C.white, fontSize:"10px", fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>{i+1}</span>
                <span style={{ fontSize:"10px", opacity:step-1===i?1:0.55, fontWeight:step-1===i?700:400 }}>{s}</span>
                {i<2&&<span style={{ opacity:.35, fontSize:"10px" }}>›</span>}
              </span>))}
            </div>
            <h2 style={{ margin:0, fontSize:"19px", fontFamily:"'Playfair Display',Georgia,serif", fontWeight:700 }}>
              {["Overview","Feedback","Details"][step-1]}
            </h2>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.2)", border:"none", color:C.white, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
        </div>

        <div style={{ padding:"24px 30px", background:C.white }}>
          {step === 1 && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
              <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Trip Title</label><input style={inp} placeholder="e.g. Tokyo Family Adventure" value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} /></div>
              <div><label style={lbl}>Destination</label><input style={inp} placeholder="e.g. Tokyo, Japan" value={form.destination} onChange={e=>setForm(p=>({...p,destination:e.target.value}))} /></div>
              <div><label style={lbl}>Region</label><select style={inp} value={form.region} onChange={e=>setForm(p=>({...p,region:e.target.value}))}>{REGIONS.filter(r=>r!=="All Regions").map(r=><option key={r}>{r}</option>)}</select></div>
              <div><label style={lbl}>Duration</label><input style={inp} placeholder="e.g. 10 days" value={form.duration} onChange={e=>setForm(p=>({...p,duration:e.target.value}))} /></div>
              <div><label style={lbl}>Date</label><input style={inp} placeholder="e.g. March 2024" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} /></div>
              <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Who Traveled</label><input style={inp} placeholder="e.g. Family (2 kids)" value={form.travelers} onChange={e=>setForm(p=>({...p,travelers:e.target.value}))} /></div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>Tags</label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", marginTop:"4px" }}>
                  {TAGS.filter(t=>t!=="All").map(tag=><button key={tag} onClick={()=>toggleTag(tag)} style={{ padding:"3px 11px", borderRadius:"20px", fontSize:"11px", fontWeight:600, cursor:"pointer", border:`1px solid ${form.tags.includes(tag)?C.azure:C.tide}`, background:form.tags.includes(tag)?C.azure:C.white, color:form.tags.includes(tag)?C.white:C.slateLight }}>{tag}</button>)}
                </div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
              <div><label style={{...lbl,color:C.green}}>❤️ What did you love?</label><textarea style={{...inp,height:"90px",resize:"vertical"}} value={form.loves} onChange={e=>setForm(p=>({...p,loves:e.target.value}))} /></div>
              <div><label style={{...lbl,color:C.amber}}>🔄 What would you do differently?</label><textarea style={{...inp,height:"90px",resize:"vertical"}} value={form.doNext} onChange={e=>setForm(p=>({...p,doNext:e.target.value}))} /></div>
            </div>
          )}
          {step === 3 && (
            <div>
              {Object.entries(catConfig).map(([key,cfg]) => (
                <div key={key} style={{ marginBottom:"18px" }}>
                  <div style={{ fontWeight:700, fontSize:"12px", marginBottom:"6px", display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ width:"7px", height:"7px", borderRadius:"50%", background:cfg.color, display:"inline-block" }} />{cfg.label}
                  </div>
                  {form[key].map((row,i) => (
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px", marginBottom:"6px" }}>
                      <input style={inp} placeholder="Name" value={row.item} onChange={e=>updRow(key,i,"item",e.target.value)} />
                      <input style={inp} placeholder="Details / Cost" value={row.detail} onChange={e=>updRow(key,i,"detail",e.target.value)} />
                      <input style={inp} placeholder="Insider tip" value={row.tip} onChange={e=>updRow(key,i,"tip",e.target.value)} />
                    </div>
                  ))}
                  <button onClick={()=>addRow(key)} style={{ fontSize:"11px", color:cfg.color, background:"none", border:`1px dashed ${cfg.color}`, padding:"3px 10px", borderRadius:"5px", cursor:"pointer", fontWeight:600 }}>+ Add row</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding:"12px 30px 24px", display:"flex", justifyContent:"space-between", background:C.seafoam, borderTop:`1px solid ${C.tide}` }}>
          <button onClick={()=>step>1?setStep(s=>s-1):onClose()} style={{ padding:"8px 18px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>{step>1?"← Back":"Cancel"}</button>
          <button onClick={()=>step<3?setStep(s=>s+1):(onAdd({...form,id:Date.now(),author:"You"}),onClose())} style={{ padding:"8px 18px", borderRadius:"8px", border:"none", background:C.cta, color:C.white, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>
            {step<3?"Next →":"✓ Publish Itinerary"}
          </button>
        </div>
      </div>
    </div>
  );
}



// ── Admin Queue Modal ─────────────────────────────────────────────────────────
function AdminQueueModal({ onClose, onApprove }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [previewTripId, setPreviewTripId] = useState(null);
  const [queueTab, setQueueTab] = useState("pending");

  useEffect(() => {
    supabase.from("submissions").select("*").order("submitted_at", { ascending: false })
      .then(({ data }) => { setSubmissions(data || []); setLoading(false); });
  }, []);

  const approve = async (sub) => {
    const t = sub.trip_data;
    const { data: inserted } = await supabase.from("trips").insert([{
      title:t.title, destination:t.destination, region:t.region,
      author_name:sub.submitter_name, author_email:sub.submitter_email,
      date:t.date, duration:t.duration, travelers:t.travelers,
      tags:t.tags||[], loves:t.loves, do_next:t.do_next||t.doNext||"",
      airfare:t.airfare||[], hotels:t.hotels||[], restaurants:t.restaurants||[],
      bars:t.bars||[], activities:t.activities||[], days:t.days||[],
      image:t.image??null, status:"published", user_id:sub.user_id||null, focal_point:t.focalPoint||{x:50,y:50}, gallery:t.gallery||[]
    }]).select("id");
    // Fire-and-forget geocoding — never blocks approval, errors are silent
    const newTripId = inserted?.[0]?.id;
    if (newTripId) {
      fetch("/api/geocode-venues", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-geocode-secret": import.meta.env.VITE_GEOCODE_SECRET || "" },
        body: JSON.stringify({ tripId: newTripId }),
      }).catch(() => {});
    }
    await supabase.from("submissions").update({ status:"approved", reviewed_at:new Date().toISOString(), approved_trip_id:newTripId||null }).eq("id",sub.id);
    setSubmissions(p => p.map(s => s.id===sub.id ? {...s,status:"approved"} : s));
    if (onApprove) onApprove();
    setDetail(null);
  };

  const reject = async (sub) => {
    await supabase.from("submissions").update({ status:"rejected", reviewed_at:new Date().toISOString() }).eq("id",sub.id);
    setSubmissions(p => p.map(s => s.id===sub.id ? {...s,status:"rejected"} : s));
    setDetail(null);
  };

  const statusCol = { pending:C.amber, flagged:C.red, approved:C.green, rejected:C.muted };
  const [regeocoding, setRegeocoding] = useState(false);
  const [regeocodeStatus, setRegeocodeStatus] = useState("");

  const regeocodeAll = async () => {
    setRegeocoding(true);
    setRegeocodeStatus("Fetching trips…");
    const { data: trips } = await supabase.from("trips").select("id, title").eq("status", "published");
    if (!trips?.length) { setRegeocodeStatus("No trips found."); setRegeocoding(false); return; }
    let done = 0;
    for (const t of trips) {
      setRegeocodeStatus(`Geocoding ${done + 1}/${trips.length}: ${t.title}`);
      await fetch("/api/geocode-venues", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-geocode-secret": import.meta.env.VITE_GEOCODE_SECRET || "" },
        body: JSON.stringify({ tripId: t.id }),
      }).catch(() => {});
      done++;
    }
    setRegeocodeStatus(`Done — ${done} trips geocoded.`);
    setRegeocoding(false);
  };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:4000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"28px 16px", overflowY:"auto", WebkitOverflowScrolling:"touch", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"800px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.22)`, border:`1px solid ${C.tide}` }}>
        <div style={{ padding:"20px 28px", borderBottom:`1px solid ${C.tide}`, background:C.seafoam, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Submission Queue</div>
            <div style={{ fontSize:"11px", color:C.slateLight, marginTop:"2px" }}>{submissions.filter(s=>s.status==="flagged"||s.status==="pending").length} awaiting review</div>
            {regeocodeStatus && <div style={{ fontSize:"10px", color:C.amber, marginTop:"4px", fontWeight:600 }}>{regeocodeStatus}</div>}
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            <button onClick={regeocodeAll} disabled={regeocoding} style={{ padding:"6px 12px", borderRadius:"7px", border:`1px solid ${C.amber}`, background:C.amberBg, color:C.amber, fontSize:"11px", fontWeight:700, cursor:regeocoding?"not-allowed":"pointer" }}>{regeocoding ? "Geocoding…" : "🗺 Regeocode All"}</button>
            <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>x</button>
          </div>
        </div>
        <div style={{ display:"flex", borderBottom:`1px solid ${C.tide}`, background:C.white, padding:"0 22px" }}>
          {[["pending","Needs Review"],["completed","Completed"]].map(([tab, label]) => {
            const count = tab === "pending"
              ? submissions.filter(s => s.status === "pending" || s.status === "flagged").length
              : submissions.filter(s => s.status === "approved" || s.status === "rejected").length;
            return (
              <button key={tab} onClick={() => setQueueTab(tab)} style={{ padding:"12px 18px", fontSize:"12px", fontWeight:queueTab===tab?700:400, border:"none", background:"transparent", cursor:"pointer", color:queueTab===tab?C.slate:C.muted, borderBottom:queueTab===tab?`2px solid ${C.amber}`:"2px solid transparent", fontFamily:"inherit", display:"flex", alignItems:"center", gap:"6px" }}>
                {label}
                <span style={{ background:queueTab===tab?C.amber:C.tide, color:queueTab===tab?"#fff":C.muted, fontSize:"10px", fontWeight:700, padding:"1px 7px", borderRadius:"20px" }}>{count}</span>
              </button>
            );
          })}
        </div>
        <div style={{ padding:"16px 22px", maxHeight:"60vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
          {loading && <div style={{ textAlign:"center", padding:"40px", color:C.muted }}>Loading…</div>}
          {!loading && submissions.filter(s => queueTab === "pending" ? (s.status === "pending" || s.status === "flagged") : (s.status === "approved" || s.status === "rejected")).length === 0 && (
            <div style={{ textAlign:"center", padding:"40px", color:C.muted }}>
              <div style={{ fontSize:"32px", marginBottom:"10px" }}>{queueTab === "pending" ? "✅" : "💭"}</div>
              <div>{queueTab === "pending" ? "All caught up — nothing pending review" : "No completed submissions yet"}</div>
            </div>
          )}
          {submissions.filter(s => queueTab === "pending" ? (s.status === "pending" || s.status === "flagged") : (s.status === "approved" || s.status === "rejected")).map(sub => (
            <div key={sub.id} style={{ background:C.white, border:`1px solid ${sub.status==="flagged"?C.red:C.tide}`, borderRadius:"12px", padding:"14px 16px", marginBottom:"10px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"6px" }}>
                <div>
                  <div style={{ fontSize:"14px", fontWeight:700, color:C.slate }}>{sub.trip_data?.title||"Untitled"}</div>
                  <div style={{ fontSize:"11px", color:C.slateLight }}>{sub.trip_data?.destination} - {sub.submitter_name} - {sub.submitter_email}</div>
                  <div style={{ fontSize:"10px", color:C.muted }}>{new Date(sub.submitted_at).toLocaleDateString()}</div>
                </div>
                <span style={{ fontSize:"10px", fontWeight:700, padding:"3px 10px", borderRadius:"20px", background:(statusCol[sub.status]||C.muted)+"22", color:statusCol[sub.status]||C.muted, textTransform:"uppercase", flexShrink:0 }}>{sub.status}</span>
              </div>
              {sub.ai_flag_reason && (
                <div style={{ background:C.amberBg, borderRadius:"6px", padding:"7px 10px", marginBottom:"8px", fontSize:"11px", color:C.slateMid }}>
                  Flagged: {sub.ai_flag_reason}
                </div>
              )}
              {(sub.status==="flagged"||sub.status==="pending") && (
                <div style={{ display:"flex", gap:"7px" }}>
                  <button onClick={() => setDetail(sub)} style={{ padding:"6px 12px", borderRadius:"7px", border:`1px solid ${C.tide}`, background:C.seafoam, color:C.slateMid, fontSize:"11px", fontWeight:600, cursor:"pointer" }}>View</button>
                  <button onClick={() => approve(sub)} style={{ padding:"6px 12px", borderRadius:"7px", border:"none", background:C.green, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>Approve</button>
                  <button onClick={() => reject(sub)} style={{ padding:"6px 12px", borderRadius:"7px", border:"none", background:C.red, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>Reject</button>
                </div>
              )}
              {sub.status==="approved" && sub.approved_trip_id && (
                <div style={{ display:"flex", gap:"7px", marginTop:"6px" }}>
                  <button onClick={() => setPreviewTripId(sub.approved_trip_id)} style={{ padding:"6px 12px", borderRadius:"7px", border:`1px solid ${C.amber}`, background:C.amberBg, color:C.amber, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>🗺 Preview Blueprint</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {detail && (() => {
        // Map submission trip_data to TripModal-compatible shape
        const previewTrip = {
          ...detail.trip_data,
          id: detail.id,
          author: detail.submitter_name,
          doNext: detail.trip_data?.doNext || detail.trip_data?.do_next || "",
          focalPoint: detail.trip_data?.focalPoint || { x:50, y:50 },
          gallery: detail.trip_data?.gallery || [],
          tags: detail.trip_data?.tags || [],
          featured: false,
        };
        return (
          <div style={{ position:"fixed", inset:0, zIndex:5000 }}>
            <TripModal
              trip={previewTrip}
              onClose={() => setDetail(null)}
              allTrips={[]}
              isBookmarked={false}
              onBookmark={null}
            />
            {/* Admin action bar pinned above the fixed X button */}
            <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:6000, background:"rgba(28,43,58,0.97)", padding:"14px 20px", display:"flex", gap:"10px", justifyContent:"center", alignItems:"center", borderTop:"2px solid rgba(255,255,255,0.1)" }}>
              <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.6)", marginRight:"8px" }}>Admin Review — {detail.submitter_name}</div>
              <button onClick={() => approve(detail)} style={{ padding:"10px 28px", borderRadius:"8px", border:"none", background:C.green, color:C.white, fontWeight:700, fontSize:"13px", cursor:"pointer" }}>✓ Approve</button>
              <button onClick={() => reject(detail)} style={{ padding:"10px 28px", borderRadius:"8px", border:"none", background:C.red, color:C.white, fontWeight:700, fontSize:"13px", cursor:"pointer" }}>✕ Reject</button>
              <button onClick={() => setDetail(null)} style={{ padding:"10px 18px", borderRadius:"8px", border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"rgba(255,255,255,0.7)", fontSize:"12px", cursor:"pointer" }}>Cancel</button>
            </div>
          </div>
        );
      })()}
      {previewTripId && (
        <div style={{ position:"fixed", inset:0, zIndex:6000, overflowY:"auto" }}>
          <BlueprintPage tripId={previewTripId} onClose={() => setPreviewTripId(null)} />
          <div style={{ position:"fixed", top:"16px", right:"16px", zIndex:7000 }}>
            <button onClick={() => setPreviewTripId(null)} style={{ background:"rgba(28,43,58,0.9)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:"8px", padding:"8px 16px", fontSize:"12px", fontWeight:700, cursor:"pointer" }}>✕ Close Preview</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Auth & Profile Components ─────────────────────────────────────────────────

// ── Auth Modal (Login / Register) ─────────────────────────────────────────────

// ── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ onClose }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const inp = { width:"100%", padding:"10px 13px", borderRadius:"8px", border:`1px solid ${C.tide}`, fontSize:"13px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate, marginBottom:"10px" };

  const handleReset = async () => {
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true); setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) { setError(updateError.message); return; }
    setDone(true);
  };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)", padding:"20px" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"400px", overflow:"hidden", boxShadow:`0 32px 64px rgba(28,43,58,0.25)`, border:`1px solid ${C.tide}` }}>
        <div style={{ padding:"24px 28px", borderBottom:`1px solid ${C.tide}`, background:C.seafoam, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Set New Password</div>
          <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
        </div>
        <div style={{ padding:"24px 28px" }}>
          {done ? (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:"36px", marginBottom:"12px" }}>✅</div>
              <div style={{ fontSize:"14px", fontWeight:700, color:C.slate, marginBottom:"8px" }}>Password updated!</div>
              <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"20px" }}>You can now sign in with your new password.</div>
              <button className="tc-btn" onClick={onClose} style={{ width:"100%", padding:"12px", borderRadius:"10px", border:"none", background:C.cta, color:C.ctaText, fontWeight:700, fontSize:"14px", cursor:"pointer" }}>Done</button>
            </div>
          ) : (
            <div>
              <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" }}>New Password</label>
              <input style={inp} type="password" placeholder="At least 6 characters" value={password} onChange={e=>setPassword(e.target.value)} />
              <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" }}>Confirm Password</label>
              <input style={inp} type="password" placeholder="Repeat your new password" value={confirm} onChange={e=>setConfirm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleReset()} />
              {error && <div style={{ fontSize:"12px", color:C.red, background:C.redBg, padding:"8px 12px", borderRadius:"7px", marginBottom:"10px" }}>{error}</div>}
              <button onClick={handleReset} disabled={loading} style={{ width:"100%", padding:"12px", borderRadius:"10px", border:"none", background:loading?C.tide:C.cta, color:loading?C.muted:C.ctaText, fontWeight:700, fontSize:"14px", cursor:loading?"not-allowed":"pointer", fontFamily:"'Nunito',sans-serif" }}>
                {loading ? "Updating…" : "Set New Password"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState("login"); // login | register | forgot | reset-sent
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inp = { width:"100%", padding:"10px 13px", borderRadius:"8px", border:`1px solid ${C.tide}`, fontSize:"13px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate, marginBottom:"10px" };

  const handleRegister = async () => {
    if (!displayName.trim()) { setError("Please enter a display name."); return; }
    if (!email.trim()) { setError("Please enter your email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true); setError("");
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }
    if (data.user) {
      await supabase.from("profiles").insert([{
        id: data.user.id,
        display_name: displayName.trim(),
        email: email.trim(),
        created_at: new Date().toISOString()
      }]);
    }
    setLoading(false);
    trackEvent("sign_up");
    onSuccess({ user: data.user, displayName: displayName.trim() });
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError("Please enter email and password."); return; }
    setLoading(true); setError("");
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) { setError(loginError.message); setLoading(false); return; }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
    setLoading(false);
    onSuccess({ user: data.user, displayName: profile?.display_name || email });
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setError("Please enter your email address."); return; }
    setLoading(true); setError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://tripcopycat.com/reset-password"
    });
    setLoading(false);
    if (resetError) { setError(resetError.message); return; }
    setMode("reset-sent");
  };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)", padding:"20px" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"400px", overflow:"hidden", boxShadow:`0 32px 64px rgba(28,43,58,0.25)`, border:`1px solid ${C.tide}` }}>
        <div style={{ padding:"24px 28px", borderBottom:`1px solid ${C.tide}`, background:C.seafoam, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>
            {mode === "login" ? "Welcome Back" : mode === "register" ? "Create Account" : mode === "forgot" ? "Reset Password" : "Check Your Email"}
          </div>
          <button onClick={onClose} style={{ background:C.seafoamDeep, border:"none", color:C.slateLight, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
        </div>
        <div style={{ padding:"24px 28px" }}>

          {/* reset-sent confirmation */}
          {mode === "reset-sent" && (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:"36px", marginBottom:"12px" }}>📧</div>
              <div style={{ fontSize:"14px", fontWeight:700, color:C.slate, marginBottom:"8px" }}>Reset link sent!</div>
              <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.6, marginBottom:"20px" }}>Check your email at <strong>{email}</strong> for a link to reset your password.</div>
              <button className="tc-btn" onClick={onClose} style={{ width:"100%", padding:"12px", borderRadius:"10px", border:"none", background:C.cta, color:C.ctaText, fontWeight:700, fontSize:"14px", cursor:"pointer" }}>Done</button>
            </div>
          )}

          {/* forgot password form */}
          {mode === "forgot" && (
            <div>
              <div style={{ fontSize:"12px", color:C.slateLight, marginBottom:"16px", lineHeight:1.6 }}>Enter your email and we'll send you a link to reset your password.</div>
              <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" }}>Email</label>
              <input style={inp} type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleForgotPassword()} />
              {error && <div style={{ fontSize:"12px", color:C.red, background:C.redBg, padding:"8px 12px", borderRadius:"7px", marginBottom:"10px" }}>{error}</div>}
              <button onClick={handleForgotPassword} disabled={loading} style={{ width:"100%", padding:"12px", borderRadius:"10px", border:"none", background:loading?C.tide:C.cta, color:loading?C.muted:C.ctaText, fontWeight:700, fontSize:"14px", cursor:loading?"not-allowed":"pointer", fontFamily:"'Nunito',sans-serif" }}>
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
              <div style={{ textAlign:"center", marginTop:"14px" }}>
                <button onClick={() => { setMode("login"); setError(""); }} style={{ background:"none", border:"none", color:C.amber, fontWeight:700, cursor:"pointer", fontSize:"12px" }}>← Back to Sign In</button>
              </div>
            </div>
          )}

          {/* login / register */}
          {(mode === "login" || mode === "register") && (
            <div>
              <div style={{ display:"flex", background:C.seafoam, borderRadius:"10px", padding:"3px", marginBottom:"20px" }}>
                {[["login","Sign In"],["register","Create Account"]].map(([m,l]) => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ flex:1, padding:"8px", borderRadius:"8px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:700, background:mode===m?C.white:"transparent", color:mode===m?C.slate:C.muted, boxShadow:mode===m?`0 1px 4px rgba(28,43,58,0.1)`:"none", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}>{l}</button>
                ))}
              </div>
              {mode === "register" && (
                <div>
                  <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" }}>Display Name</label>
                  <input style={inp} placeholder="How you'll appear on your trips" value={displayName} onChange={e=>setDisplayName(e.target.value)} />
                </div>
              )}
              <div>
                <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" }}>Email</label>
                <input style={inp} type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" }}>Password</label>
                <input style={inp} type="password" placeholder={mode==="register"?"At least 6 characters":"Your password"} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(mode==="login"?handleLogin():handleRegister())} />
              </div>
              {error && <div style={{ fontSize:"12px", color:C.red, background:C.redBg, padding:"8px 12px", borderRadius:"7px", marginBottom:"10px" }}>{error}</div>}
              <button onClick={mode==="login"?handleLogin:handleRegister} disabled={loading} style={{ width:"100%", padding:"12px", borderRadius:"10px", border:"none", background:loading?C.tide:C.cta, color:loading?C.muted:C.ctaText, fontWeight:700, fontSize:"14px", cursor:loading?"not-allowed":"pointer", fontFamily:"'Nunito',sans-serif", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}>
                {loading ? "Please wait…" : mode==="login" ? "Sign In" : "Create Account"}
              </button>
              {mode === "login" && (
                <div style={{ textAlign:"center", marginTop:"10px" }}>
                  <button onClick={() => { setMode("forgot"); setError(""); }} style={{ background:"none", border:"none", color:C.muted, fontWeight:600, cursor:"pointer", fontSize:"12px" }}>Forgot your password?</button>
                </div>
              )}
              <div style={{ textAlign:"center", marginTop:"10px", fontSize:"12px", color:C.muted }}>
                {mode==="login" ? "Don't have an account? " : "Already have an account? "}
                <button onClick={() => { setMode(mode==="login"?"register":"login"); setError(""); }} style={{ background:"none", border:"none", color:C.amber, fontWeight:700, cursor:"pointer", fontSize:"12px" }}>
                  {mode==="login" ? "Create one" : "Sign in"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Profile Page ──────────────────────────────────────────────────────────────
function ProfilePage({ authorName, allTrips, onClose, onTripClick, currentUser, onEditTrip, onDeleteTrip }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const contributorTrips = allTrips.filter(t =>
    (t.author || "").toLowerCase() === authorName.toLowerCase()
  );

  const isOwnProfile = currentUser && contributorTrips.some(t => t.userId === currentUser.id);

  useEffect(() => {
    supabase.from("profiles").select("*")
      .ilike("display_name", authorName)
      .maybeSingle()
      .then(({ data }) => { setProfile(data); setLoading(false); });
  }, [authorName]);

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month:"long", year:"numeric" })
    : null;

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.7)", zIndex:2000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"28px 16px", overflowY:"auto", WebkitOverflowScrolling:"touch", backdropFilter:"blur(6px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"880px", overflow:"hidden", boxShadow:`0 32px 64px rgba(28,43,58,0.2)`, border:`1px solid ${C.tide}` }}>

        {/* Profile header */}
        <div style={{ background:`linear-gradient(135deg,#2C1810 0%,#3D2B1F 100%)`, padding:"36px 32px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"18px" }}>
              {/* Avatar */}
              <div style={{ width:"64px", height:"64px", borderRadius:"50%", background:"rgba(196,168,130,0.3)", border:"2px solid rgba(196,168,130,0.5)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"26px", fontWeight:800, color:"#FAF7F2", fontFamily:"'Playfair Display',serif", flexShrink:0 }}>
                {authorName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize:"24px", fontWeight:700, color:"#FAF7F2", fontFamily:"'Playfair Display',Georgia,serif", marginBottom:"4px" }}>
                  {authorName}
                  {profile?.featured_contributor && <span style={{ marginLeft:"8px", fontSize:"13px", background:"linear-gradient(135deg,#C4A882,#A8896A)", borderRadius:"20px", padding:"2px 10px", fontWeight:700, fontFamily:"'Nunito',sans-serif" }}>✦ Featured</span>}
                </div>
                {profile?.bio && <div style={{ fontSize:"13px", color:"rgba(250,247,242,0.8)", marginBottom:"6px", lineHeight:1.5 }}>{profile.bio}</div>}
                <div style={{ display:"flex", gap:"16px", flexWrap:"wrap" }}>
                  <span style={{ fontSize:"12px", color:"rgba(196,168,130,0.9)" }}>🗺️ {contributorTrips.length} itinerary{contributorTrips.length!==1?"s":""}</span>
                  {memberSince && <span style={{ fontSize:"12px", color:"rgba(196,168,130,0.9)" }}>📅 Member since {memberSince}</span>}
                </div>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"8px", flexShrink:0 }}>
              <button onClick={e => { e.stopPropagation(); onClose(); }} style={{ background:"rgba(196,168,130,0.2)", border:"none", color:"#FAF7F2", borderRadius:"50%", width:"40px", height:"40px", cursor:"pointer", fontSize:"20px", touchAction:"manipulation", flexShrink:0 }}>×</button>
              {currentUser && isOwnProfile && (
                <button onClick={() => { supabase.auth.signOut(); onClose(); }} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"rgba(250,247,242,0.7)", borderRadius:"6px", padding:"4px 10px", fontSize:"11px", cursor:"pointer" }}>Sign out</button>
              )}
            </div>
          </div>
        </div>

        {/* Trips grid */}
        <div style={{ padding:"24px 28px" }}>
          <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"16px", fontFamily:"'Playfair Display',serif" }}>
            Itineraries by {authorName}
          </div>
          {contributorTrips.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px", color:C.muted }}>
              <div style={{ fontSize:"32px", marginBottom:"10px" }}>✈️</div>
              <div style={{ fontWeight:600 }}>No published trips yet</div>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:"14px" }}>
              {contributorTrips.map(trip => (
                <div key={trip.id} style={{ position:"relative" }}>
                  <div onClick={() => { onTripClick(trip); onClose(); }}
                    style={{ background:C.white, border:`1px solid ${C.tide}`, borderRadius:"14px", padding:"18px", cursor:"pointer", transition:"transform .18s ease, box-shadow .18s ease, border-color .18s ease", boxShadow:`0 1px 4px rgba(28,43,58,0.05)` }}
                    className="tc-lift">
                    <div style={{ fontSize:"10px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"4px" }}>{trip.region}</div>
                    <div style={{ fontSize:"15px", fontWeight:700, color:C.slate, fontFamily:"'Playfair Display',serif", marginBottom:"4px", lineHeight:1.2 }}>{trip.title}</div>
                    <div style={{ fontSize:"11px", color:C.slateLight, marginBottom:"8px" }}>{trip.destination} · {trip.duration}</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"4px", marginBottom:"8px" }}>
                      {(trip.tags||[]).slice(0,3).map(t => <span key={t} style={{ fontSize:"10px", padding:"2px 8px", borderRadius:"20px", background:C.seafoam, color:C.slateMid, border:`1px solid ${C.tide}` }}>{t}</span>)}
                    </div>
                    <div style={{ fontSize:"11px", color:C.slateMid, lineHeight:1.5 }}>
                      <span style={{ color:C.green, fontWeight:700 }}>❤️ </span>{(trip.loves||"").substring(0,80)}…
                    </div>
                  </div>
                  {(isOwnProfile && trip.userId === currentUser?.id) && (
                    <div style={{ position:"absolute", top:"10px", right:"10px", display:"flex", gap:"5px" }}>
                      <button onClick={e => { e.stopPropagation(); onEditTrip && onEditTrip(trip); }} style={{ padding:"4px 10px", borderRadius:"6px", border:"none", background:C.azure, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>✏️ Edit</button>
                      <button onClick={e => { e.stopPropagation(); onDeleteTrip && onDeleteTrip(trip); }} style={{ padding:"4px 10px", borderRadius:"6px", border:"none", background:C.red, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>🗑️</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Admin Config ──────────────────────────────────────────────────────────────
// To add more admins, add their password to this array

// ── Admin Login Modal ─────────────────────────────────────────────────────────
function AdminLoginModal({ onSuccess, onClose }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  const attempt = () => {
    if (ADMIN_PASSWORDS.includes(pw)) { onSuccess(); }
    else { setError(true); setTimeout(() => setError(false), 2000); setPw(""); }
  };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", padding:"40px 36px", width:"100%", maxWidth:"400px", boxShadow:`0 32px 64px rgba(44,62,80,0.25)`, border:`1px solid ${C.tide}` }}>
        <div style={{ textAlign:"center", marginBottom:"28px" }}>
          <div style={{ fontSize:"36px", marginBottom:"12px" }}>🔐</div>
          <div style={{ fontSize:"20px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif" }}>Admin Access</div>
          <div style={{ fontSize:"12px", color:C.slateLight, marginTop:"4px" }}>TripCopycat Admin Panel</div>
        </div>
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === "Enter" && attempt()}
          placeholder="Enter admin password"
          style={{ width:"100%", padding:"11px 14px", borderRadius:"10px", border:`2px solid ${error?C.red:C.tide}`, fontSize:"14px", outline:"none", boxSizing:"border-box", marginBottom:"12px", background:error?C.redBg:C.white, color:C.slate, transition:"transform .18s ease, box-shadow .18s ease, border-color .18s ease" }}
        />
        {error && <div style={{ fontSize:"12px", color:C.red, textAlign:"center", marginBottom:"10px", fontWeight:600 }}>Incorrect password — try again</div>}
        <button className="tc-btn" onClick={attempt} style={{ width:"100%", padding:"11px", borderRadius:"10px", border:"none", background:C.cta, color:C.white, fontSize:"14px", fontWeight:700, cursor:"pointer", marginBottom:"10px" }}>
          Enter Admin Panel
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:"9px", borderRadius:"10px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"13px", fontWeight:600, cursor:"pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Admin Edit Trip Modal ─────────────────────────────────────────────────────
function AdminEditModal({ trip, onSave, onClose }) {
  const [form, setForm] = useState(JSON.parse(JSON.stringify(trip)));
  const focalDragging = useRef(false);
  const focalPreviewRef = useRef();
  const editGalleryRef = useRef();
  const [editGalleryUploading, setEditGalleryUploading] = useState(false);
  const [editGalleryError, setEditGalleryError] = useState("");
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);
  const [saving, setSaving] = useState(false);

  const updField = (f, v) => setForm(p => ({ ...p, [f]: v }));
  const updRow   = (cat, i, f, v) => setForm(p => { const u = [...p[cat]]; u[i] = { ...u[i], [f]: v }; return { ...p, [cat]: u }; });
  const addRow   = cat => setForm(p => ({ ...p, [cat]: [...p[cat], { item:"", detail:"", tip:"" }] }));
  const delRow   = (cat, i) => setForm(p => ({ ...p, [cat]: p[cat].filter((_,idx) => idx !== i) }));
  const updDay   = (di, f, v) => setForm(p => { const d=[...p.days]; d[di]={...d[di],[f]:v}; return {...p,days:d}; });
  const updDayItem = (di, ii, f, v) => setForm(p => { const d=[...p.days]; const its=[...d[di].items]; its[ii]={...its[ii],[f]:v}; d[di]={...d[di],items:its}; return {...p,days:d}; });
  const addDayItem = di => setForm(p => { const d=[...p.days]; d[di]={...d[di],items:[...d[di].items,{time:"",type:"activity",label:"",note:""}]}; return {...p,days:d}; });
  const delDayItem = (di, ii) => setForm(p => { const d=[...p.days]; d[di]={...d[di],items:d[di].items.filter((_,idx)=>idx!==ii)}; return {...p,days:d}; });

  const handleEditGalleryAdd = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const allowed = ["image/jpeg","image/png","image/webp","image/heic","image/heif"];
    const valid = files.filter(f => allowed.includes(f.type) && f.size <= 5*1024*1024);
    if (valid.length < files.length) setEditGalleryError("Some files skipped (unsupported type or over 5MB).");
    else setEditGalleryError("");
    const remaining = 5 - (form.gallery||[]).length;
    const toAdd = valid.slice(0, remaining);
    if (!toAdd.length) return;
    setEditGalleryUploading(true);
    const uploaded = [];
    for (const gf of toAdd) {
      const canvas = document.createElement("canvas");
      const img = new Image();
      const url = URL.createObjectURL(gf);
      await new Promise(res => {
        img.onload = () => {
          const s = Math.min(1, 1200 / Math.max(img.width, img.height));
          canvas.width = Math.round(img.width * s);
          canvas.height = Math.round(img.height * s);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(async (blob) => {
            URL.revokeObjectURL(url);
            const path = `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
            const { error } = await supabase.storage.from("trip-photos").upload(path, blob, { contentType:"image/jpeg", upsert:false });
            if (!error) {
              const { data } = supabase.storage.from("trip-photos").getPublicUrl(path);
              uploaded.push({ url: data.publicUrl, caption:"" });
            }
            res();
          }, "image/jpeg", 0.78);
        };
        img.src = url;
      });
    }
    setForm(p => ({ ...p, gallery: [...(p.gallery||[]), ...uploaded] }));
    setEditGalleryUploading(false);
    e.target.value = "";
  };

  const inp  = { width:"100%", padding:"7px 10px", borderRadius:"7px", border:`1px solid ${C.tide}`, fontSize:"12px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate };
  const lbl  = { fontSize:"11px", fontWeight:600, color:C.slateMid, marginBottom:"3px", display:"block" };
  const sect = { fontSize:"13px", fontWeight:800, color:C.slate, borderBottom:`2px solid ${C.tide}`, paddingBottom:"6px", marginBottom:"14px", marginTop:"22px" };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px", overflowY:"hidden", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"780px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.25)`, border:`1px solid ${C.tide}` }}>

        {/* header */}
        <div style={{ background:C.cta, padding:"20px 28px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"11px", fontWeight:700, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.1em" }}>Admin — Editing</div>
            <div style={{ fontSize:"18px", fontWeight:800, color:C.white, fontFamily:"'Playfair Display',Georgia,serif", marginTop:"2px" }}>{form.title}</div>
          </div>
          <div style={{ display:"flex", gap:"8px" }}>
            <button onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} disabled={saving} style={{ padding:"8px 20px", borderRadius:"8px", border:"none", background:saving?"#ddd":C.white, color:C.azureDark, fontSize:"12px", fontWeight:800, cursor:saving?"not-allowed":"pointer" }}>{saving ? "⏳ Saving…" : "✓ Save"}</button>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", color:C.white, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"17px" }}>×</button>
          </div>
        </div>

        <div style={{ padding:"24px 28px", overflowY:"auto", WebkitOverflowScrolling:"touch", maxHeight:"76vh" }}>

          {/* basics */}
          <div style={sect}>Trip Overview</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"12px" }}>
            <div><label style={lbl}>Title</label><input style={inp} value={form.title} onChange={e=>updField("title",e.target.value)} /></div>
            <div><label style={lbl}>Destination</label><input style={inp} value={form.destination} onChange={e=>updField("destination",e.target.value)} /></div>
            <div><label style={lbl}>Region</label><select style={inp} value={form.region} onChange={e=>updField("region",e.target.value)}>{REGIONS.filter(r=>r!=="All Regions").map(r=><option key={r}>{r}</option>)}</select></div>
            <div><label style={lbl}>Duration</label><input style={inp} value={form.duration} onChange={e=>updField("duration",e.target.value)} /></div>
            <div><label style={lbl}>Date</label><input style={inp} value={form.date} onChange={e=>updField("date",e.target.value)} /></div>
            <div><label style={lbl}>Travelers</label><input style={inp} value={form.travelers} onChange={e=>updField("travelers",e.target.value)} /></div>
            <div><label style={lbl}>Author</label><input style={inp} value={form.author} onChange={e=>updField("author",e.target.value)} /></div>
            <div style={{ gridColumn:"1/-1" }}>
              <label style={lbl}>🖼️ Cover Image URL <span style={{ fontWeight:400, color:C.muted }}>(e.g. /victoria-street.jpg or full https:// URL — leave blank for gradient)</span></label>
              <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                <input style={{...inp, flex:1}} value={form.image||""} onChange={e=>updField("image",e.target.value)} placeholder="/your-photo.jpg or https://..." />
                <label style={{ padding:"7px 12px", borderRadius:"7px", border:`1px solid ${C.amber}`, background:C.amberBg, color:C.slate, fontSize:"11px", fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
                  📤 Upload Photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display:"none" }} onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const scale = Math.min(1, 1200 / 1200);
                    const canvas = document.createElement("canvas");
                    const img = new Image();
                    img.onload = async () => {
                      const s = Math.min(1, 1200 / img.width);
                      canvas.width = Math.round(img.width * s);
                      canvas.height = Math.round(img.height * s);
                      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                      canvas.toBlob(async (blob) => {
                        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
                        const { error } = await supabase.storage.from("trip-photos").upload(path, blob, { contentType:"image/jpeg", upsert:false });
                        if (!error) {
                          const { data } = supabase.storage.from("trip-photos").getPublicUrl(path);
                          updField("image", data.publicUrl);
                        }
                      }, "image/jpeg", 0.82);
                    };
                    img.src = URL.createObjectURL(file);
                    e.target.value = "";
                  }} />
                </label>
              </div>
            </div>
            <div style={{ gridColumn:"1/-1" }}>
              <label style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer" }}>
                <input type="checkbox" checked={form.featured||false} onChange={e=>updField("featured",e.target.checked)} style={{ width:"16px", height:"16px", accentColor:C.amber }} />
                <span style={{ fontSize:"12px", fontWeight:700, color:C.amber }}>✦ Mark as Featured Itinerary</span>
                <span style={{ fontSize:"11px", color:C.muted }}>(appears in Featured section at top of page)</span>
              </label>
            </div>
          </div>
          {form.image && (
            <div style={{ marginBottom:"14px" }}>
              <div style={{ fontSize:"10px", color:C.muted, marginBottom:"4px", fontWeight:600 }}>Drag to reposition focal point</div>
              <div
                ref={focalPreviewRef}
                style={{ width:"100%", height:"160px", borderRadius:"10px", border:`1px solid ${C.tide}`, position:"relative", overflow:"hidden", cursor:"crosshair" }}
                onMouseDown={e => {
                  focalDragging.current = true;
                  const r = focalPreviewRef.current.getBoundingClientRect();
                  const x = Math.round(((e.clientX - r.left) / r.width) * 100);
                  const y = Math.round(((e.clientY - r.top) / r.height) * 100);
                  updField("focalPoint", { x, y });
                }}
                onMouseMove={e => {
                  if (!focalDragging.current) return;
                  const r = focalPreviewRef.current.getBoundingClientRect();
                  const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
                  const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
                  updField("focalPoint", { x, y });
                }}
                onMouseUp={() => { focalDragging.current = false; }}
                onMouseLeave={() => { focalDragging.current = false; }}
                onTouchStart={e => {
                  focalDragging.current = true;
                  const r = focalPreviewRef.current.getBoundingClientRect();
                  const t = e.touches[0];
                  updField("focalPoint", { x: Math.round(((t.clientX - r.left) / r.width) * 100), y: Math.round(((t.clientY - r.top) / r.height) * 100) });
                }}
                onTouchMove={e => {
                  if (!focalDragging.current) return;
                  const r = focalPreviewRef.current.getBoundingClientRect();
                  const t = e.touches[0];
                  updField("focalPoint", { x: Math.round(Math.min(100, Math.max(0, ((t.clientX - r.left) / r.width) * 100))), y: Math.round(Math.min(100, Math.max(0, ((t.clientY - r.top) / r.height) * 100))) });
                }}
                onTouchEnd={() => { focalDragging.current = false; }}
              >
                <img src={form.image} alt="Cover preview" style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:`${form.focalPoint?.x||50}% ${form.focalPoint?.y||50}%`, display:"block", pointerEvents:"none" }} onError={e=>e.target.style.display="none"} />
                <div style={{ position:"absolute", left:`${form.focalPoint?.x||50}%`, top:`${form.focalPoint?.y||50}%`, transform:"translate(-50%,-50%)", pointerEvents:"none" }}>
                  <div style={{ width:"28px", height:"28px", borderRadius:"50%", border:"2px solid #fff", boxShadow:"0 0 0 1px rgba(0,0,0,0.4)" }} />
                  <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:"4px", height:"4px", borderRadius:"50%", background:"#fff" }} />
                </div>
              </div>
            </div>
          )}
          <div style={{ marginBottom:"12px" }}>
            <label style={{...lbl,color:C.green}}>❤️ What They Loved</label>
            <textarea style={{...inp,minHeight:"100px",height:"auto",resize:"vertical"}} value={form.loves} onChange={e=>{ updField("loves",e.target.value); e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} onFocus={e=>{ e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} rows={4} />
          </div>
          <div>
            <label style={{...lbl,color:C.amber}}>🔄 Do Differently</label>
            <textarea style={{...inp,minHeight:"100px",height:"auto",resize:"vertical"}} value={form.doNext} onChange={e=>{ updField("doNext",e.target.value); e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} onFocus={e=>{ e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} rows={4} />
          </div>

          {/* categories */}
          {Object.entries(catConfig).map(([key,cfg]) => (
            <div key={key}>
              <div style={sect}>{cfg.label}</div>
              {form[key]?.map((row,i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:"6px", marginBottom:"7px", alignItems:"center" }}>
                  <input style={inp} placeholder="Name" value={row.item} onChange={e=>updRow(key,i,"item",e.target.value)} />
                  <input style={inp} placeholder="Details" value={row.detail} onChange={e=>updRow(key,i,"detail",e.target.value)} />
                  <textarea style={{...inp,minHeight:"36px",height:"auto",resize:"none",overflow:"hidden"}} placeholder="Tip" value={row.tip} onChange={e=>{ updRow(key,i,"tip",e.target.value); e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} onFocus={e=>{ e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} rows={1} />
                  <button onClick={()=>delRow(key,i)} style={{ padding:"6px 10px", borderRadius:"6px", border:`1px solid ${C.red}`, background:C.redBg, color:C.red, cursor:"pointer", fontSize:"13px", fontWeight:700, flexShrink:0 }}>✕</button>
                </div>
              ))}
              <button onClick={()=>addRow(key)} style={{ fontSize:"11px", color:cfg.color, background:"none", border:`1px dashed ${cfg.color}`, padding:"3px 10px", borderRadius:"5px", cursor:"pointer", fontWeight:600 }}>+ Add row</button>
            </div>
          ))}

          {/* gallery */}
          <div style={sect}>🖼️ Photo Gallery</div>
          <div style={{ marginBottom:"16px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"10px", flexWrap:"wrap", gap:"8px" }}>
              <div style={{ fontSize:"11px", color:C.muted }}>{(form.gallery||[]).length} photo{(form.gallery||[]).length!==1?"s":""} · max 5</div>
              <label style={{ padding:"7px 14px", borderRadius:"7px", border:`1px solid ${C.azure}`, background:"rgba(91,143,185,0.08)", color:C.azureDeep, fontSize:"11px", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:"6px", opacity: editGalleryUploading ? 0.6 : 1 }}>
                {editGalleryUploading ? "⏳ Uploading…" : "📤 Add Photos"}
                <input ref={editGalleryRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" style={{ display:"none" }} onChange={handleEditGalleryAdd} disabled={editGalleryUploading} />
              </label>
            </div>
            {editGalleryError && <div style={{ fontSize:"11px", color:C.red, marginBottom:"8px" }}>{editGalleryError}</div>}
            {(form.gallery||[]).length > 0 ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(100px, 1fr))", gap:"8px" }}>
                {(form.gallery||[]).map((g, idx) => (
                  <div key={idx}
                    draggable
                    onDragStart={() => { dragIdx.current = idx; }}
                    onDragOver={e => { e.preventDefault(); dragOverIdx.current = idx; }}
                    onDrop={() => {
                      const fromI = dragIdx.current;
                      const toI = dragOverIdx.current;
                      if (fromI === null || toI === null || fromI === toI) return;
                      setForm(p => {
                        const g2 = [...p.gallery];
                        g2.splice(toI, 0, g2.splice(fromI, 1)[0]);
                        return { ...p, gallery: g2 };
                      });
                      dragIdx.current = null;
                      dragOverIdx.current = null;
                    }}
                    onDragEnd={() => { dragIdx.current = null; dragOverIdx.current = null; }}
                    style={{ position:"relative", borderRadius:"8px", overflow:"hidden", border:`1px solid ${C.tide}`, aspectRatio:"1", cursor:"grab" }}>
                    <div style={{ position:"absolute", top:"4px", left:"4px", fontSize:"10px", color:"rgba(255,255,255,0.7)", zIndex:2, pointerEvents:"none" }}>⠿</div>
                    <img src={g.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block", pointerEvents:"none" }} />
                    <button
                      onClick={() => setForm(p => ({ ...p, gallery: p.gallery.filter((_,i)=>i!==idx) }))}
                      style={{ position:"absolute", top:"4px", right:"4px", background:"rgba(0,0,0,0.55)", border:"none", color:"#fff", borderRadius:"50%", width:"22px", height:"22px", fontSize:"13px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1, zIndex:2 }}>×</button>
                    <input
                      value={g.caption||""}
                      onChange={e => setForm(p => { const g2=[...p.gallery]; g2[idx]={...g2[idx],caption:e.target.value}; return {...p,gallery:g2}; })}
                      placeholder="Caption…"
                      style={{ position:"absolute", bottom:0, left:0, right:0, background:"rgba(0,0,0,0.55)", border:"none", color:"#fff", fontSize:"9px", padding:"3px 6px", fontFamily:"inherit", outline:"none", zIndex:2 }} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign:"center", padding:"24px 16px", background:C.seafoam, borderRadius:"10px", border:`1px dashed ${C.tide}` }}>
                <div style={{ fontSize:"24px", marginBottom:"6px" }}>📷</div>
                <div style={{ fontSize:"12px", color:C.muted }}>No gallery photos yet — tap Add Photos to upload</div>
              </div>
            )}
          </div>

          {/* daily itinerary */}
          <div style={sect}>📅 Daily Itinerary</div>
          {form.days?.map((day, di) => (
            <div key={di} style={{ background:C.seafoam, borderRadius:"12px", padding:"14px 16px", marginBottom:"14px", border:`1px solid ${C.tide}` }}>
              <div style={{ display:"grid", gridTemplateColumns:"auto 1fr 1fr", gap:"8px", marginBottom:"12px", alignItems:"center" }}>
                <div style={{ fontSize:"12px", fontWeight:800, color:C.azure, minWidth:"40px" }}>Day {day.day}</div>
                <input style={inp} placeholder="Date (e.g. Mar 12)" value={day.date} onChange={e=>updDay(di,"date",e.target.value)} />
                <input style={inp} placeholder="Day title" value={day.title} onChange={e=>updDay(di,"title",e.target.value)} />
              </div>
              {day.items.map((item, ii) => (
                <div key={ii} style={{ display:"grid", gridTemplateColumns:"80px 90px 1fr 1fr auto", gap:"5px", marginBottom:"6px", alignItems:"center" }}>
                  <input style={{...inp,fontSize:"11px"}} placeholder="Time" value={item.time} onChange={e=>updDayItem(di,ii,"time",e.target.value)} />
                  <select style={{...inp,fontSize:"11px"}} value={item.type} onChange={e=>updDayItem(di,ii,"type",e.target.value)}>
                    {["hotel","restaurant","bar","activity","transport"].map(t=><option key={t}>{t}</option>)}
                  </select>
                  <input style={{...inp,fontSize:"11px"}} placeholder="Label" value={item.label} onChange={e=>updDayItem(di,ii,"label",e.target.value)} />
                  <textarea style={{...inp,fontSize:"11px",minHeight:"32px",height:"auto",resize:"none",overflow:"hidden"}} placeholder="Note" value={item.note} onChange={e=>{ updDayItem(di,ii,"note",e.target.value); e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} onFocus={e=>{ e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }} rows={1} />
                  <button onClick={()=>delDayItem(di,ii)} style={{ padding:"5px 8px", borderRadius:"5px", border:`1px solid ${C.red}`, background:C.redBg, color:C.red, cursor:"pointer", fontSize:"11px" }}>✕</button>
                </div>
              ))}
              <button onClick={()=>addDayItem(di)} style={{ fontSize:"11px", color:C.azureDeep, background:"none", border:`1px dashed ${C.azure}`, padding:"3px 10px", borderRadius:"5px", cursor:"pointer", fontWeight:600 }}>+ Add item</button>
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="tc-modal-footer" style={{ padding:"16px 28px", borderTop:`1px solid ${C.tide}`, background:C.seafoam, display:"flex", justifyContent:"space-between" }}>
          <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Cancel</button>
          <button onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} disabled={saving} style={{ padding:"9px 24px", borderRadius:"8px", border:"none", background:saving?"#aaa":C.cta, color:C.ctaText, fontSize:"12px", fontWeight:700, cursor:saving?"not-allowed":"pointer" }}>{saving ? "⏳ Saving…" : "✓ Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Feedback Modal ────────────────────────────────────────────────────────────


// ── Analytics Dashboard ───────────────────────────────────────────────────────
function AnalyticsDashboard({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(7); // days

  useEffect(() => {
    const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString();
    supabase.from("analytics_events")
      .select("event_type, event_data, session_id, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .then(({ data: rows }) => {
        if (!rows) { setLoading(false); return; }

        // Sessions = unique session IDs
        const sessions = new Set(rows.map(r => r.session_id)).size;

        // Page views
        const pageViews = rows.filter(r => r.event_type === "page_view").length;

        // Trip views
        const tripViews = rows.filter(r => r.event_type === "trip_view");

        // Most viewed trips
        const tripCounts = {};
        tripViews.forEach(r => {
          const title = r.event_data?.title || r.event_data?.trip_id || "Unknown";
          tripCounts[title] = (tripCounts[title] || 0) + 1;
        });
        const topTrips = Object.entries(tripCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([title, count]) => ({ title: title.length > 28 ? title.slice(0, 28) + "…" : title, count }));

        // Shares
        const shares = rows.filter(r => r.event_type === "share_click").length;

        // Tab clicks
        const tabCounts = { overview: 0, daily: 0, details: 0 };
        rows.filter(r => r.event_type === "tab_click").forEach(r => {
          const tab = r.event_data?.tab;
          if (tab && tabCounts[tab] !== undefined) tabCounts[tab]++;
        });

        // Submissions
        const submitStarts = rows.filter(r => r.event_type === "submit_start").length;
        const submitCompletes = rows.filter(r => r.event_type === "submit_complete").length;

        // Daily traffic — group by day
        const dayMap = {};
        for (let i = range - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
          const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          dayMap[key] = { day: key, views: 0, sessions: new Set() };
        }
        rows.filter(r => r.event_type === "page_view").forEach(r => {
          const key = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          if (dayMap[key]) {
            dayMap[key].views++;
            if (r.session_id) dayMap[key].sessions.add(r.session_id);
          }
        });
        const dailyData = Object.values(dayMap).map(d => ({ day: d.day, views: d.views, sessions: d.sessions.size }));

        setData({ sessions, pageViews, topTrips, shares, tabCounts, submitStarts, submitCompletes, dailyData, totalEvents: rows.length });
        setLoading(false);
      });
  }, [range]);

  const stat = (label, value, sub) => (
    <div style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, padding:"16px 20px", textAlign:"center" }}>
      <div style={{ fontSize:"28px", fontWeight:800, color:C.slate }}>{value}</div>
      <div style={{ fontSize:"11px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginTop:"2px" }}>{label}</div>
      {sub && <div style={{ fontSize:"10px", color:C.muted, marginTop:"3px" }}>{sub}</div>}
    </div>
  );

  const barColor = "#C4A882";
  const maxBar = data?.topTrips?.[0]?.count || 1;

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:5000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 16px", overflowY:"auto", WebkitOverflowScrolling:"touch", backdropFilter:"blur(8px)" }}>
      <div className="tc-modal-card" style={{ background:C.seafoam, borderRadius:"20px", width:"100%", maxWidth:"780px", overflow:"hidden", boxShadow:`0 32px 64px rgba(44,62,80,0.25)`, border:`1px solid ${C.tide}`, marginBottom:"20px" }}>

        {/* Header */}
        <div style={{ background:C.slate, padding:"20px 28px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"18px", fontWeight:800, color:C.white, fontFamily:"'Playfair Display',Georgia,serif" }}>📊 Analytics</div>
            <div style={{ fontSize:"11px", color:"rgba(255,255,255,0.6)", marginTop:"2px" }}>TripCopycat visitor data</div>
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => { setRange(d); setLoading(true); }}
                style={{ padding:"5px 12px", borderRadius:"6px", border:"none", background:range===d?"rgba(196,168,130,0.3)":"transparent", color:range===d?C.cta:"rgba(255,255,255,0.5)", fontSize:"11px", fontWeight:700, cursor:"pointer" }}>
                {d}d
              </button>
            ))}
            <button onClick={onClose} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:C.white, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"18px" }}>×</button>
          </div>
        </div>

        <div style={{ padding:"24px 28px" }}>
          {loading ? (
            <div style={{ textAlign:"center", padding:"60px", color:C.muted }}>
              <div style={{ fontSize:"32px", marginBottom:"12px" }}>⏳</div>
              <div style={{ fontWeight:600 }}>Loading analytics…</div>
            </div>
          ) : !data ? (
            <div style={{ textAlign:"center", padding:"60px", color:C.muted }}>No data yet</div>
          ) : (
            <>
              {/* Key stats */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(130px, 1fr))", gap:"12px", marginBottom:"28px" }}>
                {stat("Unique Sessions", data.sessions)}
                {stat("Page Views", data.pageViews)}
                {stat("Trip Views", data.topTrips.reduce((s, t) => s + t.count, 0))}
                {stat("Shares", data.shares)}
                {stat("Submit Starts", data.submitStarts, data.submitCompletes > 0 ? `${data.submitCompletes} completed` : "0 completed")}
              </div>

              {/* Daily traffic chart */}
              <div style={{ background:C.white, borderRadius:"14px", border:`1px solid ${C.tide}`, padding:"20px 24px", marginBottom:"20px" }}>
                <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"16px" }}>Daily Traffic — Last {range} Days</div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:"6px", height:"80px" }}>
                  {data.dailyData.map((d, i) => {
                    const maxV = Math.max(...data.dailyData.map(x => x.views), 1);
                    const h = Math.max(4, Math.round((d.views / maxV) * 72));
                    return (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:"4px" }}>
                        <div style={{ fontSize:"9px", color:C.muted, fontWeight:600 }}>{d.views || ""}</div>
                        <div style={{ width:"100%", height:`${h}px`, background:barColor, borderRadius:"3px 3px 0 0", opacity:0.85 }} title={`${d.day}: ${d.views} views, ${d.sessions} sessions`} />
                        <div style={{ fontSize:"8px", color:C.muted, textAlign:"center", lineHeight:1.2 }}>{d.day.split(" ")[1]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top trips */}
              {data.topTrips.length > 0 && (
                <div style={{ background:C.white, borderRadius:"14px", border:`1px solid ${C.tide}`, padding:"20px 24px", marginBottom:"20px" }}>
                  <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"14px" }}>Most Viewed Trips</div>
                  {data.topTrips.map((t, i) => (
                    <div key={i} style={{ marginBottom:"10px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                        <div style={{ fontSize:"11px", fontWeight:600, color:C.slate }}>{t.title}</div>
                        <div style={{ fontSize:"11px", fontWeight:700, color:C.amber }}>{t.count}</div>
                      </div>
                      <div style={{ height:"6px", background:C.seafoam, borderRadius:"3px", overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.round((t.count / maxBar) * 100)}%`, background:barColor, borderRadius:"3px" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab engagement + Shares */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px" }}>
                <div style={{ background:C.white, borderRadius:"14px", border:`1px solid ${C.tide}`, padding:"20px 24px" }}>
                  <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"14px" }}>Tab Engagement</div>
                  {[["overview","Overview"],["daily","Daily Itinerary"],["details","All Details"]].map(([key, label]) => {
                    const maxT = Math.max(data.tabCounts.overview, data.tabCounts.daily, data.tabCounts.details, 1);
                    return (
                      <div key={key} style={{ marginBottom:"10px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                          <div style={{ fontSize:"11px", color:C.slate }}>{label}</div>
                          <div style={{ fontSize:"11px", fontWeight:700, color:C.amber }}>{data.tabCounts[key]}</div>
                        </div>
                        <div style={{ height:"5px", background:C.seafoam, borderRadius:"3px", overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${Math.round((data.tabCounts[key] / maxT) * 100)}%`, background:barColor, borderRadius:"3px" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background:C.white, borderRadius:"14px", border:`1px solid ${C.tide}`, padding:"20px 24px" }}>
                  <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"14px" }}>Conversion</div>
                  {[
                    ["Views → Shares", data.pageViews > 0 ? `${Math.round((data.shares/data.pageViews)*100)}%` : "—"],
                    ["Submit Start → Complete", data.submitStarts > 0 ? `${Math.round((data.submitCompletes/data.submitStarts)*100)}%` : "—"],
                    ["Trip Views", data.topTrips.reduce((s,t)=>s+t.count,0)],
                    ["Total Events", data.totalEvents],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${C.seafoam}` }}>
                      <div style={{ fontSize:"11px", color:C.slateMid }}>{label}</div>
                      <div style={{ fontSize:"11px", fontWeight:700, color:C.slate }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackModal({ onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const inp = { width:"100%", padding:"9px 12px", borderRadius:"8px", border:`1px solid ${C.tide}`, fontSize:"13px", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:C.white, color:C.slate };

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await fetch("https://formsubmit.co/ajax/andrew@tripcopycat.com", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ name: name || "Anonymous", email: email || "No email provided", message, _subject: "TripCopycat Beta Feedback" })
      });
    } catch(e) {}
    setSending(false);
    setSent(true);
  };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:6000, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"480px", boxShadow:`0 32px 64px rgba(44,62,80,0.25)`, overflow:"hidden", border:`1px solid ${C.tide}` }}>

        {/* Header */}
        <div style={{ background:`linear-gradient(135deg, #1C2B3A 0%, #C1692A 100%)`, padding:"22px 28px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"11px", fontWeight:700, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"3px" }}>Beta Feedback</div>
            <div style={{ fontSize:"19px", fontWeight:700, color:C.white, fontFamily:"'Playfair Display',Georgia,serif" }}>Share Your Thoughts</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:C.white, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"18px" }}>×</button>
        </div>

        {sent ? (
          <div style={{ padding:"48px 28px", textAlign:"center" }}>
            <div style={{ fontSize:"44px", marginBottom:"14px" }}>🙏</div>
            <div style={{ fontSize:"18px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif", marginBottom:"8px" }}>Thank you!</div>
            <div style={{ fontSize:"13px", color:C.slateLight, lineHeight:1.6, marginBottom:"24px" }}>Your feedback helps us build a better TripCopycat. We read every message.</div>
            <button className="tc-btn" onClick={onClose} style={{ padding:"10px 28px", borderRadius:"10px", border:"none", background:C.cta, color:C.ctaText, fontWeight:700, fontSize:"13px", cursor:"pointer" }}>Close</button>
          </div>
        ) : (
          <div style={{ padding:"24px 28px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"12px" }}>
              <div>
                <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, display:"block", marginBottom:"4px" }}>Name <span style={{ color:C.muted, fontWeight:400 }}>(optional)</span></label>
                <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" />
              </div>
              <div>
                <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, display:"block", marginBottom:"4px" }}>Email <span style={{ color:C.muted, fontWeight:400 }}>(optional)</span></label>
                <input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
            </div>
            <div style={{ marginBottom:"20px" }}>
              <label style={{ fontSize:"11px", fontWeight:600, color:C.slateMid, display:"block", marginBottom:"4px" }}>Feedback <span style={{ color:C.red }}>*</span></label>
              <textarea style={{...inp, height:"110px", resize:"vertical"}} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Tell us about a bug, a suggestion, or anything on your mind…" />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Cancel</button>
              <button onClick={handleSend} disabled={!message.trim() || sending} style={{ padding:"9px 24px", borderRadius:"8px", border:"none", background:message.trim()?C.cta:C.tide, color:message.trim()?C.ctaText:C.muted, fontSize:"12px", fontWeight:700, cursor:message.trim()?"pointer":"not-allowed", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}>
                {sending ? "Sending…" : "Send Feedback →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Legal Modal ───────────────────────────────────────────────────────────────

function LegalModal({ onClose }) {
  const sect = { fontSize:"15px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',Georgia,serif", marginTop:"28px", marginBottom:"8px" };
  const sub  = { fontSize:"13px", fontWeight:700, color:C.slateLight, marginTop:"14px", marginBottom:"4px" };
  const body = { fontSize:"13px", color:C.slateMid, lineHeight:1.75, margin:"0 0 8px 0" };
  const bullet = { fontSize:"13px", color:C.slateMid, lineHeight:1.75, margin:"4px 0 4px 16px" };

  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:5000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"28px 16px", overflowY:"auto", WebkitOverflowScrolling:"touch", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tc-modal-card" style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"720px", boxShadow:`0 32px 64px rgba(44,62,80,0.25)`, overflow:"hidden", border:`1px solid ${C.tide}` }}>

        {/* Header */}
        <div style={{ background:C.slate, padding:"24px 32px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"11px", fontWeight:700, color:"rgba(196,168,130,0.8)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"4px" }}>Legal</div>
            <div style={{ fontSize:"20px", fontWeight:700, color:C.white, fontFamily:"'Playfair Display',Georgia,serif" }}>Terms of Service &amp; Legal Notices</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:C.white, borderRadius:"50%", width:"34px", height:"34px", cursor:"pointer", fontSize:"18px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding:"28px 32px 40px", overflowY:"auto", WebkitOverflowScrolling:"touch", maxHeight:"72vh" }}>
          <p style={{ ...body, color:C.muted, fontSize:"12px" }}>Last updated: {new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}</p>

          <div style={sect}>1. Ownership of TripCopycat Brand and Assets</div>
          <p style={body}>The Service and its original content, features, and functionality—including but not limited to the TripCopycat name, the "Cat" logo, website design, text, graphics, and underlying code—are and will remain the exclusive property of TripCopycat and its licensors.</p>
          <p style={sub}>Trademarks</p>
          <p style={body}>The name "TripCopycat," the cat logo, and all related names, logos, product and service names, designs, and slogans are trademarks of TripCopycat. You must not use such marks without prior written permission.</p>
          <p style={sub}>Trade Dress</p>
          <p style={body}>The "look and feel" of the TripCopycat platform, including its unique color combinations, button shapes, and layout, is protected trade dress.</p>
          <p style={sub}>Copyright</p>
          <p style={body}>The site and its contents are protected by copyright, trademark, and other laws of both the United States and foreign countries.</p>

          <div style={sect}>2. User Content Submission License</div>
          <p style={body}>By submitting a trip itinerary, photos, or descriptions (the "Content") to TripCopycat, you agree to the following:</p>
          <p style={sub}>Ownership &amp; License</p>
          <p style={body}>You retain ownership of your original Content. However, by submitting it, you grant TripCopycat a worldwide, royalty-free, perpetual, and non-exclusive license to host, store, use, display, reproduce, modify, and distribute your Content on our website, social media, and in marketing materials.</p>
          <p style={sub}>The "Copycat" Right</p>
          <p style={body}>You understand and agree that the purpose of TripCopycat is to allow other users to view, download, and "copycat" your itinerary for their own personal travel use. You grant TripCopycat the right to format your data into downloadable or interactive formats for our community.</p>
          <p style={sub}>Your Representation</p>
          <p style={body}>You represent and warrant that you are the original creator of the Content or have the legal right to share it, and that the Content does not violate the intellectual property or privacy rights of any third party.</p>
          <p style={sub}>No Compensation</p>
          <p style={body}>You understand that you will not receive financial compensation for submitting Content to TripCopycat, unless otherwise agreed upon in a separate written agreement.</p>

          <div style={sect}>3. Copyright Infringement (DMCA)</div>
          <p style={body}>We respect the intellectual property rights of others. It is our policy to respond to any claim that Content posted on the Service infringes on the copyright or other intellectual property rights of any person or entity. If you believe your work has been copied in a way that constitutes copyright infringement, please contact us with a description of the allegedly infringing material and your contact information.</p>

          <div style={{ marginTop:"32px", padding:"16px 20px", background:C.seafoam, borderRadius:"12px", border:`1px solid ${C.tide}` }}>
            <p style={{ ...body, margin:0, fontSize:"12px", color:C.muted }}>Questions about these terms? Contact us at <strong style={{ color:C.slate }}>legal@tripcopycat.com</strong></p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:"16px 32px", borderTop:`1px solid ${C.tide}`, background:C.seafoam, display:"flex", justifyContent:"flex-end" }}>
          <button className="tc-btn" onClick={onClose} style={{ padding:"9px 24px", borderRadius:"8px", border:"none", background:C.cta, color:C.ctaText, fontSize:"12px", fontWeight:700, cursor:"pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}



// ── Gear We Love Page ─────────────────────────────────────────────────────────
const GEAR_ITEMS = [
  { id:1, name:"Wonderfold Wagon", category:"Family Travel", description:"Goes right through airport security and gate checks for free. The only catch — you'll need a minivan or SUV rental on the other end to fit it.", personalNote:"Provided a great spot for naps while on the beach or a patio.", image:"https://m.media-amazon.com/images/I/71K1Ct2KIpL._SL1500_.jpg", affiliateUrl:"https://amzn.to/4smV8W4" },
  { id:2, name:"Portable Sound Machine", category:"Sleep & Rest", description:"Clip it to a Pack n Play, turn it on, and the whole family can share one hotel room without tiptoeing around bedtime.", personalNote:"Haven't traveled without this since our first international trip with the kids.", image:"https://m.media-amazon.com/images/I/71Il67Mwk-L._SL1500_.jpg", affiliateUrl:"https://amzn.to/4bQZ9wY" },
  { id:3, name:"Double Umbrella Stroller", category:"Family Travel", description:"Lightweight enough to carry one-handed, folds flat for tight restaurants and pubs, and way more durable than the price suggests.", personalNote:"Survived cobblestones across Edinburgh and the Royal Mile without a single issue.", image:"https://m.media-amazon.com/images/I/71fzexxzZ1L._SL1200_.jpg", affiliateUrl:"https://amzn.to/4co7oAA" },
  { id:4, name:"European Style Power Adapter", category:"Power & Adapters", description:"Get one with multiple USB ports so the whole family charges from a single outlet. Match the plug type to your destination — most of Europe is Type C.", personalNote:"We keep two in our travel bag permanently so we're never scrambling the night before.", image:"https://m.media-amazon.com/images/I/412IcQgyAQL._AC_SL1393_.jpg", affiliateUrl:"https://amzn.to/4dlDDS1" },
  { id:5, name:"Airline Headrest & Sleep Mask", category:"Sleep & Rest", description:"Wraps around your headrest to prop your head up — a lifesaver when you're stuck in a middle or aisle seat with nothing to lean on.", personalNote:"Used this on the redeye to Ireland and actually slept. Landed ready to go instead of needing half the day to recover.", image:"https://m.media-amazon.com/images/I/712WEkICrPL._AC_SL1500_.jpg", affiliateUrl:"https://amzn.to/4tl00vt" },
  { id:6, name:"Amazon Fire Tablet (Kids)", category:"Entertainment", description:"Practically indestructible with the kid-proof case, and the smaller size is easy for little hands to hold through a long flight or a three hour European dinner.", personalNote:"This bought us an extra hour at every restaurant on our travels — worth every penny.", image:"https://m.media-amazon.com/images/I/710lki-m62L._AC_SL1500_.jpg", affiliateUrl:"https://amzn.to/4sQICPC" },
  { id:7, name:"Amazon Fire Tablet (Larger)", category:"Entertainment", description:"Same durability as the kids' version but with a bigger screen that keeps older kids engaged on 8+ hour flights without complaints.", personalNote:"Our oldest watched movies the entire flight to Hawaii and never asked 'are we there yet' once.", image:"https://m.media-amazon.com/images/I/71l21-L3fcL._AC_SL1000_.jpg", affiliateUrl:"https://amzn.to/47CF9eR" },
  { id:8, name:"Pack n Play Blackout Cover", category:"Sleep & Rest", description:"Turns any Pack n Play into a pitch-dark, quiet sleep space — so the baby goes down at 7 and the rest of the family can keep the lights on.", personalNote:"Went with the name-brand version for the breathability factor. Worth the peace of mind.", image:"https://m.media-amazon.com/images/I/61Wr8cyAy7L._SL1500_.jpg", affiliateUrl:"https://amzn.to/48a7N7g" },
];

const GEAR_CATEGORIES = ["All", "Family Travel", "Sleep & Rest", "Power & Adapters", "Entertainment"];

function GearPage({ onClose }) {
  const [activeCategory, setActiveCategory] = useState("All");
  const filtered = activeCategory === "All" ? GEAR_ITEMS : GEAR_ITEMS.filter(g => g.category === activeCategory);
  return (
    <div style={{ position:"fixed", inset:0, zIndex:1500, background:C.seafoam, fontFamily:"'DM Sans',sans-serif", overflowY:"auto" }}>
      <div style={{ background:C.slate, padding:"32px 32px 28px", borderBottom:`1px solid rgba(196,168,130,0.2)` }}>
        <div style={{ maxWidth:"960px", margin:"0 auto" }}>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", color:"rgba(255,255,255,0.7)", borderRadius:"8px", padding:"6px 14px", cursor:"pointer", fontSize:"12px", marginBottom:"20px", fontFamily:"inherit" }}>← Back</button>
          <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"8px" }}>Travel Tips & Recommendations</div>
          <h1 style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:"34px", fontWeight:900, color:"#FFFFFF", margin:"0 0 10px", lineHeight:1.1 }}>Gear We Love</h1>
          <p style={{ fontSize:"14px", color:"rgba(255,255,255,0.7)", margin:"0 0 16px", maxWidth:"520px", lineHeight:1.65 }}>Handpicked travel essentials from real family trips. Every item has been personally tested — nothing we wouldn't pack ourselves.</p>
          <div style={{ fontSize:"11px", color:"rgba(255,255,255,0.4)", background:"rgba(255,255,255,0.06)", display:"inline-block", padding:"4px 12px", borderRadius:"20px" }}>Some links are affiliate links — commissions help keep TripCopycat free and never cost you more.</div>
        </div>
      </div>
      <div style={{ background:C.white, borderBottom:`1px solid ${C.tide}`, padding:"0 32px" }}>
        <div style={{ maxWidth:"960px", margin:"0 auto", display:"flex", gap:"4px", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          {GEAR_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} style={{ padding:"14px 18px", fontSize:"12px", fontWeight:activeCategory===cat?700:400, border:"none", background:"transparent", cursor:"pointer", color:activeCategory===cat?C.slate:C.muted, borderBottom:activeCategory===cat?`2px solid ${C.amber}`:"2px solid transparent", whiteSpace:"nowrap", fontFamily:"inherit", transition:"color .15s" }}>{cat}</button>
          ))}
        </div>
      </div>
      <div style={{ maxWidth:"960px", margin:"0 auto", padding:"32px 24px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))", gap:"20px" }}>
          {filtered.map(item => (
            <div key={item.id} className="tc-lift" style={{ background:C.white, border:`1px solid ${C.tide}`, borderRadius:"16px", overflow:"hidden", display:"flex", flexDirection:"column", transition:"transform .15s,box-shadow .15s,border-color .15s" }}>
              <div style={{ width:"100%", height:"200px", overflow:"hidden", background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", boxSizing:"border-box" }}>
                <img src={item.image} alt={item.name} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", display:"block" }} onError={e => { e.target.style.display="none"; }} />
              </div>
              <div style={{ padding:"16px 18px", flex:1, display:"flex", flexDirection:"column", gap:"8px" }}>
                <div style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", color:C.amber }}>{item.category}</div>
                <div style={{ fontSize:"15px", fontWeight:800, color:C.slate, lineHeight:1.25, fontFamily:"'Playfair Display',Georgia,serif" }}>{item.name}</div>
                <p style={{ fontSize:"13px", color:C.slateLight, lineHeight:1.6, margin:0, flex:1 }}>{item.description}</p>
                <div style={{ fontSize:"12px", color:C.slateMid, fontStyle:"italic", borderLeft:`2px solid ${C.amber}`, paddingLeft:"10px", lineHeight:1.5, borderRadius:0 }}>{item.personalNote}</div>
              </div>
              <div style={{ padding:"12px 18px", borderTop:`1px solid ${C.tide}`, display:"flex", alignItems:"center", justifyContent:"space-between", background:C.seafoam }}>
                <div style={{ fontSize:"10px", fontWeight:700, color:C.amber, background:"rgba(196,168,130,0.12)", border:`1px solid rgba(196,168,130,0.3)`, borderRadius:"20px", padding:"2px 10px" }}>Andrew's pick</div>
                <a href={item.affiliateUrl} target="_blank" rel="noopener noreferrer" style={{ background:C.slate, color:C.white, border:"none", borderRadius:"8px", padding:"8px 18px", fontSize:"12px", fontWeight:700, cursor:"pointer", textDecoration:"none", fontFamily:"inherit" }}>Get it here →</a>
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign:"center", marginTop:"40px", padding:"20px", borderTop:`1px solid ${C.tide}` }}>
          <p style={{ fontSize:"11px", color:C.muted, margin:0, lineHeight:1.6 }}>TripCopycat participates in the Amazon Services LLC Associates Program. Links above are affiliate links — we earn a small commission at no extra cost to you.</p>
        </div>
      </div>
    </div>
  );
}


// ── Blueprint Page ─────────────────────────────────────────────────────────────
function BlueprintPage({ tripId, onClose }) {
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiAlternatives, setAiAlternatives] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const success = new URLSearchParams(window.location.search).get("success") === "true";

  useEffect(() => {
    supabase.from("trips").select("*").eq("id", tripId).maybeSingle().then(({ data }) => {
      if (data) {
        setTrip({
          id: data.id, title: data.title, destination: data.destination, region: data.region,
          author: data.author_name, date: data.date, duration: data.duration, travelers: data.travelers,
          tags: data.tags || [], loves: data.loves, doNext: data.do_next,
          airfare: data.airfare || [], hotels: data.hotels || [], restaurants: data.restaurants || [],
          bars: data.bars || [], activities: data.activities || [], days: data.days || [],
          image: data.image ?? null, focalPoint: data.focal_point || {x:50,y:50}, gallery: data.gallery || [],
          venueCoords: data.venue_coords || null,
        });
      }
      setLoading(false);
    });
  }, [tripId]);

  // Load Google Maps JS API once and render pins when trip is ready
  useEffect(() => {
    if (!trip?.venueCoords) return;
    const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_KEY || "";
    if (!mapsKey) return;

    const renderMap = () => {
      const mapEl = document.getElementById("bp-gmap");
      if (!mapEl || !window.google) return;

      const CAT_COLORS = { hotels:"#C1392B", restaurants:"#2980B9", bars:"#8E44AD", activities:"#27AE60" };
      const pins = [];
      for (const [cat, coords] of Object.entries(trip.venueCoords)) {
        const venues = trip[cat] || [];
        (coords || []).forEach((c, i) => {
          if (c && venues[i]?.item) pins.push({ lat: c.lat, lng: c.lng, name: venues[i].item, cat, color: CAT_COLORS[cat] });
        });
      }
      if (pins.length === 0) return;

      const bounds = new window.google.maps.LatLngBounds();
      const map = new window.google.maps.Map(mapEl, { zoom: 12, center: { lat: pins[0].lat, lng: pins[0].lng }, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      const infoWindow = new window.google.maps.InfoWindow();

      const makeSvgIcon = (color) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${color}"/><circle cx="14" cy="14" r="6" fill="white"/></svg>`;
        return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new window.google.maps.Size(28, 36), anchor: new window.google.maps.Point(14, 36) };
      };

      for (const pin of pins) {
        const marker = new window.google.maps.Marker({ position: { lat: pin.lat, lng: pin.lng }, map, icon: makeSvgIcon(pin.color), title: pin.name });
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pin.name + " " + (trip.destination || ""))}`;
        marker.addListener("click", () => {
          infoWindow.setContent(`<div style="font-family:'DM Sans',sans-serif;padding:2px 4px"><div style="font-weight:700;font-size:13px;margin-bottom:3px">${pin.name}</div><div style="font-size:11px;color:#A89080;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${pin.cat}</div><a href="${mapsUrl}" target="_blank" rel="noopener" style="font-size:12px;color:#4285F4;font-weight:600;text-decoration:none">Open in Google Maps ↗</a></div>`);
          infoWindow.open(map, marker);
        });
        bounds.extend({ lat: pin.lat, lng: pin.lng });
      }
      map.fitBounds(bounds);
      window.google.maps.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 15) map.setZoom(15); });
    };

    if (window.google?.maps) {
      renderMap();
    } else {
      window._bpMapCallback = renderMap;
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}&callback=_bpMapCallback`;
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
  }, [trip]);

  useEffect(() => {
    if (!trip || aiAlternatives) return;
    setAiLoading(true);
    const prompt = `You are a travel expert. Given this trip to ${trip.destination}, suggest 1-2 alternative venues for each category below. Be specific and name real places. Return ONLY a JSON object with keys: hotels, restaurants, bars, activities. Each value is an array of {name, reason} objects.\n\nHotels: ${trip.hotels.map(h=>h.item).join(", ")}\nRestaurants: ${trip.restaurants.map(r=>r.item).join(", ")}\nBars: ${trip.bars.map(b=>b.item).join(", ")}\nActivities: ${trip.activities.map(a=>a.item).join(", ")}`;
    fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }).then(r => r.json()).then(data => {
      try {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const clean = text.replace(/```json|```/g, "").trim();
        setAiAlternatives(JSON.parse(clean));
      } catch { setAiAlternatives(null); }
    }).catch(() => setAiAlternatives(null)).finally(() => setAiLoading(false));
  }, [trip]);

  const xmlEsc = (s) => String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const generateKML = () => {
    if (!trip) return;
    const cats = [
      { key:"hotels",      color:"ff0000ff", label:"Hotel" },
      { key:"restaurants", color:"ff00ff00", label:"Restaurant" },
      { key:"bars",        color:"ffff00ff", label:"Bar" },
      { key:"activities",  color:"ffffff00", label:"Activity" },
    ];
    const coords = trip.venueCoords || {};
    const placemarks = cats.flatMap(cat => {
      const venues = (trip[cat.key] || []).filter(p => p.item);
      const catCoords = coords[cat.key] || [];
      return venues.map((p, i) => {
        const c = catCoords[i];
        const pt = c?.lat && c?.lng
          ? `<Point><coordinates>${c.lng},${c.lat},0</coordinates></Point>`
          : "";
        return `<Placemark><name>${xmlEsc(p.item)}</name><description>${xmlEsc(cat.label + (p.detail ? " — " + p.detail : "") + (p.tip ? " | Tip: " + p.tip : ""))}</description><Style><IconStyle><color>${cat.color}</color></IconStyle></Style>${pt}</Placemark>`;
      });
    });
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(trip.title)}</name><description>Trip Blueprint from TripCopycat — tripcopycat.com/trip/${trip.id}</description>${placemarks.join("")}</Document></kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${trip.title.replace(/\s+/g,"-")}-blueprint.kml`;
    a.click();
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.seafoam }}>
      <div style={{ textAlign:"center" }}><div style={{ fontSize:"32px", marginBottom:"12px" }}>🐾</div><div style={{ fontSize:"14px", color:C.muted }}>Loading your Blueprint…</div></div>
    </div>
  );

  if (!trip) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.seafoam }}>
      <div style={{ textAlign:"center" }}><div style={{ fontSize:"32px", marginBottom:"12px" }}>✈️</div><div style={{ fontSize:"14px", color:C.muted }}>Trip not found.</div><button onClick={onClose} style={{ marginTop:"16px", padding:"8px 20px", borderRadius:"8px", border:"none", background:C.cta, color:C.white, cursor:"pointer", fontWeight:600 }}>← Back</button></div>
    </div>
  );

  const catConfig = { hotels:"🏨", restaurants:"🍽", bars:"🍸", activities:"🎯" };

  return (
    <div style={{ minHeight:"100vh", background:C.seafoam, fontFamily:"'Playfair Display',Georgia,serif" }}>
      {/* Success banner */}
      {success && (
        <div style={{ background:"linear-gradient(135deg,#1C4A2E,#2D7A4F)", padding:"14px 24px", textAlign:"center", color:"#fff", fontSize:"13px", fontWeight:600 }}>
          🎉 Payment confirmed! Your Trip Blueprint is ready.
        </div>
      )}

      {/* Header */}
      <div style={{ position:"relative", minHeight:"320px", background:C.slate, overflow:"hidden" }}>
        {trip.image && <img src={trip.image} alt={trip.title} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", objectPosition:`${trip.focalPoint?.x||50}% ${trip.focalPoint?.y||50}%`, opacity:0.3 }} />}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom, rgba(28,43,58,0.2), rgba(28,43,58,0.9))" }} />
        <div style={{ position:"relative", zIndex:1, padding:"40px 40px 32px", maxWidth:"800px", margin:"0 auto" }}>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:"8px", padding:"6px 14px", cursor:"pointer", fontSize:"12px", marginBottom:"24px", fontFamily:"'DM Sans',sans-serif" }}>← Back to TripCopycat</button>
          <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"10px" }}>{trip.region} · {trip.duration} · {trip.date}</div>
          <h1 style={{ fontSize:"38px", fontWeight:900, color:"#fff", margin:"0 0 8px", textShadow:"0 2px 12px rgba(0,0,0,0.5)", lineHeight:1.1 }}>{trip.title}</h1>
          <div style={{ fontSize:"15px", color:"rgba(255,255,255,0.85)", marginBottom:"6px" }}>{trip.destination}</div>
          <div style={{ fontSize:"13px", color:C.amber }}>by {trip.author} · {trip.travelers}</div>

          {/* Action buttons */}
          <div style={{ display:"flex", gap:"10px", marginTop:"24px", flexWrap:"wrap", fontFamily:"'DM Sans',sans-serif" }}>
            <button onClick={() => window.print()} style={{ padding:"10px 20px", borderRadius:"8px", border:"none", background:C.amber, color:C.slate, fontSize:"12px", fontWeight:700, cursor:"pointer" }}>⬇ Download PDF</button>
            <button onClick={generateKML} style={{ padding:"10px 20px", borderRadius:"8px", border:"1px solid rgba(196,168,130,0.5)", background:"transparent", color:C.amber, fontSize:"12px", fontWeight:700, cursor:"pointer" }}>🗺 Open in Google Maps</button>
            <button onClick={() => { navigator.clipboard.writeText(window.location.href); alert("Link copied!"); }} style={{ padding:"10px 20px", borderRadius:"8px", border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"rgba(255,255,255,0.8)", fontSize:"12px", fontWeight:700, cursor:"pointer" }}>🔗 Share Blueprint</button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth:"800px", margin:"0 auto", padding:"32px 24px" }}>

        {/* Loves */}
        <div style={{ background:C.white, borderRadius:"16px", padding:"24px 28px", marginBottom:"20px", border:`1px solid ${C.tide}`, boxShadow:`0 2px 12px rgba(28,43,58,0.06)` }}>
          <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>❤️ What the traveler loved</div>
          <p style={{ fontSize:"15px", color:C.slate, lineHeight:1.75, fontFamily:"'DM Sans',sans-serif", margin:0 }}>{trip.loves}</p>
        </div>

        {/* Do Next */}
        {trip.doNext && (
          <div style={{ background:C.white, borderRadius:"16px", padding:"24px 28px", marginBottom:"20px", border:`1px solid ${C.tide}`, boxShadow:`0 2px 12px rgba(28,43,58,0.06)` }}>
            <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"10px" }}>🔄 What they'd do differently</div>
            <p style={{ fontSize:"15px", color:C.slate, lineHeight:1.75, fontFamily:"'DM Sans',sans-serif", margin:0 }}>{trip.doNext}</p>
          </div>
        )}

        {/* Day-by-day timeline */}
        {trip.days?.length > 0 && (
          <div style={{ background:C.white, borderRadius:"16px", padding:"24px 28px", marginBottom:"20px", border:`1px solid ${C.tide}`, boxShadow:`0 2px 12px rgba(28,43,58,0.06)` }}>
            <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"20px" }}>📅 Day-by-Day Itinerary</div>
            {trip.days.map((day, di) => (
              <div key={di} style={{ marginBottom:"24px" }}>
                <div style={{ fontSize:"14px", fontWeight:800, color:C.slate, marginBottom:"12px", paddingBottom:"8px", borderBottom:`2px solid ${C.tide}` }}>Day {day.day}{day.title ? ` — ${day.title}` : ""}{day.date ? ` · ${day.date}` : ""}</div>
                <div style={{ position:"relative", paddingLeft:"20px" }}>
                  <div style={{ position:"absolute", left:"6px", top:0, bottom:0, width:"2px", background:C.tide }} />
                  {(day.items || []).map((item, ii) => (
                    <div key={ii} style={{ position:"relative", marginBottom:"12px", fontFamily:"'DM Sans',sans-serif" }}>
                      <div style={{ position:"absolute", left:"-17px", top:"4px", width:"10px", height:"10px", borderRadius:"50%", background:C.amber, border:`2px solid ${C.white}` }} />
                      {item.time && <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, marginBottom:"2px" }}>{item.time}</div>}
                      <div style={{ fontSize:"13px", fontWeight:600, color:C.slate }}>{item.label}</div>
                      {item.note && <div style={{ fontSize:"12px", color:C.slateLight, marginTop:"2px" }}>{item.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Venue details */}
        {["hotels","restaurants","bars","activities"].map(cat => (
          trip[cat]?.length > 0 && trip[cat].some(i => i.item) && (
            <div key={cat} style={{ background:C.white, borderRadius:"16px", padding:"24px 28px", marginBottom:"20px", border:`1px solid ${C.tide}`, boxShadow:`0 2px 12px rgba(28,43,58,0.06)` }}>
              <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"14px" }}>{catConfig[cat]} {cat.charAt(0).toUpperCase()+cat.slice(1)}</div>
              {trip[cat].filter(i => i.item).map((item, idx) => (
                <div key={idx} style={{ padding:"10px 0", borderBottom:`1px solid ${C.seafoam}`, fontFamily:"'DM Sans',sans-serif" }}>
                  <div style={{ fontSize:"13px", fontWeight:700, color:C.slate }}>{item.item}</div>
                  {item.detail && <div style={{ fontSize:"12px", color:C.slateLight, marginTop:"2px" }}>{item.detail}</div>}
                  {item.tip && <div style={{ fontSize:"12px", color:C.amber, marginTop:"4px" }}>💡 {item.tip}</div>}
                </div>
              ))}
            </div>
          )
        ))}

        {/* AI Alternatives */}
        <div style={{ background:C.white, borderRadius:"16px", padding:"24px 28px", marginBottom:"20px", border:`1px solid ${C.tide}`, boxShadow:`0 2px 12px rgba(28,43,58,0.06)` }}>
          <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"14px" }}>✨ AI-Suggested Alternatives</div>
          {aiLoading && <div style={{ fontSize:"13px", color:C.muted, fontFamily:"'DM Sans',sans-serif" }}>Generating alternatives…</div>}
          {aiAlternatives && Object.entries(aiAlternatives).map(([cat, alts]) => (
            alts?.length > 0 && (
              <div key={cat} style={{ marginBottom:"14px" }}>
                <div style={{ fontSize:"12px", fontWeight:700, color:C.slate, marginBottom:"6px", fontFamily:"'DM Sans',sans-serif" }}>{catConfig[cat]} Alternative {cat}</div>
                {alts.map((a, i) => (
                  <div key={i} style={{ padding:"8px 12px", background:C.seafoam, borderRadius:"8px", marginBottom:"6px", fontFamily:"'DM Sans',sans-serif" }}>
                    <div style={{ fontSize:"13px", fontWeight:600, color:C.slate }}>{a.name}</div>
                    {a.reason && <div style={{ fontSize:"12px", color:C.slateLight, marginTop:"2px" }}>{a.reason}</div>}
                  </div>
                ))}
              </div>
            )
          ))}
        </div>

        {/* Map with venue pins */}
        <div style={{ background:C.white, borderRadius:"16px", padding:"24px 28px", marginBottom:"20px", border:`1px solid ${C.tide}`, boxShadow:`0 2px 12px rgba(28,43,58,0.06)` }}>
          <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"14px" }}>🗺 Venue Map</div>
          {trip.venueCoords ? (
            <div id="bp-gmap" style={{ width:"100%", height:"360px", borderRadius:"10px", border:`1px solid ${C.tide}` }} />
          ) : (
            <iframe
              title="Trip Map"
              width="100%" height="300"
              style={{ border:0, borderRadius:"8px" }}
              loading="lazy"
              src={`https://www.google.com/maps/embed/v1/search?key=${import.meta.env.VITE_GOOGLE_MAPS_KEY || ""}&q=${encodeURIComponent(trip.destination)}`}
            />
          )}
          <div style={{ marginTop:"8px", fontSize:"11px", color:C.muted, display:"flex", gap:"12px", flexWrap:"wrap" }}>
            {trip.venueCoords && (
              <>
                <span>🔴 Hotels</span><span>🔵 Restaurants</span><span>🟣 Bars</span><span>🟢 Activities</span>
              </>
            )}
          </div>
          <div style={{ marginTop:"12px" }}>
            <button onClick={generateKML} style={{ padding:"8px 16px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.seafoam, color:C.slate, fontSize:"12px", fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>⬇ Download KML — Open All Pins in Google Maps</button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign:"center", padding:"24px 0", fontFamily:"'DM Sans',sans-serif" }}>
          <div style={{ fontSize:"12px", color:C.muted, marginBottom:"8px" }}>Generated by TripCopycat · tripcopycat.com</div>
          <div style={{ fontSize:"11px", color:C.muted }}>Views and recommendations are those of the traveler and not of TripCopycat.</div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          button { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}


// ── How It Works Modal ───────────────────────────────────────────────────────
function HowItWorksModal({ onClose, onSubmit }) {
  return (
    <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:"20px 16px", overflowY:"auto", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:C.white, borderRadius:"20px", width:"100%", maxWidth:"560px", overflow:"hidden", boxShadow:"0 32px 64px rgba(44,62,80,0.22)", border:`1px solid ${C.tide}` }}>

        {/* Header */}
        <div style={{ background:C.slate, padding:"28px 32px 24px", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(rgba(196,168,130,0.08) 1px,transparent 1px)", backgroundSize:"18px 18px" }} />
          <div style={{ position:"relative" }}>
            <div style={{ fontSize:"11px", fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"8px" }}>TripCopycat</div>
            <h2 style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:"26px", fontWeight:900, color:"#fff", margin:"0 0 8px", lineHeight:1.1 }}>How Does This Work?</h2>
            <p style={{ fontSize:"13px", color:"rgba(255,255,255,0.72)", margin:0, lineHeight:1.65 }}>TripCopycat is built by travelers, for travelers. Share a trip you've taken — and copy the ones others have shared.</p>
          </div>
          <button onClick={onClose} style={{ position:"absolute", top:"16px", right:"16px", background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"rgba(255,255,255,0.8)", borderRadius:"50%", width:"32px", height:"32px", cursor:"pointer", fontSize:"16px", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>

        {/* Steps */}
        <div style={{ padding:"24px 32px" }}>

          {/* Step 1 */}
          <div style={{ display:"flex", gap:"16px" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
              <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:C.seafoam, border:`1px solid ${C.tide}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px" }}>📝</div>
              <div style={{ width:"2px", flex:1, background:C.tide, marginTop:"6px", minHeight:"24px" }} />
            </div>
            <div style={{ paddingTop:"6px", paddingBottom:"20px" }}>
              <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"3px" }}>Step 1 — Share a trip you've taken</div>
              <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.65 }}>Been somewhere great? Brain dump what you remember — hotels, restaurants, highlights, honest takes — and our AI fills in the structure. Add photos and submit. This is what makes the community work.</div>
            </div>
          </div>

          {/* Step 2 */}
          <div style={{ display:"flex", gap:"16px" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
              <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:C.seafoam, border:`1px solid ${C.tide}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px" }}>🗺</div>
              <div style={{ width:"2px", flex:1, background:C.tide, marginTop:"6px", minHeight:"24px" }} />
            </div>
            <div style={{ paddingTop:"6px", paddingBottom:"20px" }}>
              <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"3px" }}>Step 2 — Your trip becomes a Blueprint</div>
              <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.65 }}>Once approved, your trip gets AI-generated venue alternatives and a pinned Google Maps export — becoming a Blueprint that other travelers can leverage to plan their own version of your trip.</div>
            </div>
          </div>

          {/* Step 3 */}
          <div style={{ display:"flex", gap:"16px" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
              <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:C.seafoam, border:`1px solid ${C.tide}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px" }}>✈️</div>
              <div style={{ width:"2px", flex:1, background:C.tide, marginTop:"6px", minHeight:"24px" }} />
            </div>
            <div style={{ paddingTop:"6px", paddingBottom:"14px" }}>
              <div style={{ fontSize:"13px", fontWeight:700, color:C.slate, marginBottom:"3px" }}>Step 3 — Browse what others have shared</div>
              <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.65 }}>Every trip on TripCopycat was submitted by a real traveler — hotels they actually stayed at, restaurants they genuinely loved, and honest takes on what they'd skip next time.</div>
            </div>
          </div>

          {/* Substep — Unlock a Blueprint */}
          <div style={{ display:"flex", gap:"14px", marginLeft:"18px" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, width:"20px" }}>
              <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:C.cta, marginTop:"5px", flexShrink:0 }} />
            </div>
            <div style={{ paddingTop:"2px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px" }}>
                <div style={{ fontSize:"12px", fontWeight:700, color:C.slate }}>Unlock a Blueprint</div>
                <div style={{ fontSize:"10px", fontWeight:700, background:C.seafoam, color:C.amber, border:`1px solid ${C.cta}`, padding:"1px 7px", borderRadius:"20px" }}>$1.99</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:"8px" }}>
                  <span style={{ fontSize:"13px", flexShrink:0, marginTop:"1px" }}>📍</span>
                  <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.55 }}><span style={{ fontWeight:700, color:C.slate }}>Custom Google Maps pin map</span> — every hotel, restaurant, bar, and activity dropped as a color-coded pin. Open directly in Google Maps on your phone.</div>
                </div>
                <div style={{ display:"flex", alignItems:"flex-start", gap:"8px" }}>
                  <span style={{ fontSize:"13px", flexShrink:0, marginTop:"1px" }}>📄</span>
                  <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.55 }}><span style={{ fontWeight:700, color:C.slate }}>Printable PDF</span> — the full itinerary, venue details, and tips in one clean document. Print it, save it, or pull it up offline.</div>
                </div>
                <div style={{ display:"flex", alignItems:"flex-start", gap:"8px" }}>
                  <span style={{ fontSize:"13px", flexShrink:0, marginTop:"1px" }}>🔗</span>
                  <div style={{ fontSize:"12px", color:C.slateLight, lineHeight:1.55 }}><span style={{ fontWeight:700, color:C.slate }}>Shareable link</span> — send your Blueprint to a travel partner so everyone has everything in one place.</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* CTAs */}
        <div style={{ padding:"16px 32px 28px", display:"flex", gap:"10px", flexWrap:"wrap" }}>
          <button onClick={() => { onClose(); onSubmit(); }} style={{ flex:1, minWidth:"140px", padding:"12px 20px", borderRadius:"10px", border:"none", background:C.slate, color:"#fff", fontSize:"13px", fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
            Share a Trip You've Taken →
          </button>
          <button onClick={() => { window.location.href = "/blueprint/sample"; }} style={{ flex:1, minWidth:"140px", padding:"12px 20px", borderRadius:"10px", border:`2px solid ${C.amber}`, background:"transparent", color:C.amber, fontSize:"13px", fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
            ▲ See a Sample Blueprint
          </button>
        </div>

      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [showGear, setShowGear] = useState(window.location.pathname === "/gear");
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [trips, setTrips] = useState(SAMPLE_TRIPS);
  const [dbTrips, setDbTrips] = useState(() => {
    try {
      const cached = localStorage.getItem("tc_trips_cache");
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });

  const blueprintMatch = window.location.pathname.match(/^\/blueprint\/(?!sample)(.+)/);
  const blueprintId = blueprintMatch ? blueprintMatch[1] : null;
  if (blueprintId) {
    return <BlueprintPage tripId={blueprintId} onClose={() => { window.history.pushState(null, "", "/"); window.location.reload(); }} />;
  }
  const [tripsLoading, setTripsLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [photoImportData, setPhotoImportData] = useState(null);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  // Force login before submitting
  const openSubmit = () => {
    if (!currentUser) { setPendingSubmit(true); setShowAuth(true); }
    else setShowSubmit(true);
  };
  const [showQueue, setShowQueue] = useState(false);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("All Regions");
  const [tag, setTag] = useState("All");
  const [sortBy, setSortBy] = useState("default");
  const [duration, setDuration] = useState("Any Length");
  const { bookmarks, toggle: toggleBookmark } = useBookmarks();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 640);
  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load from Supabase on mount
  // Expose profile setter for card author clicks
  useEffect(() => { window.__setViewingProfile = setViewingProfile; }, []);


  const fetchTrips = () => {
    setTripsLoading(true);
    supabase.from("trips").select("*").eq("status","published").order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error("Supabase fetch error:", error);
        if (data?.length > 0) {
          const mapped = data.map(t => ({
            id:t.id, title:t.title, destination:t.destination, region:t.region,
            author:t.author_name, date:t.date, duration:t.duration, travelers:t.travelers,
            tags:t.tags||[], loves:t.loves, doNext:t.do_next,
            airfare:t.airfare||[], hotels:t.hotels||[], restaurants:t.restaurants||[],
            bars:t.bars||[], activities:t.activities||[], days:t.days||[],
            image:t.image??null, userId:t.user_id||null, featured:t.featured||false, focalPoint:t.focal_point||{x:50,y:50}, gallery:t.gallery||[]
          }));
          setDbTrips(mapped);
          try { localStorage.setItem("tc_trips_cache", JSON.stringify(mapped)); } catch {}
        }
        setTripsLoading(false);
      });
  };

  useEffect(() => {
    fetchTrips();
    trackEvent("page_view", { path: window.location.pathname });
  }, []);

  const openTrip = (trip) => { setSelected(trip); window.history.pushState(null, "", `/trip/${trip.id}`); trackEvent("trip_view", { trip_id: String(trip.id), title: trip.title, region: trip.region }); };
  const closeTrip = () => { setSelected(null); window.history.pushState(null, "", "/"); window.__closeTripModal = null; };
  useEffect(() => { window.__closeTripModal = selected ? closeTrip : null; }, [selected]);

  const allTrips = [...dbTrips, ...trips];

  // On first load, open trip modal if server injected __INITIAL_TRIP_ID__
  useEffect(() => {
    const id = window.__INITIAL_TRIP_ID__;
    if (!id) return;
    const found = allTrips.find(t => String(t.id) === id || slugify(t.title) === id);
    if (found) { window.__INITIAL_TRIP_ID__ = null; setSelected(found); }
  }, [allTrips]);

  // URL path routing for individual trips (/trip/:id)
  // Only fires on actual browser back/forward — not on every allTrips update
  useEffect(() => {
    window.__openTrip = (trip) => setSelected(trip);
    const handlePath = () => {
      const m = window.location.pathname.match(/^\/trip\/(.+)/);
      if (m && allTrips.length > 0) {
        const found = allTrips.find(t => String(t.id) === m[1] || slugify(t.title) === m[1]);
        if (found) setSelected(found);
      } else if (!m) {
        // URL is now /, make sure modal is closed
        setSelected(null);
      }
    };
    window.addEventListener("popstate", handlePath);
    return () => window.removeEventListener("popstate", handlePath);
  }, [allTrips]);

  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [currentDisplayName, setCurrentDisplayName] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  // Check for draft when user logs in
  useEffect(() => {
    if (!currentUser) { setHasDraft(false); return; }
    supabase.from("drafts").select("id").eq("user_id", currentUser.id).maybeSingle()
      .then(({ data }) => setHasDraft(!!data));
  }, [currentUser]);

  // Detect Supabase password reset redirect
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      // Let Supabase process the hash tokens first, then show reset form
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          setShowResetPassword(true);
          window.history.replaceState(null, "", window.location.pathname);
        }
      });
    }
  }, []);
  const [viewingProfile, setViewingProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle()
          .then(({ data }) => {
            setCurrentUser(session.user);
            setCurrentDisplayName(data?.display_name || session.user.email);
          });
      }
    });
  }, []);

  const handleAuthSuccess = ({ user, displayName }) => {
    setCurrentUser(user);
    setCurrentDisplayName(displayName);
    setShowAuth(false);
    if (pendingSubmit) { setPendingSubmit(false); setShowSubmit(true); }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setCurrentDisplayName("");
    setViewingProfile(null);
  };

  // Admin state
  const isAdminUrl = window.location.pathname === "/admin" || window.location.hash === "#admin";
  const [showAdminLogin, setShowAdminLogin] = useState(isAdminUrl);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Trigger admin login if navigated to #admin after mount
  useEffect(() => {
    const checkAdmin = () => {
      if (window.location.hash === "#admin" && !isAdmin) setShowAdminLogin(true);
    };
    checkAdmin();
    window.addEventListener("hashchange", checkAdmin);
    return () => window.removeEventListener("hashchange", checkAdmin);
  }, [isAdmin]);
  const handleAdminLogin = () => { setIsAdmin(true); setShowAdminLogin(false); };
  const [showLegal, setShowLegal] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showMoreTags, setShowMoreTags] = useState(false);
  useEffect(() => { window.__setShowLegal = setShowLegal; }, []);
  const [editingTrip, setEditingTrip] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleSaveTrip = async (updated) => {
    if (!isAdmin) {
      const result = runContentFilter(updated);
      if (!result.passed) {
        alert("Your edit contains flagged content and could not be saved: " + result.flags.join(", "));
        return;
      }
    }
    const payload = {
      title: updated.title, destination: updated.destination, region: updated.region,
      author_name: updated.author,
      date: updated.date, duration: updated.duration, travelers: updated.travelers,
      tags: updated.tags, loves: updated.loves, do_next: updated.doNext,
      airfare: updated.airfare, hotels: updated.hotels, restaurants: updated.restaurants,
      bars: updated.bars, activities: updated.activities, days: updated.days,
      image: updated.image || "", featured: updated.featured || false, focal_point: updated.focalPoint || {x:50,y:50}, gallery: updated.gallery || []
    };
    // Retry up to 3 times on failure
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { error } = await supabase.from("trips").update(payload).eq("id", updated.id);
        if (error) throw error;
        setTrips(p => p.map(t => t.id === updated.id ? updated : t));
        setDbTrips(p => p.map(t => t.id === updated.id ? updated : t));
        setEditingTrip(null);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    alert("Save failed after 3 attempts. Please check your connection and try again. Your changes are still in the form.");
  };
  const handleDeleteTrip = async (id) => {
    await supabase.from("trips").delete().eq("id", id);
    setTrips(p => p.filter(t => t.id !== id));
    setDbTrips(p => p.filter(t => t.id !== id));
    setConfirmDelete(null);
  };

  const filtered = useMemo(() => {
    const f = allTrips.filter(t =>
      (!search || [t.title,t.destination,t.travelers,t.loves].some(s=>s.toLowerCase().includes(search.toLowerCase()))) &&
      (region==="All Regions"||t.region===region) &&
      (tag==="All"||tag==="__bookmarks__"?true:t.tags.includes(tag)) &&
      (tag!=="__bookmarks__"||bookmarks.includes(t.id)) &&
      matchesDuration(t, duration)
    );
    if (sortBy === "submitter") f.sort((a,b) => a.author.localeCompare(b.author));
    else if (sortBy === "destination") f.sort((a,b) => a.destination.localeCompare(b.destination));
    else if (sortBy === "duration") f.sort((a,b) => parseInt(a.duration)||0 - (parseInt(b.duration)||0));
    return f;
  }, [dbTrips, trips, search, region, tag, sortBy, duration, bookmarks]);

  return (
    <div style={{ minHeight:"100vh", background:C.seafoam, fontFamily:"'Nunito',system-ui,sans-serif", overflowX:"hidden" }}>
      <GlobalStyles />
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,700&family=Nunito:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Admin banner */}
      {isAdmin && (
        <div style={{ background:`linear-gradient(90deg,${C.slate},${C.slateLight})`, padding:"8px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:"12px", fontWeight:700, color:C.white, display:"flex", alignItems:"center", gap:"8px" }}>
            <span>🔐</span> Admin Mode Active — you can edit, delete and add trips
          </div>
          <button onClick={() => setIsAdmin(false)} style={{ fontSize:"11px", fontWeight:700, color:C.white, background:"rgba(255,255,255,0.2)", border:"none", borderRadius:"6px", padding:"4px 12px", cursor:"pointer" }}>Exit Admin</button>
        </div>
      )}

      {/* Beta banner */}
      <div style={{ background:`linear-gradient(135deg, #1C2B3A 0%, #2E4A3E 60%, #C1692A 100%)`, padding:"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px", flex:1, minWidth:0 }}>
          <span style={{ fontSize:"16px", flexShrink:0 }}>🐾</span>
          <p style={{ margin:0, fontSize:"12px", color:"rgba(255,255,255,0.92)", lineHeight:1.5 }}>
            <strong style={{ color:C.cta }}>Welcome to the TripCopycat Beta!</strong> We're currently building the world's first travel blueprint library. If you find a bug or have a suggestion, we'd love your feedback as we grow.
          </p>
        </div>
        <button onClick={() => setShowFeedback(true)} style={{ flexShrink:0, padding:"7px 16px", borderRadius:"20px", border:"1px solid rgba(196,168,130,0.6)", background:"rgba(196,168,130,0.15)", color:C.cta, fontSize:"12px", fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", transition:"background-color .15s ease, box-shadow .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease" }}
          className="tc-btn-ghost">
          Provide Feedback →
        </button>
      </div>

      {/* Nav */}
      <nav style={{ background:C.white, borderBottom:`1px solid ${C.tide}`, padding:"0", margin:"0", position:"sticky", top:0, zIndex:100, boxShadow:`0 1px 6px rgba(28,43,58,0.06)` }}>
        <div style={{ width:"100%", padding:"0 16px", boxSizing:"border-box", display:"flex", alignItems:"center", justifyContent:"space-between", height:"58px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <img src="/copycat.svg" alt="TripCopycat" style={{ height:"44px", width:"44px", objectFit:"contain", background:"transparent", display:"block", mixBlendMode:"multiply" }} />
            <span style={{ fontFamily:"'Playfair Display',Georgia,serif", fontWeight:700, fontSize:"22px", color:C.slate, letterSpacing:"-0.01em" }}>TripCopycat<sup style={{ fontSize:"10px", fontWeight:700, verticalAlign:"super", letterSpacing:0 }}>™</sup></span>
            <span style={{ fontSize:"9px", background:C.seafoamDeep, color:C.azureDeep, fontWeight:700, padding:"2px 7px", borderRadius:"20px", border:`1px solid ${C.tide}` }}>beta</span>
          </div>
          <div style={{ display:"flex", gap:"7px" }}>
            {!isAdmin && <button onClick={() => openSubmit()} style={{ background:"transparent", color:C.slate, border:`1.5px solid ${C.slate}`, borderRadius:"6px", padding:isMobile?"6px 10px":"6px 14px", fontSize:"11px", fontWeight:500, cursor:"pointer", whiteSpace:"nowrap", position:"relative" }}>
              {isMobile ? "+" : "+ Submit a Trip"}
              {hasDraft && <span style={{ position:"absolute", top:"-4px", right:"-4px", width:"8px", height:"8px", borderRadius:"50%", background:C.amber, border:`1.5px solid ${C.white}` }} />}
            </button>}
            {isAdmin && <button onClick={() => setShowAnalytics(true)} style={{ background:"rgba(91,143,185,0.12)", color:C.azureDeep, border:`1px solid ${C.azure}44`, borderRadius:"8px", padding:"7px 14px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>📊 Analytics</button>}
            {isAdmin && <button onClick={() => setShowQueue(true)} style={{ background:C.amberBg, color:C.amber, border:`1px solid ${C.amber}44`, borderRadius:"8px", padding:"7px 14px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>📋 Queue</button>}
            {isAdmin && <button onClick={() => setShowImport(true)} style={{ background:C.seafoam, color:C.slateMid, border:`1px solid ${C.tide}`, borderRadius:"8px", padding:"7px 14px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>🤖 Import</button>}
            {isAdmin && <button onClick={() => setShowAdd(true)} style={{ background:C.cta, color:C.ctaText, border:"none", borderRadius:"8px", padding:"7px 16px", fontSize:"12px", fontWeight:700, cursor:"pointer" }}>+ Add</button>}
            {!isAdmin && !currentUser && <button onClick={() => setShowAuth(true)} style={{ background:C.seafoam, color:C.slateMid, border:`1px solid ${C.tide}`, borderRadius:"8px", padding:"7px 14px", fontSize:"12px", fontWeight:600, cursor:"pointer" }}>Sign In</button>}
            {!isAdmin && currentUser && (
              <button onClick={() => setViewingProfile(currentDisplayName)} style={{ background:C.seafoam, border:`1px solid ${C.tide}`, borderRadius:"50%", padding:"4px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", width:"32px", height:"32px", flexShrink:0 }}>
                <span style={{ width:"22px", height:"22px", borderRadius:"50%", background:C.cta, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:"11px", fontWeight:800, color:C.ctaText }}>{currentDisplayName.charAt(0).toUpperCase()}</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero — Warm Nomad */}
      <div style={{ background:C.seafoam, padding:"16px 0 14px", margin:"0", textAlign:"center", position:"relative", overflow:"hidden", borderBottom:`1px solid ${C.tide}` }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle at 20% 50%, rgba(196,168,130,0.08) 0%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(193,105,42,0.06) 0%, transparent 50%)", pointerEvents:"none" }} />
        {!isMobile && (
          <div style={{ position:"absolute", left:"28px", top:"50%", transform:"translateY(-50%)", zIndex:10 }}>
            <button onClick={() => setShowHowItWorks(true)} className="tc-btn" style={{ width:"120px", background:C.amber, border:"none", borderRadius:"12px", cursor:"pointer", padding:"16px 12px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"6px", boxShadow:"0 3px 14px rgba(193,105,42,0.3)", fontFamily:"'Nunito',sans-serif" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 4C11.582 4 8 7.582 8 12c0 2.8 1.4 5.274 3.556 6.8L12 22h8l.444-3.2C22.6 17.274 24 14.8 24 12c0-4.418-3.582-8-8-8z" fill="white"/>
                <rect x="12" y="22" width="8" height="2" rx="1" fill="white"/>
                <rect x="13" y="25" width="6" height="2" rx="1" fill="white"/>
                <rect x="14" y="28" width="4" height="1.5" rx="0.75" fill="rgba(255,255,255,0.6)"/>
              </svg>
              <div style={{ fontSize:"11px", fontWeight:700, color:"#fff", lineHeight:1.3, textAlign:"center" }}>How Does<br/>This Work?</div>
              <div style={{ fontSize:"9px", fontWeight:600, color:"rgba(255,255,255,0.8)", lineHeight:1.3, textAlign:"center" }}>Browse · Submit<br/>Unlock Blueprint</div>
            </button>
          </div>
        )}

        <div style={{ position:"relative", maxWidth:"680px", margin:"0 auto", padding:"0 16px" }}>
          <h1 style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:"clamp(22px,4.5vw,46px)", fontWeight:700, color:C.slate, margin:"0 0 10px", lineHeight:1.15, letterSpacing:"-0.01em" }}>
            Planned by others. Perfected by you.
          </h1>
          <div style={{ display:"flex", gap:"10px", justifyContent:"center", alignItems:"center", flexWrap:"wrap", marginBottom:"12px" }}>
            <button onClick={() => openSubmit()} style={{ background:C.amber, color:"#fff", border:`2px solid ${C.amber}`, borderRadius:"6px", padding:"9px 20px", fontSize:"13px", fontWeight:700, cursor:"pointer", fontFamily:"'Nunito',sans-serif" }}>
              Submit a Trip →
            </button>
            <button onClick={() => { window.location.href = "/blueprint/sample"; }} style={{ background:"transparent", color:C.amber, border:`2px solid ${C.amber}`, borderRadius:"6px", padding:"9px 18px", fontSize:"13px", fontWeight:700, cursor:"pointer", fontFamily:"'Nunito',sans-serif", display:"inline-flex", alignItems:"center", gap:"6px" }}>
              <span style={{ fontSize:"11px" }}>▲</span>
              Sample Blueprint
              <span style={{ background:C.amber, color:"#fff", fontSize:"9px", fontWeight:700, padding:"1px 6px", borderRadius:"20px" }}>FREE</span>
            </button>
          </div>
          <div style={{ maxWidth:"500px", margin:"0 auto", position:"relative" }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search destinations, trips, activities…" style={{ width:"100%", padding:"10px 18px 10px 42px", borderRadius:"50px", border:`1.5px solid ${C.tide}`, fontSize:"13px", outline:"none", boxSizing:"border-box", background:C.white, color:C.slate, boxShadow:`0 2px 12px rgba(28,43,58,0.07)`, fontFamily:"'Nunito',sans-serif" }} />
            <span style={{ position:"absolute", left:"14px", top:"50%", transform:"translateY(-50%)", fontSize:"14px" }}>🔍</span>
          </div>
          {isMobile && (
            <button onClick={() => setShowHowItWorks(true)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", maxWidth:"500px", margin:"10px auto 0", padding:"11px 18px", background:C.slate, borderRadius:"10px", border:"none", cursor:"pointer", fontFamily:"'Nunito',sans-serif", textAlign:"left" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <div style={{ width:"28px", height:"28px", borderRadius:"50%", background:"rgba(255,255,255,0.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M16 4C11.582 4 8 7.582 8 12c0 2.8 1.4 5.274 3.556 6.8L12 22h8l.444-3.2C22.6 17.274 24 14.8 24 12c0-4.418-3.582-8-8-8z" fill="white"/>
                      <rect x="12" y="22" width="8" height="2" rx="1" fill="white"/>
                      <rect x="13" y="25" width="6" height="2" rx="1" fill="white"/>
                      <rect x="14" y="28" width="4" height="1.5" rx="0.75" fill="rgba(255,255,255,0.6)"/>
                    </svg>
                  </div>
                <div>
                  <div style={{ fontSize:"12px", fontWeight:700, color:"#fff", lineHeight:1.2 }}>How Does This Work?</div>
                  <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.6)", marginTop:"2px" }}>Browse trips · Submit yours · Unlock a Blueprint</div>
                </div>
              </div>
              <span style={{ color:C.cta, fontSize:"16px", fontWeight:700, flexShrink:0 }}>→</span>
            </button>
          )}
        </div>
      </div>

      {/* Main layout — sidebar + grid */}
      <div style={{ maxWidth:"100%", padding:"20px 16px", display:"flex", gap:"24px", alignItems:"flex-start", boxSizing:"border-box" }}>

        {/* Left Sidebar */}
        {sidebarOpen && (
          <aside style={{ width:"220px", flexShrink:0, position:"sticky", top:"68px" }}>
            {/* Collapse button */}
            <button onClick={() => setSidebarOpen(false)} style={{ width:"100%", padding:"7px 12px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.muted, fontSize:"11px", fontWeight:600, cursor:"pointer", marginBottom:"14px", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span>Hide sidebar</span><span>←</span>
            </button>

            {/* Trip type filter */}
            <div style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, padding:"14px 16px", marginBottom:"14px", boxShadow:`0 1px 4px rgba(44,62,80,0.05)` }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"10px" }}>Trip Type</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                {(showMoreTags ? TAGS : PRIMARY_TAGS).map(t => (
                  <button key={t} onClick={() => setTag(t)} className="tc-tag" style={{ padding:"3px 9px", borderRadius:"20px", border:`1px solid ${tag===t?C.slate:C.tide}`, background:tag===t?C.slate:C.white, color:tag===t?C.white:C.slateLight, fontSize:"10px", fontWeight:600, cursor:"pointer", transition:"background-color .12s ease, border-color .12s ease, color .12s ease" }}>{t}</button>
                ))}
              </div>
              <button onClick={() => setShowMoreTags(p=>!p)} style={{ marginTop:"8px", fontSize:"10px", fontWeight:700, color:C.amber, background:"none", border:"none", cursor:"pointer", padding:"2px 0" }}>
                {showMoreTags ? "▲ Show less" : `▼ More types (${EXTENDED_TAGS.length})`}
              </button>
            </div>

            {/* Region filter */}
            <div style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, padding:"14px 16px", marginBottom:"14px", boxShadow:`0 1px 4px rgba(44,62,80,0.05)` }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"10px" }}>Region</div>
              {REGIONS.map(r => (
                <button key={r} onClick={() => setRegion(r)} style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", borderRadius:"7px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:region===r?700:400, background:region===r?C.sandDeep:"transparent", color:region===r?C.slate:C.slateLight, marginBottom:"2px", transition:"background-color .12s ease, border-color .12s ease, color .12s ease" }}>
                  {region===r && <span style={{ color:C.amber, marginRight:"5px" }}>▸</span>}{r}
                </button>
              ))}
            </div>

            {/* Duration filter */}
            <div style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, padding:"14px 16px", marginBottom:"14px", boxShadow:`0 1px 4px rgba(44,62,80,0.05)` }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"10px" }}>Trip Length</div>
              {DURATION_FILTERS.map(d => (
                <button key={d} onClick={() => setDuration(d)} style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", borderRadius:"7px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:duration===d?700:400, background:duration===d?C.sandDeep:"transparent", color:duration===d?C.slate:C.slateLight, marginBottom:"2px", transition:"background-color .12s ease, border-color .12s ease, color .12s ease" }}>
                  {duration===d && <span style={{ color:C.amber, marginRight:"5px" }}>▸</span>}{d}
                </button>
              ))}
            </div>

            {/* Top contributors */}
            <div style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, padding:"14px 16px", marginBottom:"14px", boxShadow:`0 1px 4px rgba(44,62,80,0.05)` }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"10px" }}>Top Contributors</div>
              {[...allTrips.reduce((acc, t) => { acc.set(t.author, (acc.get(t.author)||0)+1); return acc; }, new Map())].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([author, count]) => (
                <div key={author} onClick={() => setViewingProfile(author)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", cursor:"pointer", borderBottom:`1px solid ${C.seafoamDeep}` }}
                  >
                  <div style={{ display:"flex", alignItems:"center", gap:"7px" }}>
                    <div style={{ width:"22px", height:"22px", borderRadius:"50%", background:C.cta, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"10px", fontWeight:800, color:C.ctaText, flexShrink:0 }}>{author.charAt(0).toUpperCase()}</div>
                    <span style={{ fontSize:"12px", color:C.amber, fontWeight:600 }}>{author}</span>
                  </div>
                  <span style={{ fontSize:"10px", color:C.muted }}>{count} trip{count!==1?"s":""}</span>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{ background:C.white, borderRadius:"12px", border:`1px solid ${C.tide}`, padding:"14px 16px", boxShadow:`0 1px 4px rgba(44,62,80,0.05)` }}>
              <div style={{ fontSize:"10px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"10px" }}>Platform</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                <span style={{ fontSize:"12px", color:C.slateLight }}>Itineraries</span>
                <strong style={{ fontSize:"12px", color:C.slate }}>{allTrips.length}</strong>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"14px" }}>
                <span style={{ fontSize:"12px", color:C.slateLight }}>Contributors</span>
                <strong style={{ fontSize:"12px", color:C.slate }}>{[...new Set(allTrips.map(t=>t.author))].length}</strong>
              </div>
              <button onClick={() => openSubmit()} style={{ width:"100%", padding:"9px", borderRadius:"6px", border:`1.5px solid ${C.slate}`, background:"transparent", color:C.slate, fontSize:"12px", fontWeight:500, cursor:"pointer" }}>+ Submit a Trip</button>
            </div>
          </aside>
        )}

        {/* Expand sidebar button when collapsed */}
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} style={{ position:"fixed", left:"16px", top:"50%", transform:"translateY(-50%)", zIndex:50, background:C.white, border:`1px solid ${C.tide}`, borderRadius:"8px", padding:"8px 6px", cursor:"pointer", fontSize:"11px", color:C.muted, boxShadow:`0 2px 8px rgba(44,62,80,0.1)`, writingMode:"vertical-rl" }}>
            Filters →
          </button>
        )}

        {/* Main content */}
        <main id="trip-grid" style={{ flex:1, minWidth:0 }}>
          {/* Bookmarks bar */}
          {bookmarks.length > 0 && (
            <div style={{ marginBottom:"12px", display:"flex", alignItems:"center", gap:"8px" }}>
              <button onClick={() => setTag("__bookmarks__")} style={{ padding:"4px 12px", borderRadius:"20px", border:`1px solid ${tag==="__bookmarks__"?C.amber:C.tide}`, background:tag==="__bookmarks__"?C.amberBg:C.white, color:tag==="__bookmarks__"?C.amber:C.slateLight, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>
                🔖 My Saved Trips ({bookmarks.length})
              </button>
              {tag==="__bookmarks__" && <button onClick={() => setTag("All")} style={{ fontSize:"11px", color:C.muted, background:"none", border:"none", cursor:"pointer" }}>× Clear</button>}
            </div>
          )}

          {/* Gear We Love banner */}
          {isMobile ? (
            <div onClick={() => { setShowGear(true); window.history.pushState(null, "", "/gear"); }} style={{ background:C.slate, borderRadius:"10px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"16px", cursor:"pointer", border:`1px solid rgba(196,168,130,0.2)` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <img src="/backpack-icon.png" alt="" style={{ width:"22px", height:"22px", objectFit:"contain" }} />
                <div>
                  <div style={{ fontSize:"13px", fontWeight:700, color:"#FAF7F2", fontFamily:"'Playfair Display',Georgia,serif" }}>Gear We Love</div>
                  <div style={{ fontSize:"10px", color:"rgba(196,168,130,0.8)" }}>Tested travel essentials from real trips</div>
                </div>
              </div>
              <span style={{ fontSize:"12px", color:"#C1692A", fontWeight:700 }}>Browse →</span>
            </div>
          ) : (
            <div onClick={() => { setShowGear(true); window.history.pushState(null, "", "/gear"); }} style={{ background:C.slate, backgroundImage:"radial-gradient(rgba(196,168,130,0.12) 1px,transparent 1px)", backgroundSize:"12px 12px", borderRadius:"12px", padding:"20px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"20px", cursor:"pointer", border:`1px solid rgba(196,168,130,0.2)` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"18px" }}>
                <img src="/backpack-icon.png" alt="" style={{ width:"40px", height:"40px", objectFit:"contain" }} />
                <div>
                  <div style={{ fontSize:"16px", fontWeight:800, color:"#FAF7F2", fontFamily:"'Playfair Display',Georgia,serif", marginBottom:"4px" }}>Gear We Love</div>
                  <div style={{ fontSize:"12px", color:"rgba(196,168,130,0.85)" }}>Handpicked travel essentials from real family trips — personally tested.</div>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); setShowGear(true); window.history.pushState(null, "", "/gear"); }} style={{ background:"#C1692A", color:"#FAF7F2", border:"none", borderRadius:"8px", padding:"10px 20px", fontSize:"12px", fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", fontFamily:"inherit", flexShrink:0 }}>Browse now →</button>
            </div>
          )}

          {/* Featured section — only show when no active filters */}
          {!search && region==="All Regions" && tag==="All" && duration==="Any Length" && sortBy==="default" && (() => {
            const featuredTrips = allTrips.filter(t => t.featured);
            if (!featuredTrips.length) return null;
            return (
              <div style={{ marginBottom:"32px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"16px" }}>
                  <span style={{ fontSize:"16px" }}>✦</span>
                  <div style={{ fontSize:"13px", fontWeight:800, color:C.slate, fontFamily:"'Playfair Display',serif", letterSpacing:"0.02em" }}>Featured Itineraries</div>
                  <div style={{ flex:1, height:"1px", background:C.tide }} />
                  <span style={{ fontSize:"10px", color:C.muted, fontWeight:600 }}>Editor's Picks</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))", gap:"18px" }}>
                  {featuredTrips.map(trip => (
                    <div key={trip.id} style={{ position:"relative" }}>
                      <TripCard trip={trip} onClick={openTrip} isBookmarked={bookmarks.includes(trip.id)} onBookmark={toggleBookmark} />
                      {isAdmin && (
                        <div style={{ position:"absolute", top:"12px", right:"12px", display:"flex", gap:"6px", zIndex:10 }}>
                          <button onClick={e => { e.stopPropagation(); setEditingTrip(trip); }} style={{ padding:"5px 10px", borderRadius:"7px", border:"none", background:C.azure, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>✏️</button>
                          <button onClick={async e => { e.stopPropagation(); await supabase.from("trips").update({ featured: !trip.featured }).eq("id", trip.id); fetchTrips(); }} style={{ padding:"5px 10px", borderRadius:"7px", border:"none", background:trip.featured?"#C4A882":"transparent", color:trip.featured?"#fff":"rgba(196,168,130,0.4)", fontSize:"13px", fontWeight:700, cursor:"pointer", border:trip.featured?"none":"1px dashed rgba(196,168,130,0.35)" }}>✦</button>
                          <button onClick={e => { e.stopPropagation(); setConfirmDelete(trip); }} style={{ padding:"5px 10px", borderRadius:"7px", border:"none", background:C.red, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>🗑️</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* All itineraries */}
          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"14px", flexWrap:"wrap" }}>
            <div style={{ fontSize:"12px", color:C.muted }}>
              <strong style={{ color:C.slate }}>{filtered.length}</strong> itinerar{filtered.length!==1?"ies":"y"}{search&&<> for "<strong style={{ color:C.slate }}>{search}</strong>"</>}
            </div>
            <div style={{ flex:1 }} />
            {(region !== "All Regions" || tag !== "All" || duration !== "Any Length") && (
              <button onClick={() => { setRegion("All Regions"); setTag("All"); setDuration("Any Length"); }} style={{ fontSize:"11px", color:C.amber, background:"none", border:"none", cursor:"pointer", fontWeight:600 }}>Clear filters ×</button>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
              <span style={{ fontSize:"11px", color:C.muted }}>Sort:</span>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ fontSize:"11px", fontWeight:600, color:C.slate, border:`1px solid ${C.tide}`, borderRadius:"6px", padding:"3px 7px", background:C.white, cursor:"pointer", outline:"none", fontFamily:"inherit" }}>
                <option value="default">Default</option>
                <option value="submitter">By Submitter</option>
                <option value="destination">By Destination</option>
                <option value="duration">By Duration</option>
              </select>
            </div>
          </div>

          {!search && region==="All Regions" && tag==="All" && duration==="Any Length" && sortBy==="default" && allTrips.some(t => t.featured) && (
            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"14px" }}>
              <div style={{ flex:1, height:"1px", background:C.tide }} />
              <span style={{ fontSize:"11px", fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em" }}>All Itineraries</span>
              <div style={{ flex:1, height:"1px", background:C.tide }} />
            </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))", gap:"18px" }}>
            {filtered.map(trip => (
              <div key={trip.id} style={{ position:"relative" }}>
                <TripCard trip={trip} onClick={openTrip} isBookmarked={bookmarks.includes(trip.id)} onBookmark={toggleBookmark} />
                {isAdmin && (
                  <div style={{ position:"absolute", top:"12px", right:"12px", display:"flex", gap:"6px", zIndex:10 }}>
                    <button onClick={e => { e.stopPropagation(); setEditingTrip(trip); }} style={{ padding:"5px 10px", borderRadius:"7px", border:"none", background:C.azure, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>✏️</button>
                    <button onClick={async e => { e.stopPropagation(); await supabase.from("trips").update({ featured: !trip.featured }).eq("id", trip.id); fetchTrips(); }} style={{ padding:"5px 10px", borderRadius:"7px", border:"none", background:trip.featured?"#C4A882":"transparent", color:trip.featured?"#fff":"rgba(196,168,130,0.4)", fontSize:"13px", fontWeight:700, cursor:"pointer", border:trip.featured?"none":"1px dashed rgba(196,168,130,0.35)" }}>✦</button>
                    <button onClick={e => { e.stopPropagation(); setConfirmDelete(trip); }} style={{ padding:"5px 10px", borderRadius:"7px", border:"none", background:C.red, color:C.white, fontSize:"11px", fontWeight:700, cursor:"pointer" }}>🗑️</button>
                  </div>
                )}
              </div>
            ))}
            {tripsLoading && (
              <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 20px", color:C.muted }}>
                <div style={{ fontSize:"32px", marginBottom:"12px" }}>🐾</div>
                <div style={{ fontSize:"14px", fontWeight:600, color:C.slateLight }}>Loading itineraries…</div>
              </div>
            )}
            {!tripsLoading && filtered.length===0 && (
              <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 20px", color:C.muted }}>
                <div style={{ fontSize:"38px", marginBottom:"12px" }}>✈️</div>
                <div style={{ fontSize:"15px", fontWeight:600, color:C.slateLight }}>No itineraries match your search</div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="tc-modal-overlay" style={{ position:"fixed", inset:0, background:"rgba(44,62,80,0.75)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)" }}>
          <div className="tc-modal-card" style={{ background:C.white, borderRadius:"16px", padding:"32px", maxWidth:"400px", width:"90%", textAlign:"center", boxShadow:`0 32px 64px rgba(44,62,80,0.25)` }}>
            <div style={{ fontSize:"32px", marginBottom:"12px" }}>🗑️</div>
            <div style={{ fontSize:"17px", fontWeight:800, color:C.slate, marginBottom:"8px" }}>Delete this itinerary?</div>
            <div style={{ fontSize:"13px", color:C.slateLight, marginBottom:"24px" }}>"{confirmDelete.title}" will be permanently removed.</div>
            <div style={{ display:"flex", gap:"10px" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex:1, padding:"10px", borderRadius:"8px", border:`1px solid ${C.tide}`, background:C.white, color:C.slateLight, fontWeight:600, cursor:"pointer" }}>Cancel</button>
              <button onClick={() => handleDeleteTrip(confirmDelete.id)} style={{ flex:1, padding:"10px", borderRadius:"8px", border:"none", background:C.red, color:C.white, fontWeight:700, cursor:"pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} onSubmit={openSubmit} />}
      {showGear     && <GearPage onClose={() => { setShowGear(false); window.history.pushState(null, "", "/"); }} />}
      {selected      && <TripModal trip={selected} onClose={closeTrip} allTrips={allTrips} isBookmarked={bookmarks.includes(selected.id)} onBookmark={toggleBookmark} isAdmin={isAdmin} />}
      {showAdd       && <AddTripModal onClose={() => setShowAdd(false)} onAdd={t => setTrips(p=>[t,...p])} />}
      {showImport    && <SmartImportHub onClose={() => setShowImport(false)} onPhotoComplete={(data) => { setPhotoImportData(data); setShowImport(false); openSubmit(); }} />}
      {showSubmit    && <SubmitTripModal onClose={() => { setShowSubmit(false); setPhotoImportData(null); }} currentUser={currentUser} displayName={currentDisplayName} onSubmitSuccess={fetchTrips} prefillData={photoImportData} />}
      {showAuth      && <AuthModal onClose={() => setShowAuth(false)} onSuccess={handleAuthSuccess} />}
      {showResetPassword && <ResetPasswordModal onClose={() => setShowResetPassword(false)} />}
      {viewingProfile && <ProfilePage authorName={viewingProfile} allTrips={allTrips} onClose={() => setViewingProfile(null)} onTripClick={openTrip} currentUser={currentUser} onEditTrip={(trip) => setEditingTrip(trip)} onDeleteTrip={(trip) => setConfirmDelete(trip)} />}
      {showQueue     && <AdminQueueModal onClose={() => setShowQueue(false)} onApprove={fetchTrips} />}
      {showAdminLogin && <AdminLoginModal onSuccess={handleAdminLogin} onClose={() => setShowAdminLogin(false)} />}
      {editingTrip   && <AdminEditModal trip={editingTrip} onSave={handleSaveTrip} onClose={() => setEditingTrip(null)} />}
      {showAnalytics && <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />}
      {showLegal     && <LegalModal onClose={() => setShowLegal(false)} />}
      {showFeedback  && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {/* Floating feedback button — bottom-left on mobile to avoid covering trip cards */}
      <button onClick={() => setShowFeedback(true)}
        style={{ position:"fixed", bottom:"20px", left:isMobile?"16px":"auto", right:isMobile?"auto":"24px", zIndex:500, background:`linear-gradient(135deg, #1C2B3A, #C1692A)`, color:C.white, border:"none", borderRadius:"50px", padding:isMobile?"9px 14px":"11px 20px", fontSize:isMobile?"11px":"12px", fontWeight:700, cursor:"pointer", boxShadow:`0 4px 18px rgba(28,43,58,0.35)`, display:"flex", alignItems:"center", gap:"6px", transition:"transform .15s" }}
        >
        {isMobile ? "💬" : "💬 Feedback"}
      </button>

      {/* Site footer */}
      <footer style={{ borderTop:`1px solid ${C.tide}`, background:C.white, padding:"16px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"40px" }}>
        <span style={{ fontSize:"11px", color:C.muted }}>© {new Date().getFullYear()} TripCopycat™. All rights reserved.</span>
        <button onClick={() => setShowLegal(true)} style={{ fontSize:"11px", color:C.muted, background:"none", border:"none", cursor:"pointer", textDecoration:"underline", fontFamily:"inherit" }}>Terms of Service</button>
      </footer>
    </div>
  );
}
