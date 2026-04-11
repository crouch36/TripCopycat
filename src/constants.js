// ── Shared Constants & Design Tokens ─────────────────────────────────────────
// Imported by App.jsx, SubmitTripModal.jsx, SubmitFormStep.jsx,
// PhotoImportModal.jsx, and any future split components.

// ── Warm Nomad Design Tokens ──────────────────────────────────────────────────
// Primary:   Deep Navy    #1C2B3A  (headings, nav text, hero type)
// Secondary: Warm Sand    #C4A882  (CTA buttons, accents)
// Surface:   Cream        #FAF7F2  (page bg)
// Card:      Off-White    #FFFFFF  (card bg)
// Border:    Linen        #E8DDD0  (borders, dividers)
// Accent:    Terracotta   #C1692A  (tags, highlights)
// Font:      Playfair Display (display) + Nunito (body)

export const C = {
  azure:       "#C4A882",
  azureDeep:   "#A8896A",
  azureDark:   "#1C2B3A",
  cerulean:    "#1C2B3A",
  sand:        "#F0E8DC",
  sandDeep:    "#E8DDD0",
  sandBorder:  "#D4C4B0",
  seafoam:     "#FAF7F2",
  seafoamDeep: "#F0E8DC",
  white:       "#FFFFFF",
  tide:        "#E8DDD0",
  tideDeep:    "#D4C4B0",
  slate:       "#1C2B3A",
  slateMid:    "#3D2B1F",
  slateLight:  "#6B4F3A",
  muted:       "#A89080",
  mutedLight:  "#C4AFA0",
  green:       "#7A9E5A",
  greenBg:     "#EEF5E8",
  amber:       "#C1692A",
  amberBg:     "#FDF0E6",
  red:         "#B03A2E",
  redBg:       "#FDECEA",
  cta:         "#C4A882",
  ctaText:     "#1C2B3A",
  ctaHover:    "#A8896A",
};

export const REGIONS = ["All Regions","Asia","Europe","Central America","North America","South America","Africa","Oceania"];

export const PRIMARY_TAGS  = ["All","family-friendly","romantic","adventure","food & wine","culture","beach","wildlife","scenic drives"];
export const EXTENDED_TAGS = ["solo","girls trip","guys trip","road trip","city break","ski & snow","national parks","budget","luxury","off the beaten path","hiking & trekking","nightlife","history & heritage","wellness & spa","bachelor/bachelorette","group travel","long weekend","kid-free"];
export const TAGS = [...PRIMARY_TAGS, ...EXTENDED_TAGS];

export const REGION_GRADIENTS = {
  "Asia":           "linear-gradient(135deg, #C84B31 0%, #ECAB51 100%)",
  "Europe":         "linear-gradient(135deg, #2C3E7A 0%, #5B7FBF 100%)",
  "North America":  "linear-gradient(135deg, #1A6B3C 0%, #4CAF7D 100%)",
  "Central America":"linear-gradient(135deg, #7B3FA0 0%, #C47DD4 100%)",
  "South America":  "linear-gradient(135deg, #B5451B 0%, #E8903A 100%)",
  "Africa":         "linear-gradient(135deg, #8B6914 0%, #D4A843 100%)",
  "Oceania":        "linear-gradient(135deg, #0E6B8C 0%, #2EBFDB 100%)",
};

export const REGION_EMOJI = {
  "Asia":"🏯", "Europe":"🏰", "North America":"🗽",
  "Central America":"🌴", "South America":"🌿",
  "Africa":"🦁", "Oceania":"🐚",
};

export const DURATION_FILTERS = ["Any Length", "Weekend (1-3 days)", "1 Week (4-7 days)", "2 Weeks (8-14 days)", "2+ Weeks (15+ days)"];

// catConfig is used by SubmitFormStep (form rows), TripModal, and buildPlainText
export const catConfig = {
  airfare:     { label: "✈️ Airfare",      color: C.azureDeep  },
  hotels:      { label: "🏨 Hotels",       color: C.cerulean   },
  restaurants: { label: "🍽️ Restaurants", color: C.red        },
  bars:        { label: "🍸 Bars",         color: C.amber      },
  activities:  { label: "🎯 Activities",   color: C.green      },
};

// typeStyles is used by DailyItinerary and TripModal
export const typeStyles = {
  hotel:      { bg: C.seafoamDeep, color: C.cerulean,  icon: "🏨" },
  restaurant: { bg: C.redBg,       color: C.red,        icon: "🍽️" },
  bar:        { bg: C.amberBg,     color: C.amber,      icon: "🍸" },
  activity:   { bg: C.greenBg,     color: C.green,      icon: "🎯" },
  transport:  { bg: "#E8F0FA",     color: C.azureDeep,  icon: "🚗" },
};
