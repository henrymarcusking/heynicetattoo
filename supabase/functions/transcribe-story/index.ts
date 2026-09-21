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
    "Access-Control-Allow-Headers": "*",
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

    // Transcribe the original audio. gpt-4o-mini-transcribe only ever
    // transcribes — unlike whisper-1, it has no separate "translate" task
    // it can be confused into running instead, which is what kept going
    // wrong when we tried to get both a transcript and a translation out
    // of whisper-1's two audio endpoints (it would sometimes translate
    // when asked to transcribe, and sometimes fail to translate when
    // asked to translate — a task-following bug in both directions).
    const transcribeForm = new FormData();
    transcribeForm.append("file", audioBlob, filename);
    transcribeForm.append("model", "gpt-4o-mini-transcribe");
    const transcribeRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: transcribeForm,
    });
    if (!transcribeRes.ok) {
      throw new Error(`Transcription failed: ${await transcribeRes.text()}`);
    }
    const transcript = ((await transcribeRes.json()).text as string).trim();

    // Translate the transcript to English as a plain text task, not an
    // audio task — ordinary text translation has none of the above
    // task-confusion failure mode and is cheap for a story-length transcript.
    const translateRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Translate the user's message into English. Reply with only the translation, nothing else. If it's already in English, reply with it unchanged.",
          },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!translateRes.ok) {
      throw new Error(`Translation failed: ${await translateRes.text()}`);
    }
    const transcriptEn = ((await translateRes.json()).choices[0].message.content as string).trim();

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
