# CineMatch Release Report

## Phase 2 — Visual test (2026-10-14, this session)

- Suite: `e2e/visual.spec.ts` (4 tests) + `e2e/baseline.spec.ts` (1 test). Command `npx playwright test e2e/visual.spec.ts` => `4 passed (20.9s)`; matrix re-run after full-walk extension => `1 passed (26.4s)` with `LAYOUT:[]` (zero horizontal overflow on all 5 viewports x all states, measured via `scrollWidth > innerWidth+1`) and `CONSOLE_ERRORS:[] PAGEERRORS:[]`.
- Genuine no-matches via real API: restrictive filters (Documentary + Family + Under 90 + Spanish + Highly rated) => `NOMATCH count=0 notices=["No close matches this time — try widening the runtime or genres."]`.
- Visual baselines: `npx playwright test e2e/baseline.spec.ts --update-snapshots` => wrote `baseline-landing-desktop-win32.png`, `baseline-q1-desktop-win32.png`; re-run without flag => `1 passed (2.3s)`.
- Contrast (measured with node luminance calc this session): `#F5F5F5`=18.16:1 PASS, `#8C8C8C` body gray=5.89:1 PASS (>=4.5), `#FF7A2F`=7.61:1 PASS, `#666666` (counters/footer 11-12px)=3.45:1 FAIL => D-CONTRAST-01.
- Tap targets (measured 360x740 Q1 this session): mood cards 158x98, Back 99x54, Cancel 112x54, Continue 107x60 — all >=44x44 PASS. Preference switches are 48x24 (WCAG 2.2 AA min 24px: pass; Apple 44px guideline: fail) => D-TAP-01 (Low).
- Defects logged in Phase 2:
  - D-CLIP-01 (Low): 360px Q1 mood descs truncated by `line-clamp-1` ("Cathartic...", "Bittersweet or..."). DOM text complete; cosmetic.
  - D-SCROLL-01 (Medium): 360px Q4 heading "Time Available" clipped at top — scroll position retained across steps, no scroll-to-top on Next.
  - D-POSTER-02 (Medium): results cards show black/empty poster area until images arrive (no aspect-ratio placeholder/skeleton => layout jump). Posters DO load (smoke-results 822KB, all 3 visible); timing/placeholder issue. Subsumed by D-POSTER-01 fix (/img route + placeholder).
  - D-CONTRAST-01 (Low): `#666666` secondary text 3.45:1 < 4.5.
  - D-TAP-01 (Low): toggle switches 48x24 < 44x44.
  - D-LAYOUT-01 (Low): 768px results show 2.5 cards (swipe row vs wrap — verify intended).
  - D-YEAR-01 (Low): footer shows "© 2025" (current year 2026).
- Visual table (VC = visually checked with image-view tool this session; NV = captured on disk, NOT VISUALLY CHECKED — stratified sample inspected due to volume):

