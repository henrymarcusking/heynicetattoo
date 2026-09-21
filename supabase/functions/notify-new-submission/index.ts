// heynicetattoo — new-submission email notification.
//
// Fired by a Supabase Database Webhook on INSERT into public.submissions.
// Sends a plain notice (no personal details) to a fixed address, pointing
// whoever's watching at the admin review queue. Deployed via the Supabase
// dashboard (Edge Functions → Create function → paste this in) — see
// README.md for the full setup steps.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_EMAIL = "heynicetattoo@gmail.com";
const ADMIN_URL = "https://heynicetattoo.github.io/admin.html";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record ?? {};

    const consent = record.consent === "feature" ? "Interested in being featured" : "Keep private";
    const submittedAt = record.created_at ?? new Date().toISOString();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "heynicetattoo <onboarding@resend.dev>",
        to: NOTIFY_EMAIL,
        subject: "New heynicetattoo submission",
        text: `A new story just came in.\n\nConsent: ${consent}\nSubmitted: ${submittedAt}\n\nReview it here: ${ADMIN_URL}`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend error:", errText);
      return new Response(errText, { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
