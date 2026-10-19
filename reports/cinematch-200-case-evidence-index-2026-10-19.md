# CineMatch 200-Case Evidence Index (Reconciled)

**Date:** 2026-10-19 · **Commit audited:** `afd1486` (`fix/cinematch-d01-d08`)
Maps every ledger row to surviving artifacts (or states their absence). Two evidence trees exist on disk:

| Directory | Run/version identity | Notes |
|---|---|---|
| `reports/cinematch-200-case-evidence-2026-10-19/` | the reported run (branch `fix/…`, commit `afd1486`) — file timestamps 2026-10-19 | primary evidence for the reconciled ledger |
| `reports/cinematch-200-case-evidence/` | **undated, pre-fix (≈2026-10-18)** — e.g. `B-final-question.yml` shows Q7 **without** Back/Cancel/Continue | historical contradiction-corpus only; never blended with ledger PASSes |
| `evidence/` (repo root) | Playwright-written for d09 suite (`D09-TC-001-homepage.png`, `D09-TC-055-quiz-results.png`, `TC-001-homepage.png`, `TC-055-quiz-results.png`) | supports A1, landing console-clean |
| `test-results/` | last Playwright invocation: **baseline.spec failure only** (`baseline-q1.png`: 15,023 px diff; snapshot in error-context.md proves local run took place) | not a 200-case run log |

`env:` prefix = environment marker inside the file name. `—` = no artifact exists; the original report's cell was claim-only.

## A (20) — landing & navigation
| ID | Local evidence | Production evidence |
|---|---|---|
| A1 | `evidence/D09-TC-001-homepage.png` + `evidence/TC-001-homepage.png` + `cinematch-200-case-evidence/A1-console-errors.txt` (0 errors) | `…2026-10-19/A01-landing-1366-deployed.png` (env:"deployed") |
| A2 | `…2026-10-19/A02-reload.png` | — |
| A3 | — | — |
| A4 | `…2026-10-19/A04-forward.png` | — |
| A5 | — | — |
| A6 | `…2026-10-19/A06-quiz-q1.png` | — |
| A7 | `cinematch-200-case-evidence/A7-focus-tab.yml`, `A7-focus-tab2.yml`, `A7-header-buttons.yml` (focus only) | — |
| A8 | `cinematch-200-case-evidence/A8-focus-space{,2,3,4}.yml`, `A8-after-space.yml`, `A8-header-start-quiz{,2}.yml` (focus only) | — |
| A9 | — (no scroll proof) | — |
| A10 | `…2026-10-19/A10-how-it-works.png` (post-click; not a scroll proof) | — |
| A11 | `…2026-10-19/A11-saved-picks-empty.png` | — |
| A12 | `cinematch-200-case-evidence/A12-search-modes.yml` | — |
| A13 | `…2026-10-19/A13-nl-mode2.png` | — |
| A14 | — | `…2026-10-19/A14-nl-result-deployed.png` ("3 results found / Excluding Horror") |
| A15 | footer URLs visible inside `A18-1366x768.yml`, `A20-mobile-360x740.yml`, `B-final-question.yml` | — |
| A16 | yml snapshots (H1/main/contentinfo refs) | `A01-…-deployed.png` (H1/hero/nav only) |
| A17 | — | — |
| A18 | `cinematch-200-case-evidence/A18-1366x768.yml` + `…2026-10-19/A18-viewport.png` | — |
| A19 | `…2026-10-19/A19-viewport.png` | — |
| A20 | `cinematch-200-case-evidence/A20-mobile-360x740.yml` + `…2026-10-19/A20-viewport.png` | — |

## B (20) — quiz flow
| ID | Evidence (Local) | Production |
|---|---|---|
| B1 | `…2026-10-19/B01-q1-fresh.png`, `B-step1.png` | — |
| B2–B5, B9, B13 | `…2026-10-19/B-step2..8.png` (one pass through steps) | — |
| B3 | additionally `B03-mood-happy.png` | — |
| B4 | `B04-mood-changed-twice.png` | — |
| B7 | `cinematch-200-case-evidence/B7-question7.yml` (env-unlabeled ⇒ Local; Q7 pre-fix snapshot inside) | — |
| B8 | `B08-hh-change-forward.png` | — |
| B10 | `B10-reload-mid-quiz.png` | — |
| B11–B12 | `B12-after-cancel.png` (post-cancel only) | — |
| B14 | `B-final-question.yml` (pressed/named buttons; pre-fix dir, env-unlabeled ⇒ Local) | — |
| B15 | `B15-focus-visible.png` | — |
| B17 | — (Esc never pressed) | — |
| B18 | `B18-quiz-360.png` | — |
| B19 | — | — |
| B20 | `B20-final-step.png` (Q8 + "Find my movies") | — (old prod claim artifact-less) |

