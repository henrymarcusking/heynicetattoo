# heynicetattoo

A QR-code-driven flow for collecting tattoo photos, the audio story behind them,
and (optionally) contact details for follow-up — plus a small internal tool for
reviewing what comes in.

- `index.html` — the public flow: intro → photo → audio story → contact/consent → thanks.
- `admin.html` — the private review queue (sign-in required).
- `supabase-setup.sql` — the database schema, storage bucket, and RLS policies.

No build step, no npm — this is a plain static site, same as WheresMy and
SleeveNotes. Edit the HTML files directly and refresh.

## One-time setup

1. **Create a Supabase project** at [supabase.com/dashboard](https://supabase.com/dashboard).

2. **Run the schema.** Open the SQL Editor in your new project, paste in the
   entire contents of `supabase-setup.sql`, and run it. This creates the
   `submissions` table, its row-level-security policies, and a private
   `submissions` storage bucket for photos and audio.

3. **Get your API credentials.** In your Supabase project, go to
   **Settings → API** and copy the **Project URL** and the **anon /
   publishable key**. Paste both into the placeholders near the top of the
   `<script>` block in *both* `index.html` and `admin.html`:

   ```js
   const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
   const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
   ```

   The anon key is safe to ship in client-side code — it only grants what the
   RLS policies in `supabase-setup.sql` allow (anonymous visitors can submit
   but never read; only signed-in accounts can review).

4. **Create your admin account.** In Supabase, go to **Authentication →
   Users → Add user**, and set an email + password directly (there's no
   public sign-up screen — `admin.html` is sign-in only). Anyone you create
   an account for can review *every* submission, so only create accounts for
   people you trust with that.

## Running it locally

```bash
python3 -m http.server 4179
```

Then open `http://localhost:4179`. (If you're using Claude Code, the
`.claude/launch.json` config does this for you.) Camera and microphone
access require either `localhost` or HTTPS — both are covered here and on
the deployed site.

## Deploying

1. Push this folder to a new GitHub repository.
2. In the repo's **Settings → Pages**, set the source to deploy from the
   `main` branch, root folder.
3. Once it's live, generate a QR code pointing at the deployed URL (any free
   QR generator works) and print it for your stickers.

## Reviewing submissions

Visit `/admin.html` on the deployed site and sign in with the admin account
you created above. Approving or rejecting a submission just tags its status —
it doesn't post or delete anything. For anyone who opted in to being
featured, that's still just their expressed interest: reach out to them
directly (using the phone/email/Instagram handle they left) and get an
explicit yes before posting their story anywhere.

## Email notification on new submissions

`supabase/functions/notify-new-submission/index.ts` sends a plain notice
(no personal details — just "a story came in, go check the queue") to
`heynicetattoo@gmail.com` every time someone submits. It's deployed as a
Supabase Edge Function, triggered by a Database Webhook, and sends through
[Resend](https://resend.com) (free tier: 3,000 emails/month, plenty for this).

1. **Create a Resend account** at [resend.com](https://resend.com) and
   generate an API key (**API Keys → Create API Key**). No domain
   verification needed to start — the function sends from Resend's shared
   `onboarding@resend.dev` address, which works fine for an internal
   notification. (You can verify your own domain in Resend later for a
   branded "from" address, if you want.)

2. **Add the key as a Supabase secret.** In your Supabase project, go to
   **Edge Functions → Manage secrets** (exact wording may vary slightly —
   look under Edge Functions or Settings) and add:

   ```
   RESEND_API_KEY = <your Resend API key>
   ```

3. **Create the function.** Go to **Edge Functions → Create a function**,
   name it `notify-new-submission`, and paste in the contents of
   `supabase/functions/notify-new-submission/index.ts`.

4. **Wire up the trigger.** Go to **Database → Webhooks → Create a new
   webhook**: table `submissions`, event `Insert`, type "Supabase Edge
   Function", target the `notify-new-submission` function you just created.

That's it — every new submission (regardless of what contact details or
consent choice someone left) triggers one email to `heynicetattoo@gmail.com`.

## On-demand story transcription

`supabase/functions/transcribe-story/index.ts` is called directly from the
review queue — a "Transcribe & translate" button on each submission's audio,
rather than something that runs automatically. It sends the audio to
[OpenAI's Whisper API](https://platform.openai.com/docs/guides/speech-to-text),
which returns both a transcript in whatever language the story was told in
and an English translation, and saves both onto the submission. Costs a
small amount per story (Whisper is priced per minute of audio) — the whole
point of making this a button instead of automatic is that cost and effort
track what you actually review, not everything that comes in.

Because it's called directly by the review queue rather than triggered by
the database, there's no webhook step this time — just:

1. **Add your existing database columns** (only needed once, on a project
   that was set up before this feature existed — a fresh install via
   `supabase-setup.sql` already includes these). In the SQL editor:

   ```sql
   alter table public.submissions add column if not exists transcript text;
   alter table public.submissions add column if not exists transcript_en text;
   ```

2. **Get an OpenAI API key** at [platform.openai.com](https://platform.openai.com/api-keys)
   (you'll need a card on file — Whisper isn't part of any free tier, but
   it's inexpensive per use).

3. **Add it as a Supabase secret** — **Edge Functions → Manage secrets**:

   ```
   OPENAI_API_KEY = <your OpenAI API key>
   ```

4. **Create the function** — **Edge Functions → Create a function**, name
   it `transcribe-story`, and paste in the contents of
   `supabase/functions/transcribe-story/index.ts`.

No webhook needed — the review queue calls this function directly when you
click the button, and only a signed-in reviewer can trigger it.

## Notes on the audio recording

Recording uses the browser's `MediaRecorder` API, which is broadly supported
on modern Chrome and Safari (including iOS Safari) but can be flaky on older
or unusual browsers — the app shows a plain error message rather than a
broken recorder if it isn't available. There's no live audio-reactive
waveform; the bars shown after recording are decorative.

## Attribution

The background flash-art motifs (swallow, anchor, rose, dagger) come from
[game-icons.net](https://game-icons.net/), licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/):

- Swallow by [Delapouite](https://delapouite.com/)
- Anchor, Rose, and Plain Dagger by [Lorc](https://lorcblog.blogspot.com/)

The heart and star motifs are original to this project.
