# Live production retest 3 — 2026-10-22

- **Site:** https://movie-night-picker-one.vercel.app.
- **Deployment confirmation (as requested):** the client bundle hash is still `index-CjHq_6HJ.js` — but `945a176` and `ae88b54` are **server/db-only fixes**, so an unchanged client bundle does not prove staleness (correction to yesterday's round-2 report: my "prod is stale" verdict was **wrong**; the server functions evidently were shipping all along). Behavior fingerprints (direct `/api/recommend`, minimal bodies) confirm **both commits are serving**:
  - Series pool works: 10 real `[series]` picks with age labels (Anne with an E, The Office, Cosmos, Planet Earth…), no "wrong kind" notice → `ae88b54` live (screenshot/probe: `deploy-fingerprint.json`).
  - "Any length" no longer silently serves demo data: Mind-bending → Super 8/Mercy/Transcendence…, Funny → Isle of Dogs/The Intern/Jojo Rabbit… (real, differing pools) → `945a176` live.
- **Method:** re-ran `scripts/live-2026-10-21.mjs` (extended: per-card age audit, `/api/recommend` response capture, genre + family steps) + `scripts/live-fingerprint-round4.mjs`. Evidence: `reports/live-evidence-2026-10-22-r3/`. No application code changed.
- **Rate budget:** 14 `/api/recommend` calls (3 fingerprint + 11 probe) — under the 25/10-min cap; zero 429s.
- **Local gates (as requested):**
  - `npm ci` → exit 0.
  - `npm run lint` → exit 1. Exact error (first line wrapped here, single line in output):
    ```
    tests/validation.test.ts(56,24): error TS2488: Type 'string[] | undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
    ```
    Same defect as yesterday — still present on `945a176` master.
  - `npm test` → exit 0: `ℹ tests 373 / pass 362 / fail 0 / skipped 11 / duration_ms 241005.2217`.

## Checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Series filter → first cards real series, no "wrong kind" notice | **PASS** | `types:["series"]` sent (lowercase); result: 10 cards, header "Found 10 matches", **all 10 response picks carry `type:"series"`** (Anne with an E, The Office, Dragon Ball Super, Cosmos, Run BTS!, Malcolm in the Middle, … Planet Earth); `wrongKindNotice=false`, no notices. Card age labels: 7+ ×3, All ages ×4, not-confirmed ×3. (Probe self-logged WARN — its `cardTypesAllSeries` regex forgot the new ` age=` suffix — the captured `/api/recommend` bodies are the evidence; probe artifact, not app behavior) |
| 2a | "Rating not confirmed" count | **PASS** — tiny minority now | 180 cards audited across the run: **5 say "Rating not confirmed" (2.8%)**; 81 "All ages" + 94 "7+" |
| 2b | Default mood search: 10 titles, NOT the 30 demo titles | **FAIL** | "Browse by mood" still serves the historical demo lists verbatim: Mind-bending = Elemental, Shrek 2, Rugrats in Paris, Lilo & Stitch, Kung Fu Panda, Sing 2, Hunchback II, Barbie Pauper, Scooby-Doo Showdown, Cloudy… (identical in rounds 2 & 3) and Funny = Wish Dragon, Lego Batman, Another Cinderella, Ron's Gone Wrong, Scooby-Doo! Camp Scare, Leo, Lady and the Tramp, Boss Baby, Princess Diaries, Peanuts (identical rounds 2 & 3). The direct-API path with the same moods + note returns real data, so the demo fallback lives in the UI's mood-flow request shape (likely the "Under 2 hours" default runtime seen in the chips bar, hit by 945a's crash path or pool exhaustion → demo fallback) |
| 3 | "Family with kids" → every pick "All ages" | **FAIL (8/10)** | Body `audience:"Family with kids"` ✓; 10 cards in 5.3s; **8/10 "All ages", 2 "Rating not confirmed"**. Massive improvement from 0/6 yesterday, but not yet *every* pick |
| 4a | "Inception" resolves as reference | **FAIL** | Response notice still “**Using your reference titles** as your similarity reference.” — process: Matrix resolves ("Using The Matrix as your similarity reference.") while "Inception" does not anchor the search |
| 4b | "best comedies" genre search → 10 cards | **PASS** | 10 cards, real comedy set (Jojo Rabbit, Isle of Dogs, School of Rock, Glass Onion, Grease…), 5.6s |
| 5 | Different moods → clearly different sets | **PARTIAL** | The three mood sets differ from each other, but two of three are the frozen demo pools (see 2b) rather than fresh catalog picks; Feel-good (Mercy, Super 8, Caddo Lake, The Vast of Night, Reminiscence, …) is real catalog data |

## Latency

min **2.5s** (mobile) / median ~5.6s / **one breach: the Funny mood flow took 24.7s** (first >10s reading in three rounds); every other recorded recommend came in at 2.5–7.1s. Likely upstream slowness on that single request.

## Console / network health

Zero app console errors, zero page errors, zero failed requests, 0 broken posters everywhere (both desktop and mobile). axe: home 0, results 0 violations.

## Verdict

- Checklist: **3 PASS (series pool, notConfirmed minority, genre count) · 1 PARTIAL (mood variety) · 3 FAIL (demo lists on default moods, family 8/10, Inception anchoring)**.
- Local gates: **tests green (362/0/11), lint red with the exact same `TS2488` in `tests/validation.test.ts:56`** (two days running on master).
- Remaining real issues on a correctly deployed site: (a) the default mood flow still serves synced demo lists — the one place where 945a's crash→demo-fallback imprint persists; (b) "Inception" alone doesn't anchor like "movies like X" does; (c) 2/10 family picks lack a confirmed age label; (d) one slow recommend (24.7s).
