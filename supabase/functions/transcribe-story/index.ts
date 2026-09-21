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

// Whisper's verbose_json response names the detected language in full
// ("swedish"), but the transcriptions endpoint's `language` parameter
// only accepts ISO-639-1 codes ("sv") — passing the full name back in
// fails with `invalid_language_format`. This maps Whisper's own output
// vocabulary (its documented supported-language list) to those codes.
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  afrikaans: "af", arabic: "ar", armenian: "hy", azerbaijani: "az",
  belarusian: "be", bosnian: "bs", bulgarian: "bg", catalan: "ca",
  chinese: "zh", croatian: "hr", czech: "cs", danish: "da", dutch: "nl",
  english: "en", estonian: "et", finnish: "fi", french: "fr",
  galician: "gl", german: "de", greek: "el", hebrew: "he", hindi: "hi",
  hungarian: "hu", icelandic: "is", indonesian: "id", italian: "it",
  japanese: "ja", kannada: "kn", kazakh: "kk", korean: "ko",
  latvian: "lv", lithuanian: "lt", macedonian: "mk", malay: "ms",
  marathi: "mr", maori: "mi", nepali: "ne", norwegian: "no",
  persian: "fa", polish: "pl", portuguese: "pt", romanian: "ro",
  russian: "ru", serbian: "sr", slovak: "sk", slovenian: "sl",
  spanish: "es", swahili: "sw", swedish: "sv", tagalog: "tl",
  tamil: "ta", thai: "th", turkish: "tr", ukrainian: "uk", urdu: "ur",
  vietnamese: "vi", welsh: "cy",
};

// Even with `language` set, Whisper's transcriptions endpoint sometimes
// translates to English anyway instead of transcribing (seen on clean,
// fluent-sounding audio) — the language param is only a soft hint. A
// short prompt in the target language gives the decoder prior context
// to continue from, which biases it much more strongly toward staying
// in that language. Covers the languages this app is likely to see;
// unmapped languages just get the bare language hint as before.
const PROMPT_BY_LANGUAGE_CODE: Record<string, string> = {
  fr: "Ceci est la transcription d'une histoire racontée à voix haute.",
  de: "Dies ist die Abschrift einer laut erzählten Geschichte.",
  es: "Esta es la transcripción de una historia contada en voz alta.",
  it: "Questa è la trascrizione di una storia raccontata ad alta voce.",
  pt: "Esta é a transcrição de uma história contada em voz alta.",
  nl: "Dit is de transcriptie van een hardop verteld verhaal.",
  sv: "Detta är transkriptionen av en berättelse som berättas högt.",
  no: "Dette er transkripsjonen av en historie fortalt høyt.",
  da: "Dette er transskriptionen af en historie fortalt højt.",
  fi: "Tämä on ääneen kerrotun tarinan litterointi.",
  pl: "To jest transkrypcja opowieści opowiedzianej na głos.",
  cs: "Toto je přepis příběhu vyprávěného nahlas.",
  sk: "Toto je prepis príbehu rozprávaného nahlas.",
  ro: "Aceasta este transcrierea unei povești spuse cu voce tare.",
  hu: "Ez egy hangosan elmesélt történet átirata.",
  el: "Αυτή είναι η απομαγνητοφώνηση μιας ιστορίας που ειπώθηκε δυνατά.",
  ru: "Это расшифровка истории, рассказанной вслух.",
  uk: "Це розшифровка історії, розказаної вголос.",
  tr: "Bu, sesli anlatılan bir hikayenin transkripsiyonudur.",
  ar: "هذا نسخ لقصة رويت بصوت عالٍ.",
  he: "זהו תמלול של סיפור שסופר בקול רם.",
  hi: "यह ज़ोर से सुनाई गई कहानी का प्रतिलेखन है।",
  ja: "これは声に出して語られた物語の書き起こしです。",
  ko: "이것은 소리 내어 말한 이야기의 대본입니다.",
  zh: "这是大声讲述的故事的转录。",
  vi: "Đây là bản ghi lại một câu chuyện được kể to.",
  id: "Ini adalah transkripsi dari sebuah cerita yang diceritakan dengan lantang.",
};

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

    async function callWhisper(
      endpoint: "transcriptions" | "translations",
      opts: { language?: string; prompt?: string; verbose?: boolean } = {},
    ) {
      const form = new FormData();
      form.append("file", audioBlob, filename);
      // /translations only supports whisper-1. /transcriptions can use the
      // newer gpt-4o-mini-transcribe model, which — unlike whisper-1's
      // original multitask checkpoint — reliably respects the "transcribe,
      // don't translate" task instead of occasionally translating to
      // English on its own regardless of the language hint or prompt.
      form.append("model", endpoint === "translations" ? "whisper-1" : "gpt-4o-mini-transcribe");
      if (opts.language) form.append("language", opts.language);
      if (opts.prompt) form.append("prompt", opts.prompt);
      if (opts.verbose) form.append("response_format", "verbose_json");
      const res = await fetch(`https://api.openai.com/v1/audio/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`Whisper ${endpoint} failed: ${await res.text()}`);
      }
      return await res.json();
    }

    // Original-language transcript and English translation — one at a time,
    // not in parallel (see note below on memory). Translate first, with
    // verbose output so Whisper tells us what source language it detected
    // — that endpoint seems to identify the language more reliably than
    // transcription does on its own — then pass that as an explicit hint
    // to the transcription call. Without it, transcription occasionally
    // guesses the wrong source language for less common ones and produces
    // garbled text, even though the translation comes out fine.
    const translationResult = await callWhisper("translations", { verbose: true });
    const transcriptEn = translationResult.text as string;
    const detectedLanguageName = (translationResult.language as string | undefined)?.toLowerCase();
    const detectedLanguageCode = detectedLanguageName ? LANGUAGE_NAME_TO_CODE[detectedLanguageName] : undefined;

    const transcriptionPrompt = detectedLanguageCode ? PROMPT_BY_LANGUAGE_CODE[detectedLanguageCode] : undefined;
    const transcriptionResult = await callWhisper("transcriptions", {
      language: detectedLanguageCode,
      prompt: transcriptionPrompt,
    });
    const transcript = transcriptionResult.text as string;

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
