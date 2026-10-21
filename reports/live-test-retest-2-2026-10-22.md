# Live production retest 2 — 2026-10-22

- **Site:** https://movie-night-picker-one.vercel.app.
- **Critical context first:** the deployed bundle is `index-CjHq_6HJ.js` — **exactly the same build as yesterday's retest**. Master moved to `ae88b54` ("stop demo titles polluting the pool, pass minAge to picks, flag unmatched text", + `tests/seriesPool.test.ts`) but that change is **not deployed**: ~30 min after the commit landed, the bundle is unchanged. Several checklist failures below are consistent with that staleness. Additional proof the deploy isn't master HEAD: the live audience chip reads **"Family / kids"** while master's `Wizard.tsx` says **"Family with kids"**.
- **Method:** re-ran `scripts/live-2026-10-21.mjs` (extended with `/api/recommend` response capture — notices, first-card types, audience; per-card age-label audit; new genre + family steps; gibberish query updated to `asdfghjkl qwerty`), plus `scripts/live-family-probe-round3.mjs` for the corrected chip label. Evidence: `reports/live-evidence-2026-10-22-r2/` (screenshots, `steps.json`, `network.ndjson`, `family-probe.json`).
- **Rate budget:** 11 `/api/recommend` calls this session — far below 25/10-min; zero 429s.
- **Local gates (requested):**
  - `npm ci` → exit 0 (after killing a stale local `vite` dev server, PID 25436, that held a file lock on `better-sqlite3`'s `.node`; unrelated to the app).
  - `npm run lint` → **exit 1**: `tests/validation.test.ts(56,24): error TS2488: Type 'string[] | undefined' must have a '[Symbol.iterator]()' method that returns an iterator.` — **a compile error on current master's test code** (`ae88b54`); `tsc --noEmit` fails, meaning master itself does not pass the repo's lint gate.
  - `npm test` → exit 0: **360 pass / 0 fail / 11 skipped** (371 tests, 241s).
    ```
    ℹ tests 371
    ℹ pass 360
    ℹ fail 0
    ℹ skipped 11
    ℹ duration_ms 241228.786
    ```

## Checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Series filter: first cards are series, no "wrong kind" notice | **FAIL** | Request sent `types:["series"]` (lowercase ✓), but result: `header="No perfect match"`, **0 cards**, notices include **"Removed 1 title of the wrong kind — you asked for series"** + "Nothing left after enforcing your filters". Response `movies` carry no `type` field at all (`[?]` for every card) — the series-pool work (`ae88b54`) is not deployed |
| 2 | Age labels real; "Rating not confirmed" a small minority | **FAIL** | Labels do render — of 166 cards audited across the run: **All ages 40, 7+ 20 → 60 have real labels**, but **106 (64%) still say "Rating not confirmed"** — not a small minority (the `minAge` backfill/passthrough from `ae88b54` is not deployed) |
| 3 | "Family with kids" audience → every pick "All ages" | **FAIL (with a positive side)** | Corrected chip label "Family / kids" → captured request body `audience:"Family with kids"` ✓; header "Found 6 matches"; picks are a correct kid-safe pool (Totoro, Toy Story, Soul, Fantastic Mr. Fox, WALL·E, Paddington 2) in 3.4s — but **0/6 cards say "All ages"**: all six say "Rating not confirmed" |
| 4 | Gibberish "asdfghjkl qwerty" shows the couldn't-match notice | **PASS** | Notice shown verbatim: “We couldn't match \"asdfghjkl qwerty\" to a mood, genre or title in our catalog, so these are popular picks instead. Try a mood, a genre, or \"movies like …\".” + 10 popular picks, no error |
| 5 | Inception, mood, genre searches: 10 cards each, <10s | **PARTIAL FAIL** | Mood ×3: **10/10 cards** (6.3s / 5.0s / 5.3s) PASS. "Inception": 10 cards, 5.9s PASS. Genre search "best comedies": **only 5 cards** (4.3s) — header "Found 5 matches" — under 10s but not 10 cards |

## Other observations (from the wire)

- **Posters flaked on two mood flows:** the Feel-good and Funny results had **10/10 posters not loaded** even after the settle + 3s re-audit (screenshot `s02-mood-feelgood.png` — dark empty cards), while every other search/mood rendered 0 broken. Smells like transient upstream (`/img` → TMDB) slowness on exactly those two requests, not a UI bug.
- **Inception title didn't anchor the search:** its response notice is “Using your reference titles as your similarity reference.” — i.e. the server did NOT resolve "Inception" as a title anchor (while "movies like The Matrix" DID: “Using The Matrix as your similarity reference.”). Both returned the same top set (Totoro / Parasite / The Good, the Bad and the Ugly / Before Sunrise / Edge of Tomorrow) — the default reference corpus is doing the work.

## All timings

Desktop+moods+searches+family: n=8 → **min 3.37s, median 5.09s, max 6.30s**; mobile 5.2s. All < 10s (the only F-grade on latency remains: none).

## Verdict

- Repo state: **tests green (360/0/11), lint red (`TS2488` on master's test code)**.
- Checklist: **1 PASS (gibberish notice) · 1 PARTIAL (check 5) · 3 FAIL (Series pool, minAge labels, genre card count)**.
- **Most of the failures look like deployment staleness, not code regressions:** bundle unchanged ~30 min after `ae88b54`; live chip label differs from master; `type` field missing from picks; all-ages coverage 64% missing. Recommend redeploying (Vercel build for `ae88b54`) then re-running this probe before analyzing anything on the app side.
