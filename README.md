# Motos America Parts & Accessories Academy — Web Training Site

A mobile-friendly web version of the Parts & Accessories Academy manual: read
all 19 modules, take instantly-scored quizzes, and unlock two full Part exams.
Each module review requires a perfect score to pass — a wrong answer sends
the trainee back to re-read the module rather than showing which answers
were right or wrong, so people have to actually revisit the material rather
than guess their way through. Managers get a report showing who's
registered, who's passed each module, how many tries it took them, and each
Part exam score.

## What's in this repo

| File | Purpose |
|---|---|
| `index.html` | Page shell — loads everything else |
| `styles.css` | All visual design (shared Motos America Academy design system) |
| `content-data.js` | All 19 modules + every quiz question, generated from the locked manual |
| `app.js` | All app logic — login, navigation, quiz scoring, Supabase calls |
| `supabase-config.js` | **You fill this in** — your Supabase project keys |
| `schema.sql` | Run this once in Supabase to create the database tables |

## One-time setup (do this before sharing the link with your team)

### 1. Create a free Supabase project
- Go to [supabase.com](https://supabase.com) and sign up (free tier is plenty for ~50 users)
- Create a new project. Pick any name/region/password (save the password somewhere, but you won't need it day-to-day)
- Wait ~2 minutes for the project to finish provisioning
- **This should be a separate Supabase project from the Sales, Service, and Passport Academy sites** — keeps each academy's trainee data cleanly apart, with no risk of one academy's schema changes affecting another.

### 2. Create the database tables
- In your Supabase project, open the **SQL Editor** (left sidebar)
- Open `schema.sql` from this repo, copy all of it, paste it into the SQL Editor, and click **Run**
- You should see "Success. No rows returned" — that means the two tables (`trainees` and `quiz_attempts`) were created

**Before running it:** the store list matches the other academy sites' five stores, including **MA Corporate** (a manager-only "store" for corporate staff, not a physical dealership):
```sql
store text not null check (store in ('Cascade Moto Portland', 'Tampa Bay Motos', 'Triumph of Santa Monica', 'Triumph Columbia River', 'MA Corporate')),
```
If you ever add, remove, or rename a store, update this line in `schema.sql` (re-run it in Supabase's SQL Editor) **and** the matching `STORE_OPTIONS` list near the top of `app.js` — they must match exactly, or the login dropdown and the database rule will disagree.

Roles for this academy are **Parts Associate** and **Manager** (an `admin` role also exists in the database for anyone who needs full access without being tied to a specific store's manager view — that role isn't in the login dropdown; create it directly in Supabase's Table Editor if needed).

### 3. Connect the site to your Supabase project
- In Supabase, go to **Project Settings → API**
- Copy the **Project URL**
- Copy the **anon public** key (NOT the `service_role` key — that one must stay secret)
- Open `supabase-config.js` in this repo and paste them in:
```js
window.SUPABASE_URL = "https://your-project-ref.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIs...(long string)...";
```

### 4. Turn on GitHub Pages
- In this repo on GitHub: **Settings → Pages**
- Under "Source," choose **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`
- Save. GitHub will give you a URL like `https://motosamerica.github.io/parts-accessories-academy/` within a minute or two

### 5. Give yourself manager access
- Log into the site once using your name, your store, and select **Manager** as the role
- Managers see an extra "Report" button in the top bar showing every trainee's progress

That's it — share the GitHub Pages URL with your team.

## Notes

- **No passwords.** Trainees log in with just their name and store. This is meant for internal use only — don't link this URL anywhere public.
- **Module reviews require 100%.** All 5 questions must be correct to pass (Module 3 covers the same standard). A wrong answer doesn't reveal which ones — the trainee is sent back to the module page to re-read, then can retry the review as many times as needed. The report shows how many attempts each person needed per module.
- **Part exams are not gated.** The two 20-question Part exams score and record the result, full answer review included, but don't block progress or require a retry.
- **Works offline-ish.** If wifi drops mid-quiz, the score still saves on the device and syncs to the shared database automatically once the connection is back.
- **Content changes:** if the manual content ever changes, `content-data.js` needs to be regenerated from the source (`manual_data.json`) — it isn't meant to be hand-edited directly.
- **Logo:** `MA_logo_white_header.png` is the shared corporate logo used across all four academy sites — already included in this repo.
