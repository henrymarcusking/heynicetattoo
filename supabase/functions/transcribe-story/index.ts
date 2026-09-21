// heynicetattoo — on-demand story transcription + translation.
//
// Called directly from admin.html when a reviewer clicks "Transcribe &
// translate" on a submission (supabaseClient.functions.invoke). Downloads
// the audio, sends it to OpenAI Whisper for both a same-language
// transcript and an English translation, and saves both back onto the
// submission row. Runs only when a reviewer asks for it — that's the
// whole point of doing this on demand rather than on every submission.
//
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which Supabase
// injects into every Edge Function automatically — no need to set those
// as secrets yourself. OPENAI_API_KEY does need to be added as a secret.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  try {
    // Only a signed-in reviewer may call this — verify the caller's own
    // token actually belongs to a logged-in user (not just the public
    // anon key, which also happens to pass Supabase's gateway check).
    const authHeader = req.headers.get("Authorization") ?? "";
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: SERVICE_ROLE_KEY },
    });
    if (!userRes.ok) {
      return new Response("Sign-in required", { status: 401, headers: corsHeaders(origin) });
    }

    const { submissionId } = await req.json();
    if (!submissionId) {
      return new Response("Missing submissionId", { status: 400, headers: corsHeaders(origin) });
    }

    // Look up the submission with the service role — bypasses RLS, which
    // is fine here since this only ever runs server-side.
    const rowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/submissions?id=eq.${submissionId}&select=audio_path`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const rows = await rowRes.json();
    const row = rows[0];
    if (!row) {
      return new Response("Submission not found", { status: 404, headers: corsHeaders(origin) });
    }

    const audioRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/submissions/${row.audio_path}`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!audioRes.ok) {
      return new Response("Couldn't fetch the audio file", { status: 500, headers: corsHeaders(origin) });
    }
    const audioBlob = await audioRes.blob();
    const filename = row.audio_path.split("/").pop() || "audio.webm";

    async function callWhisper(endpoint: "transcriptions" | "translations") {
      const form = new FormData();
      form.append("file", audioBlob, filename);
      form.append("model", "whisper-1");
      const res = await fetch(`https://api.openai.com/v1/audio/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`Whisper ${endpoint} failed: ${await res.text()}`);
      }
      const data = await res.json();
      return data.text as string;
    }

    // Original-language transcript and English translation, in parallel.
    const [transcript, transcriptEn] = await Promise.all([
      callWhisper("transcriptions"),
      callWhisper("translations"),
    ]);

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/submissions?id=eq.${submissionId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ transcript, transcript_en: transcriptEn }),
    });
    if (!updateRes.ok) {
      return new Response(`Transcribed but failed to save: ${await updateRes.text()}`, {
        status: 500,
        headers: corsHeaders(origin),
      });
    }

    return new Response(JSON.stringify({ transcript, transcript_en: transcriptEn }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500, headers: corsHeaders(origin) });
  }
});