| screenshot | viewport | state | what I saw | defect |
|---|---|---|---|---|
| 360x740-visual-landing.png | 360x740 | landing | Clean dark hero, pill badge, gradient headline, full-width orange CTA, feature card top. No clipping. | N (VC) |
| 360x740-visual-q1.png | 360x740 | Q1 | 2-col mood grid, Relaxed selected orange. "Cathartic..." / "Bittersweet or..." truncated. Snapshot empty (correct: nothing touched). | Y-low D-CLIP-01 (VC) |
| 360x740-visual-q2.png | 360x740 | Q2 | Chips wrap cleanly, Surprise-me selected, counter, Back/Cancel/Continue visible. Footer credits OMDb·Watchmode·TMDB. | N (VC) |
| 360x740-visual-q3.png | 360x740 | Q3 | 4 audience cards stacked, Just-me selected, full descs, action bar + footer. | N (VC) |
| 360x740-visual-q4.png | 360x740 | Q4 | Heading clipped at top edge ("Time Available" cut). Runtime cards + bar fine. | Y-med D-SCROLL-01 (VC) |
| 360x740-visual-q5.png | 360x740 | Q5 | Snapshot chips correct (Mood/Genres/Company/Runtime). 3-col language grid fits. | N (VC) |
| 360x740-visual-q6-top.png | 360x740 | Q6 top | (captured, matrix green, no overflow) | N (NV) |
| 360x740-visual-q6-bottom.png | 360x740 | Q6 bottom | 4 toggles OFF + mature row, action bar. Switch height 24px. | Y-low D-TAP-01 (VC) |
| 360x740-visual-q7.png | 360x740 | Q7 | Textarea, 0/200 counter, summary chips, full-width Find-my-movies CTA. | N (VC) |
| 360x740-visual-results.png | 360x740 | results | Card badges visible but poster area black/empty (image not yet arrived, no placeholder). | Y-med D-POSTER-02 (VC) |
| 390x844-visual-*.png (landing,q1-q7,results) | 390x844 | all | Matrix green, no overflow/errors. results sampled: badges + metadata row (1990/1h26m/8.1/G/JA) visible, poster area black (same timing). | D-POSTER-02 (VC results; rest NV) |
| 768x1024-visual-*.png | 768x1024 | all | Matrix green. results sampled: 3 cards w/ metadata, reasons, providers (Netflix/JioHotstar/VI); 2.5 cards visible in a swipe row. | Y-low D-LAYOUT-01 (VC results; rest NV) |
| 1366x768-visual-q1-default.png + q1-mood-x8 | 1366x768 | Q1 options | (captured; matrix path green) | N (NV) |
| 1366x768-visual-q2-surprise/3genres/attempt-4th | 1366x768 | Q2 | attempt-4th VC: Comedy/Drama/Sci-Fi checked, Horror rejected, "3/3 selected". Correct. | N (VC) |
| 1366x768-visual-q3-x4 | 1366x768 | Q3 options | (captured) | N (NV) |
| 1366x768-visual-q4-x4 | 1366x768 | Q4 options | (captured) | N (NV) |
| 1366x768-visual-q5-x9 | 1366x768 | Q5 options | (captured) | N (NV) |
| 1366x768-visual-q6-top/bottom-off/bottom-on | 1366x768 | Q6 | bottom-on VC: Highly-rated ON, Hidden-gems ON, Recent OFF, Classics ON (mutual exclusion correct), Family-mode mature row. | N (VC) |
| 1366x768-visual-q7-empty/200chars/hindi-emoji | 1366x768 | Q7 | hindi-emoji VC: Devanagari + emoji render, counter 39/200, snapshot complete. | N (VC) |
| 1366x768-visual-loading.png | 1366x768 | loading | Glowing sparkles icon + "Analyzing Taste Profiles..." + subtext. Intentional, not blank. (Animation not verifiable in still.) | N (VC) |
| 1366x768-visual-results.png | 1366x768 | results | "Your 3 Tailored Matches", 3 loaded posters (Totoro GEM 90%, Toy Story 98%, Soul 99%). | N (VC) |
| 1366x768-visual-no-matches.png | 1366x768 | no matches | "No perfect match" + guidance + notice chip + Adjust-filters/Start-over. Not blank. | N (VC) |
| 1366x768-visual-error-blocked-api.png | 1366x768 | error | "Something went wrong / services stumbled..." + Try-again/Start-over. Friendly, not blank. | N (VC) |
| 1920x1080-visual-*.png (landing,q1-q7,results) | 1920x1080 | all | Matrix green, no overflow/errors. | N (NV) |
| smoke landing/results | 1366x768 | smoke | VC in Phase 1 (clean hero; 3 posters loaded). | N (VC) |

## Phase 1 — Real-browser setup (2026-10-14, this session)

