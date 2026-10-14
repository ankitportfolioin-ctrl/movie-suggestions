# CineMatch Release Report

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
