# Ink Stories

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