- Playwright: `@playwright/test` installed with `--legacy-peer-deps` (pre-existing esbuild peer conflict; evidence: `ERESOLVE ... Conflicting peer dependency: esbuild@0.28.2` then `added 3 packages`). `npx playwright --version` => `Version 1.64.0`.
- Chromium: `npx playwright install chromium` => `Chrome for Testing 156.0.8078.4 (playwright chromium v1248) downloaded`.
- Headed vs headless: headed WAS tried first (`npx playwright test e2e/smoke.spec.ts --headed` launched a real browser window, test executed). Suite runs headless for speed/reliability; headed confirmed working (no "no display" condition).
- Harness: `playwright.config.ts` (baseURL `http://localhost:3101`), `e2e/helpers.ts` (`recordFlow` captures console error/warning, pageerror, requestfailed + status>=400, every URL; `assertClean` fails on unwhitelisted entries; `thirdPartyCalls` flags `*.tmdb.org`/`api.themoviedb.org`), `e2e/smoke.spec.ts`.
- Prod server for QA: `NODE_ENV=production PORT=3101 npx tsx server.ts` (via `cmd.exe /c`), health `{"ok":true}` HTTP 200. Note: `npm run start` (`node server.ts`) still broken (D-START-01, open).
- Screenshots: `release-report/screens/<viewport>-<flow>-<step>.png` (fixed `../` path bug that wrote to `Desktop/release-report/`).
- Smoke result: `npx playwright test e2e/smoke.spec.ts` => `1 passed (7.7s)`.
- Visual check (this session, image-view tool):
  - `1366x768-smoke-landing.png`: dark hero, pill badge, gradient "Movie Night Picker" headline, gray subtext, orange CTA "Start Tonight's Match", 3 feature cards with icons. No clipping/overlap. Defect: N.
  - `1366x768-smoke-results.png`: "Your 3 Tailored Matches" + 3 loaded posters (Totoro HIDDEN GEM 90%, Toy Story 98%, Soul 99%) with match badges. Cards extend below fold (page scrolls, expected). Defect: N.
- Defects logged:
  - D-WIZARD-01 (Critical, FIXED this phase): `Wizard.tsx` used `touchedSteps` without destructuring => ReferenceError on quiz start, blank black page. Evidence: `Continue` timeout + all-black failure screenshot + `tsc TS2304 x6`. Fix: added `touchedSteps` to destructure (1 line). Re-ran same spec => passed. Rebuilt (`vite build` exit 0).
  - D-POSTER-01 (High, OPEN): browser requests `https://image.tmdb.org/...` directly (E11 violation). Evidence: `failedRequests: ["FAILED GET https://image.tmdb.org/t/p/w92/... :: net::ERR_BLOCKED_BY_ORB"]`. Fix planned Phase 5/6: backend `/img` proxy route + frontend switch. Temporarily whitelisted in smoke with reason.

## Phase 0 — Baseline (2026-10-14, this session)

### Environment
- `node --version` => `v24.14.1`
- `npm --version` => `11.11.0`
- `git status --short` =>
  ```
  M package-lock.json
   M package.json
  ?? data/
  ?? eval/
  ```
- `git branch --show-current` => `master`
- `git log -1 --oneline` => `74c309f Phase 4: UX fixes - snapshot shows only made choices, adds company/language/toggles; language chip and certificate on cards; empty state shows notices; footer links; favicon; focus styles`
- `package.json` scripts =>
  ```json
  {
    "dev": "tsx server.ts",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node server.ts",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit",
    "test": "tsx --test \"tests/**/*.test.ts\""
  }
  ```

