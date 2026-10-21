# Live production retest — 2026-10-22

- **Site:** https://movie-night-picker-one.vercel.app — new deployment confirmed (bundle hash `index-CjHq_6HJ.js`, was `index-DbIOe1Y6.js` yesterday) including master commit `090aab8` "fix(search): send the typed query, honour Series/Any filters, resolve 'like X', a11y".
- **Method:** re-ran `scripts/live-2026-10-21.mjs` (now with `/api/recommend` request-body capture and evidence dir `reports/live-evidence-2026-10-22/`), plus `scripts/live-retest-2026-10-22.mjs` (focused Series probe), `scripts/live-axe-search-page.mjs`, and one `curl` direct-API call. No application code touched.
- **API budget:** 15 `/api/recommend` calls total across the whole session (10 main run + 3 focused probe + 1 curl + 1 axe flow) — all within rolling 10-min windows well under the 25-call cap; zero 429s.

## Checklist result: **4 of 5 verified · 1 partially (server returns 0 series)**

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Three searches return **different** sets, body `note` == typed text | **PASS** | Captured request bodies: `note:"Inception"`, `note:"Incepton"`, `note:"suspenseful thriller under 90 minutes not scary"` — verbatim. First cards differ per query: Inception → 1988 film (Fit 97), Incepton → 2016 film (Fit 93), long-constraint → "Stolen Baby" 2023 **1h 27m** Thriller (Fit 99) — the <90-min + Thriller constraints were honored, so the note is genuinely used |
| 2 | One Enter on the hero runs the search | **PASS** | Every search logged `leg=single-Enter (search page did not appear)` — API fired and results rendered on the first Enter; two-leg flow gone |
| 3 | "movies like The Matrix" has no "couldn't load" notice | **PASS** | `refNotice=false` on the Matrix search; the notice is gone |
| 4 | Type "Series" returns series; request `types:["series"]` | **PARTIAL** | Request now sends lowercase `types:["series"]` and the server honors it (notice: "Removed 10 titles of the wrong kind — you asked for series.") — but a maximally permissive direct-API body (`types:["series"]`, no other constraints) still returns **0 movies**. The filter works; the candidate pool contains no series, so the filter can only ever yield an empty page |
| 5 | axe on the natural-search page | **PASS (obsolete page)** | After fixing check 2, the dedicated natural-search page no longer appears from the hero — a single Enter lands directly on results (H1 present, axe: **0 violations**). Home and results pages also 0 violations |

## Full regression run (same 10 steps as yesterday)

| Step | Result (yesterday → today) |
|------|-----------------------------|
| S1 home loads, no console/failed requests | PASS → **PASS** (load 5.0s) |
| S2 moods ×3 | PASS → **PASS** (10 cards each, year+runtime, 0 broken posters; 6.8s / 5.1s / 5.0s) |
| S3 searches ×4 | PASS-with-bugs → **PASS** (all single-Enter, verbatim notes, 3.8–5.9s) |
| S4 gibberish | WARN → **WARN** (still no true empty state: "Found 3 matches" + 3 cards, no error; behavior improved from 1 result but no friendly-empty notice) |
| S5 "movies like The Matrix" | PASS-with-bugs → **PASS** (notice gone; residual: first card identical to the plain "Inception" search — picks don't visibly differ from a title-only query) |
| S6 Series filter | **FAIL → WARN** (request shape fixed `["series"]`; results change but to 0 cards, see check 4) |
| S7 timings | min **2.3s** (mobile) / median **5.0s** / max **6.9s**, n=9, all < 10s |
| S8 broken JSON | PASS (not re-run; unchanged from yesterday: 400 JSON error body in 0.56s) |
| S9 axe | home 0, results 0, flow page 0 → **PASS** |
| S10 mobile 390px | **PASS** (10 cards, 0 broken posters, recommend 2.3s — fastest of the run) |

Console/network health: zero app console errors, zero page errors, zero failed requests, again (13 beacon/telemetry calls client-blocked by the probe). Posters all loaded through `/img` (0 broken after settle). "Rating not confirmed" badge still on every card (F6 not addressed in this fix).

## Finding-by-finding vs yesterday's report

| Yesterday | Today |
|-----------|-------|
| F1 search query never sent (`note:""`) | **Fixed** — note verbatim in body, results differ per query |
| F2 two-leg search | **Fixed** — single Enter |
| F3 "Couldn't load The Matrix" | **Fixed** — notice gone (picks still generic-looking for like-X) |
| F4 Series filter no-op (`["Series"]` capitalized) | **Half-fixed** — lowercase `["series"]` sent and honored server-side, but 0 results because catalog has no series; UI can only show "No perfect match" |
| F5 serious a11y on natural-search page | **Fixed by removal** — page eliminated by single-Enter flow; axe clean everywhere |
| F6 "Rating not confirmed" everywhere | **Not addressed** — still on every card |

Screenshots: `reports/live-evidence-2026-10-22/` (`s01`…`s10`, `s11-series-neutral`, `s09b-axe-after-first-enter`, `retest-series-probe.json`, `steps.json`, `network.ndjson`).