## C (20) — moods & genres
All local: `C12-genre-cap.png`, `C14-surprise-default.png`, `C14-surprise-none.png`, `C17-action-adventure.png`, `C20-default-surprise.png`, `B03-mood-happy.png` (C1). C2–C11, C13, C15, C16, C18, C19 — none. Production: none.

## D (20) — audience/runtime/language/prefs
All local: `D02-partner.png`, `D04-family-kids.png`, `D08-any-length.png`, `D14-language-any.png`, `D15-q7-toggles.png`, `D15-preference-switches.png`, `D19-two-switches.png`, `D20-verify.png`, shared `B-final-question.yml` (D17 copy, D15 switches). D1, D3, D5–D7, D9–D13, D16, D18 — none. Production: none.

## E (20) — free text & reference titles
| ID | Local | Production |
|---|---|---|
| E1–E6 | `E01-empty.png`, `E02-note.png`, `E03-note-max.png` (200/200), `E05-emoji-unicode.png`, `E06-html-like.png` | — |
| E7 | — | — |
| E8 | `e08-local.png`, `e08-local-wait.png`, `e08-local-enter.png`, `E08-local-final.png` | `e08.png`, `e08-after-enter.png`, `e08-retry.png`, `E08-arrival.png` |
| E9 | `e09-local.png` | `e09.png`, `E09-dune-2021.png` |
| E10 | `e10-local.png` | `e10.png`, `E10-punctuation.png` |
| E11 | `e11-local.png`, `E11-accented.png` (env-unlabeled ⇒ Local) | `e11.png` |
| E12 | `e12-local.png`, `E12-nonexistent.png` (env-unlabeled ⇒ Local) | `e12.png` |
| E13 | `e13-local.png` | `e13.png` |
| E14 | `e14-local.png`, `E14-local-guard.png` | `e14.png`, `e14b.png`, `E14-whitespace.png` |
| E15–E20 | `E15-arrival-autocomplete.png`, `E16-3-refs.png`, `E17-4th-ref-blocked.png`, `E17-cap-message.png`, `E18-remove-ref.png`, `E20-before-reload.png`, `E20-reload-persistence.png` | — |

## F (30), G (20), H (20), I (15), J (15)
No scenario-specific artifacts exist in either evidence tree for **F1–F30, G1–G20, H1–H20, I2–I4, I6–I13, J1, J2, J4–J7, J9–J11, J13, J15** (131 total IDs unrepresented; see ledger). Partial/supporting:
- I1: `B18-quiz-360.png`, `A20-viewport.png` · I5: `A19-viewport.png` · I15: `A20-viewport.png`
- J3: multi-shot absence of auth gate local; `A01-…-deployed.png` prod · J8: `A1-console-errors.txt` (landing only) · J12: `B10-reload-mid-quiz.png` · J14: audit-time `git status` shell output (no repo change outside reports/)
- Unlabeled/unmapped stray files (support no case): `…2026-10-19/undefined.png`, `Q02-input.png`

## Cross-run artifacts (not part of the 200 ledger)
| File | What it proves | Interpretation |
|---|---|---|
| `test-results/baseline-baselines-landing-q1-results-desktop/error-context.md` | local Playwright run took place; Q1 rendered with Movie default; 15,023-px visual diff vs `baseline-q1.png` (maxDiffPixels=50) | visual-regression failure unresolved; excluded from ledger |
| `test-results/.last-run.json` | last suite invocation `status: failed`, 1 failed test (baseline) | no d09/200-case run log survives |
| `test-baseline.txt` | 10 unit files "No test suite found" | runner mismatch, test-infra defect |
| `test-output.txt` (44 KB) | passing `tsx --test` battery incl. fallback-mirror & "no key falls back to catalog" | catalog-fallback behavior real; count corrected to 4,748 |
| `data/movies.json` | **4,748 titles** (ConvertFrom-Json count) | corrects "~5,160" claim |
| `evidence/D09-TC-055-quiz-results.png`, `evidence/TC-055-quiz-results.png` | quiz-results screenshots exist from d09-era runs | *not dated to this run*; not used to upgrade any ledger row (env/commit ambiguous) |

Arithmetic helper: Local PASS 64 + FAIL 1 + BLOCKED 24 + INCON 93 + NOT RUN 18 = 200; Production PASS 10 + INCON 119 + NOT RUN 71 = 200; coverage 9 + 1 + 59 + 131 = 200. ✔

## Fix-battery evidence (2026-10-19, HEAD afd1486 + uncommitted fixes)

- Axe JSON + screenshots per state: reports/axe-evidence/axe-{landing,quiz-q1,quiz-q8-final,error-state,results-state}.{json,png}
- H14 live re-verification: e2e/edge.spec.ts 'api failure: timeout-30s' + e2e/results-fixtures.spec.ts stale-guard test (both PASS); traces under test-results/
- No evidence outside these entries was altered or added for PASS upgrades; Production remains evidence-only-previously-collected.