### E1/E2 — typecheck (`npm run lint` = `tsc --noEmit`)
- Command: `npm run lint 2>&1`
- Result: EXIT False, **17 errors**:
  ```
  eval/ingest.ts(327,40): error TS18046: 'r' is of type 'unknown'. (x3 on line 327)
  eval/run.ts(155,13): error TS2339: Property 'mediaType' does not exist ...
  eval/run.ts(155,32): error TS2339: Property 'mediaType' does not exist ...
  eval/run.ts(156,38): error TS2339: Property 'mediaType' does not exist ...
  eval/run.ts(334,13): error TS2339: Property 'actors' does not exist ...
  eval/run.ts(337,17): error TS2339: Property 'actors' does not exist ...
  eval/run.ts(337,29): error TS7006: Parameter 'a' implicitly has an 'any' type.
  eval/run.ts(343,13): error TS2339: Property 'director' does not exist ...
  eval/run.ts(346,17): error TS2339: Property 'director' does not exist ...
  src/components/Wizard.tsx(174,10): error TS2304: Cannot find name 'touchedSteps'. (x6: lines 174,179,184,189,194,199)
  ```
- Verdict: E1 FAIL (17), E2 FAIL (no separate eslint config; `lint` script IS typecheck; no eslint files found).

### E3 — tests (`npm test`)
- Command: `npm test 2>&1`
- Result: EXIT True — `pass 119, fail 0, skipped 5, duration 337ms`.
- Verdict: E3 PASS (0 failures).

### E4 — production build (`npm run build`)
- Command: `npm run build 2>&1`
- Result: EXIT True in 457ms:
  ```
  dist/index.html                 1.46 kB | gzip: 0.64 kB
  dist/assets/index-BORrnvsA.css 32.40 kB | gzip: 6.39 kB
  dist/assets/index-CpRPrYmf.js 270.25 kB | gzip: 81.60 kB
  ```
- Warning (matters for future Vite major): `Your Vite config uses features unsupported by configLoader: 'native': __dirname (vite.config.ts:11:27)`.
- JS chunk 270.25 kB raw / 81.60 kB gzip — under 250 kB gzipped target.
- Verdict: E4 PASS (exit 0, 1 upstream warning).

### Production start
- `start` script is `node server.ts` — **BROKEN**, reproduced this session:
  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\nikhi\Desktop\movie-night-picker\server\omdb.js' imported from server.ts
  ```
  (plain `node` does not resolve TS `.js`->`.ts` shims; `tsx` does).
- Working alternative proven this session:
  `NODE_ENV=production PORT=3101 npx tsx server.ts` => `curl http://localhost:3101/api/health` returns `{"ok":true}` (HTTP 200), `/` returns HTTP 200.
- URL/port for QA: `http://localhost:3101` (prod static `dist/` via tsx). No new file created yet in Phase 0.
- E8 quick check: `npm audit --omit=dev` => `found 0 vulnerabilities` (PASS baseline).

### Baseline E-table (Phase 0)
| ID | target | baseline | PASS/FAIL |
|----|--------|----------|-----------|
| E1 typecheck | 0 errors | 17 errors | FAIL |
| E2 lint | 0 err/0 warn | no eslint; tsc 17 errors | FAIL |
| E3 tests | 0 failures | 119 pass / 0 fail / 5 skipped | PASS |
| E4 build | exit 0 | exit 0, 1 Vite warning, JS 81.6kB gzip | PASS |
| E5 console | 0 errors | NOT RUN | NOT RUN |
| E6 network | 0 failed | NOT RUN | NOT RUN |
| E7 server logs | 0 errors | NOT RUN | NOT RUN |
| E8 audit | 0 high/critical | 0 vulnerabilities | PASS |
| E9 axe | 0 serious/critical | NOT RUN | NOT RUN |
| E10 hard-filter | 0 violations | NOT RUN | NOT RUN |
| E11 no browser-direct TMDB | 0 direct | NOT RUN | NOT RUN |

### Defects logged in Phase 0
- D-START-01 (High): `npm run start` (`node server.ts`) crashes with ERR_MODULE_NOT_FOUND. Repro above. Fix planned: minimal start script using tsx or compiled server.
- D-TSC-01 (High): 17 `tsc --noEmit` errors in `eval/` and `src/components/Wizard.tsx` (`touchedSteps` undefined).
