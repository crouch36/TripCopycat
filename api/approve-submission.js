// api/approve-submission.js
// Approves a submission — inserts into trips using service role key (bypasses RLS),
// then updates submissions.status to approved.
// Protected by ADMIN_SECRET header — only callable from the admin queue.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simple shared-secret guard — same pattern as geocode-venues
  const secret = req.headers["x-admin-secret"] || "";
  if (!secret || secret !== process.env.GEOCODE_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { submissionId, tripData, submitterName, submitterEmail, userId } = body;

  if (!submissionId || !tripData) {
    return res.status(400).json({ error: "Missing submissionId or tripData" });
  }

  const t = tripData;

  // Insert into trips with service role — bypasses RLS
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("trips")
    .insert([{
      title:        t.title,
      destination:  t.destination,
      region:       t.region,
      author_name:  submitterName,
      author_email: submitterEmail,
      date:         t.date,
      duration:     t.duration,
      travelers:    t.travelers,
      tags:         t.tags || [],
      loves:        t.loves,
      do_next:      t.do_next || t.doNext || "",
      airfare:      t.airfare || [],
      hotels:       t.hotels || [],
      restaurants:  t.restaurants || [],
      bars:         t.bars || [],
      activities:   t.activities || [],
      days:         t.days || [],
      image:        t.image || null,  // || guards against empty string stored at submission time
      status:       "published",
      user_id:      userId || null,
      focal_point:  t.focalPoint || { x: 50, y: 50 },
      gallery:      t.gallery || [],
    }])
    .select("id");

  if (insertError) {
    console.error("approve-submission insert error:", insertError);
    return res.status(500).json({ error: insertError.message });
  }

  const newTripId = inserted?.[0]?.id || null;

  // Update submission status
  const { error: updateError } = await supabaseAdmin
    .from("submissions")
    .update({
      status:          "approved",
      reviewed_at:     new Date().toISOString(),
      approved_trip_id: newTripId,
    })
    .eq("id", submissionId);

  if (updateError) {
    console.error("approve-submission update error:", updateError);
    // Trip was inserted — don't fail the whole request, just log
  }

  // ── Founding Copycat check ───────────────────────────────────────────────────
  // After approval, count distinct approved authors. If ≤ 50, award founding badge.
  if (submitterEmail) {
    try {
      const { data: authorRows } = await supabaseAdmin
        .from("trips")
        .select("author_email")
        .eq("status", "published");

      const distinctAuthors = new Set((authorRows || []).map(r => r.author_email).filter(Boolean));

      if (distinctAuthors.size <= 50) {
        // Upsert founding_copycat on profiles row matching this email
        await supabaseAdmin
          .from("profiles")
          .update({ founding_copycat: true })
          .eq("email", submitterEmail);
      }
    } catch (err) {
      console.error("Founding Copycat check error:", err);
      // Non-fatal — don't fail the approval
    }
  }

  return res.status(200).json({ success: true, tripId: newTripId });
}
