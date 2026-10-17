# CineMatch 100-Scenario Real-Browser E2E Report

## 1. Run details
- Date/time: 2026-10-16 ~12:00–13:00 UTC. Target: https://movie-night-picker-one.vercel.app/
- Browser: Chromium via Playwright MCP (desktop 1366×768; also 375×812, 768×1024, restored to desktop after).
- Anonymous/public session, no keys, no login. Ordinary traffic: ~1 request per scenario step, paced; no flooding.
- Method: real UI (click/type/Enter, quiz buttons/switches), DOM + network observation per case. Screenshots saved under `evidence/` (PNG validity checked by magic bytes; image *content* described from DOM, not eyeballed — screenshots are supporting artifacts, not primary verification).
- Test-only run: no code, config, or data changes. Note: normal app behavior caches OMDb ratings server-side on some searches (not a tester write).

## 2. Overall outcome
- Attempted 100/100. **PASS 71 · FAIL 12 · PARTIAL 14 · BLOCKED 2 · NOT RUN 1.**
- Highest-impact defects: (1) exact-title endpoint still serves the old failure-masking code in production (D-01); (2) sci-fi vocabulary mismatch empties a headline genre (D-02); (3) Watch options opens Google search, never provider links (D-03).
- Recommendation: **NOT READY for ordinary users** until D-01–D-03 are fixed; everything else is P2/P3.

## 3. Result rows (ID | scenario | query/actions | expected | observed | status | evidence)
### A. Entry/navigation/layout
| 001 | Fresh desktop load | load / | title/hero/controls, no errors | Title "CineMatch - Movie Night Picker", H1, Exact Title/NL toggles, textbox, Start Full Quiz, 0 console errors | PASS | evidence/TC-001-homepage.png |
| 002 | Reload homepage | reload | usable initial state | Same hero/controls, title intact | PASS | DOM snapshot |
| 003 | Brand click | click CineMatch (fresh home) | home/discover | Native confirm "Quit the quiz? Your answers will be cleared." with no quiz active | FAIL Low | modal state observed 2× |
| 004 | Discover | click Discover | destination/scroll | Scroll y 0→602 (sections) | PASS | scrollY |
| 005 | How It Works | click it | section scroll | Scroll y →618 | PASS | scrollY |
| 006 | Header Start Quiz | click | quiz step 1 | "Question 1 of 7", 8 moods, Back/Cancel/Continue | PASS | snapshot |
| 007 | Hero Start Full Quiz | clear storage, click | quiz step 1 | Same step 1 | PASS | DOM |
| 008 | Browser Back from quiz | advance to step 2, browser Back | prior state | Exits SPA to about:blank (no history); in-app Back works + retains answers (verified separately) | PARTIAL | URL + Back test |
| 009 | Scroll top→bottom | scroll | sections/footer, no stuck region | Footer reached, not stuck | PASS | scroll probe |
| 010 | Desktop nav/footer clip | inspect @1366 | no overflow/overlap | scrollWidth == viewport, full nav | PASS | metrics |
### B. Exact-title + NL search
| 011 | Title: Interstellar | Exact Title submit | correct title/year/type | Empty + "No results found", no error; API returned 200 {"results":[],"source":"tmdb","error":"Search failed"} | FAIL High | network body |
| 012 | Title: The Dark Knight | same | correct title/year/type | Empty, no error (same masked failure) | FAIL High | UI |
| 013 | Title: Spirited Away | same | correct title | Empty, no error | FAIL High | UI |
| 014 | Title: Dune 2021 | same | disambiguation | Empty, no error | FAIL High | UI |
| 015 | Title: "  interSTELLAR   " | same | normalization | Empty, no error | FAIL High | UI |
| 016 | Title: Spider-Man: Into the Spider-Verse | same | punctuation | Empty, no error | FAIL High | UI |
| 017 | Title: Interstler (typo) | same | correction or graceful empty | Empty, no crash, no suggestion (endpoint broken anyway) | PARTIAL | UI |
| 018 | Title: nonexistent | same | true empty, not provider-error | Empty shown, but indistinguishable from provider failure on this endpoint | PARTIAL | UI |
| 019 | Empty exact-title | submit empty | validation, no request | "Type what you want to watch", results cleared | PASS | UI text |
| 020 | One-char exact-title | submit "a" | min-length guidance or intentional | Silent no-op, no guidance | PARTIAL | UI |
| 021 | NL: funny sci-fi quiet night | NL submit | comedy + sci-fi evidence | 3 comedies, zero sci-fi substantiation | FAIL High | cards |
| 022 | NL: short mystery <100, no gore | NL submit | runtime/genre, honest safety | 48/55/47 min, Mystery present, no gore promise | PASS | cards |
| 023 | NL: feel-good family comedy | NL submit | relevance + safety disclosure | Relevant, no safety guarantee asserted | PASS | cards |
| 024 | NL: like Arrival, lighter | NL submit | reference/tone handling | Generic defaults, no reference use, no explanation | PARTIAL | cards |
### C. Quiz selection/navigation (profile: Relaxed/Comedy/Just me/U2h/English unless noted)
| 025 | 8 moods | click each | selected feedback ×8 | All 8 show orange selected border; no aria-pressed/selected attributes | PASS (a11y note) | class + attrs |
| 026 | Surprise me exclusive | Surprise me then Action | mutual exclusion | Surprise deselected, Action on | PASS | class |
| 027 | Three genres | Comedy+Sci-Fi+Mystery | all 3 shown selected | All 3 on | PASS | class |
| 028 | Fourth genre | click Horror | max-3 enforced | Horror stayed off (silent; no message) | PASS | class |
| 029 | Deselect genre | click Comedy again | state updates | Comedy off | PASS | class |
| 030 | Audience Just me | select | snapshot update, exclusive | Exclusive on | PASS | class |
| 031 | Audience Partner | select | snapshot update, exclusive | Exclusive on | PASS | class |
| 032 | Audience Friends | select | snapshot update, exclusive | Exclusive on | PASS | class |
| 033 | Audience Family with kids | select | snapshot + age/safety guidance | Exclusive on; "Kid-friendly, safe themes" descriptor | PASS | class + text |
| 034 | Runtime Under 90 min | select | snapshot, exclusive | Exclusive on | PASS | class |
| 035 | Runtime Under 2 hours | select | snapshot, exclusive | Exclusive on | PASS | class |
| 036 | Runtime Under 2.5 hours | select | snapshot, exclusive | Exclusive on | PASS | class |
| 037 | Runtime Any length | select | snapshot, exclusive | Exclusive on | PASS | class |
| 038 | Language English | select | snapshot, exclusive | Exclusive on | PASS | class |
| 039 | Language Korean | select | snapshot, exclusive | Exclusive on (output handling: TC-058) | PASS | class |
| 040 | Language Any | select | snapshot, exclusive | Exclusive on | PASS | class |
| 041 | Back from step 6 | Back | prior answers retained/editable | Step 5, "Any" retained | PASS | UI |
| 042 | Cancel | Cancel + accept | home, answers discarded w/ clear text | Confirm shown, homepage + reset defaults | PASS | storage + UI |
### D. Refinements/notes/references
| 043 | Highly rated toggle | on/off | aria-checked + persistence | true/false | PASS | attrs |
| 044 | Hidden gems toggle | on/off | same | true/false | PASS | attrs |
| 045 | Recent toggle | on/off | same | true/false | PASS | attrs |
| 046 | Classics toggle | on/off | same | true/false | PASS | attrs |
| 047 | Mature toggle | on/off, default off | same | true/false, labeled defaults OFF | PASS | attrs + label |
| 048 | More ways to tune | expand + pick Light & fun | effect/state | Tone/Pace/Intensity/Humor revealed; Light & fun selected | PASS | snapshot |
| 049 | Empty note | leave empty, continue | accepted, no added text | Accepted, no error | PASS | UI |
| 050 | Ordinary note | fill Arrival note | retained, quiz answers intact | Retained verbatim; snapshot unchanged | PASS | field value |
| 051 | Note at 200 chars | fill to boundary | count/limit, no overflow | maxlength=200 | PASS | attrs |
| 052 | Exceed note limit | fill 250 chars | prevented/truncated clearly | Truncated to 200, counter 200/200 | PASS | field + counter |
| 053 | Reference: The Social Network | search + select | in selected list | /api/title-search → 502; UI error "Could not search titles. Please try again." | BLOCKED (provider) | network 502 + UI |
| 054 | 3 references + 4th | add to cap | cap + removal | BLOCKED (same outage; nothing selectable) | BLOCKED (provider) | network 502 |
### E. Recommendations/quality
| 055 | Neutral quiz | submit | loading + time + 3 results | 3 full cards, Fit 99/92/90 (no %), reasons, providers, feedback buttons | PASS | evidence/TC-055-quiz-results.png |
| 056 | Comedy + Sci-Fi quiz | submit | genre evidence per result | 0 sci-fi evidence (same D-02) | FAIL High | cards |
| 057 | Under-90 quiz | submit | every card ≤90 | 45m + 81m, "Your 2…" + removal notice + next steps | PASS | UI text |
| 058 | English-only Mystery quiz | submit | language match or fallback | "Your 1…" Coherence EN + loosen-filter note | PASS | card |
| 059 | Family + Animation quiz | submit | certs/advisories incl. unknown | G + TV-Y7 + PG shown; no Horror/Crime | PASS | cards |
| 060 | No-gore note quiz | note + submit | no false guarantee | Gore disclaimer shown ("…judge that part yourself"), no safety promise | PASS | UI text |
| 061 | Highly-rated Mystery quiz | submit | all ≥7.0 + source labels | Coherence 7.1 only; rating source unlabeled (bare number) | PARTIAL | card |
| 062 | Recent Action quiz | submit | years ≥ cutoff | "No perfect match" + removal reasons + next steps (honest empty) | PASS | UI text |
| 063 | Classics Drama quiz | submit | years < 2000 | "No perfect match" honest empty | PASS | UI text |
| 064 | Hidden-gems Mystery quiz | submit | rule explained + relevant | Coherence + HIDDEN GEM badge; rule not explained in view | PARTIAL | card |
| 065 | Card field audit (Coherence) | inspect | title/type/year/runtime/lang/genres/rating/synopsis/poster/reason | All present, poster alt="Coherence"; media type unlabeled | PARTIAL | DOM |
| 066 | Exactly-3 guarantee | observe 3/2/1/0 states | actual count + reason + next steps | "Your 3/2/1…", "Only found…", removal lines, Adjust/Start-over — all observed across runs | PASS | UI texts |
| 067 | Fit score vs explanation | inspect | no %/probability, supported features | "Fit 96/100" + feature reasons; no % anywhere | PASS | UI text |
| 068 | Movie vs series | inspect | series labeled if shown | No series encountered (movies-only catalog); no media labels exist | PARTIAL | cards |
### F. Streaming/outbound
| 069 | Watch options (has provider) | click on Prime Video card | useful provider action | New tab: Google search "watch Coherence movie" — not Prime Video | FAIL High | tab URL |
| 070 | Watch options (no provider) | click on "Not available" card | honest disabled state | Same Google search tab | FAIL High | tab URL |
| 071 | Country specificity | inspect offers | visible/discoverable country | "in your country" with no country named anywhere | PARTIAL | UI text |
| 072 | Offer types | inspect | subscription/free/rent/buy split | (Stream) vs (Rent) labels shown (JioHotstar/Hotstar/Apple TV) | PASS | cards |
| 073 | Title-specific links | inspect destinations | title pages, not homepages | Google search URLs, not provider title pages | FAIL High | tab URLs |
| 074 | External safety + state | new tab behavior | safe open, app state kept | New tab opened, app tab + results intact | PASS | tabs |
| 075 | Logos/labels/images | inspect | named, unbroken | Posters proxied w/ alt; provider logo imgs have empty alt | PARTIAL | DOM |
| 076 | Freshness caveat | inspect | timestamp or caveat | No timestamps/missing-data caveats on offers | PARTIAL | UI |
### G. Saved picks/feedback
| 077 | Save one | Save pick (Toy Story) | state + count | localStorage saved, "Saved Picks 1" | PASS | storage + UI |
| 078 | Save twice | toggle save/unsave | no duplicates | Toggle semantics; max 1 entry ever | PASS | storage |
| 079 | Open Saved Picks | click | title/details present | Full card + "Stored only in this browser" + count 1 | PASS | UI |
| 080 | Back to recommendations | Back | expected screen | Same 3 results restored | PASS | UI |
| 081 | Remove item | Unsave | list + count update | Empty list, button back to "Save pick" | PASS | storage + UI |
| 082 | Reload after save | save + reload | persistence | Toy Story persisted | PASS | storage |
| 083 | Empty saved view | clear + open | helpful empty state | "0 saved", guidance + CTA | PASS | UI text |
| 084 | Seen it | click on card | confirmation + exclusion path | Card shows "Marked" | PASS | card text |
| 085 | Not for me | click on card | confirmation + preference path | Second card "Marked" | PASS | card text |
| 086 | More like this (Fox) | click | related set, seed excluded, explained | 1 new result, seed excluded, removal line shown | PASS | UI |
### H. Alternatives/retry/errors
| 087 | Show me 3 more | click | distinct new titles, accurate labels | "No perfect match", 0 titles (honest empty; button over-promises) | PARTIAL | UI |
| 088 | Cycle 3 Alternates | click from full set | distinct/understandable, filters kept | Fresh distinct title (Lady and the Tramp), honest count | PASS | UI |
| 089 | Start over | click | reset as promised | Clean homepage, no quiz/results | PASS | UI |
| 090 | Retry after failure | use retry control | retries once + feedback | No recoverable failure with a retry control occurred | NOT RUN (no failure) | — |
| 091 | Provider failure vs empty | observe a real outage | distinct states | 502 → "Could not search titles…" vs "No results found" (TC-053) | PASS | network + UI |
| 092 | Rate-limit messaging | only if natural | clear message | Hit naturally: "Too many searches, try again in a few minutes." | PASS | UI + 429s |
### I. Privacy/a11y/mobile/cleanup
| 093 | Privacy wording | compare home vs results | match notices | Home "No tracking" vs results "aggregate counts on our server" — contradictory | PARTIAL | quoted copy |
| 094 | Local storage audit | list keys | key names only | local: cinematch:taste:&lt;uuid&gt;, cinematch:anon-id:v1, cinematch:saved-picks:v1; session: cinematch:quiz-state:v1 | PASS (info) | key names |
| 095 | Reset my taste | click | what resets + accurate confirm | Taste key removed, saves + anon-id kept | PASS | storage |
| 096 | Keyboard-only | Tab/Shift+Tab/Space/Enter | focus, order, activation | Logical order, visible focus, Space toggles mode, Enter submits | PASS | observed |
| 097 | Headings/labels/alt/live | audit | H1, labels, names, alt, announcements | H1 ✓, 0 unnamed buttons ✓, html lang ✓; input placeholder-only (no label); 0 aria-live regions | PARTIAL | DOM |
| 098 | Mobile 375×812 | resize + inspect | nav/cards/controls, no overflow | Measured 375×812, condensed nav, no overflow, search usable | PASS | metrics + snapshot |
| 099 | Tablet 768×1024 | resize + inspect | layout, touch targets | Measured 768×1024, full nav, no overflow | PASS (tap sizes unmeasured) | metrics |
| 100 | Restore + cleanup | desktop, close tabs, clear picks | neutral homepage | 1366×768, tabs closed, saved=[] , home clean | PASS | metrics + storage |

## 4. Defect log
| ID | Sev | Title | Repro | Expected vs actual | Fix |
|---|---|---|---|---|---|
| D-01 | P0 | Exact-title endpoint serves un-migrated failure-masking code in prod | Exact Title → "Interstellar" | Year/type suggestions vs "No results found" + hidden 200/error body | Migrate api/index.ts /api/search-title to searchTitles() (already written for server.ts) |
| D-02 | P0 | Sci-Fi genre vocabulary mismatch | NL "science fiction…" or Comedy+Sci-Fi quiz | Sci-fi results vs 0 results | Normalize Sci-Fi↔Science Fiction at SQL boundary |
| D-03 | P0 | Watch options opens Google search, never provider links | Any card → Watch options | Provider deep link or honest disabled state vs google.com search tab | Wire Watchmode URLs; disable with reason when none |
| D-04 | P2 | Brand click shows quit-confirm on fresh homepage | Click CineMatch brand on load | Home/discover vs "Quit the quiz?" | Only confirm when answers exist |
| D-05 | P2 | Quiz options lack aria-pressed; search input unlabeled; no live regions | Inspect attrs | Selected/labelled/announced vs class-only + placeholder-only + 0 live regions | Add states, label, aria-live |
| D-06 | P2 | Card gaps: rating source, media type, gem rule | Inspect card | Labeled source/type/rule vs bare number, no type, badge-only | Add source/type labels + rule tooltip |
| D-07 | P2 | Privacy copy contradicts behavior | Read footer + storage | One true story vs "No tracking" + anon-id + aggregation | Align copy or gate telemetry behind opt-in |
| D-08 | P3 | Empty-alt provider logos; no availability timestamps; silent 1-char gate | Inspect | Named/fresh/clear vs alt="" + no timestamps + silent no-op | Alt text, checked-at, min-length hint |

## 5. Data quality
Irrelevant: sci-fi queries (vocab), plot queries answered with generic defaults (themeRefs unwired). Wrong metadata: none observed. Missing: rating sources, media labels, advisory data (honestly disclosed). Duplicates: 0/100. Score claims: Fit N/100 + feature reasons everywhere; no % or probability language observed.

## 6. Accessibility/responsive (actually performed)
1366×768, 375×812, 768×1024 measured; no horizontal overflow at any width; keyboard order/activation verified; H1 on home, H2-led results view; 0 unnamed buttons; poster alts descriptive; provider-logo alts empty; no axe/Lighthouse run (no tooling in this environment — NOT RUN, not claimed).

## 7. Limits
- No mobile-device touch testing (emulation only); tap sizes unmeasured.
- Quiz Back covered in-app only; browser-back exits SPA (no history) — environmental.
- Reference-title cap (TC-054) blocked by live TMDB outage; quiz Back covered in-app only.
- TC-090 had no natural failure to retry. Screenshots: 2 saved (valid PNGs); content verified via DOM, not eyeballed.
- ~60 API calls total across ~2h, paced; two self-induced 429s, recovered after waits.

## 8. Evidence assets
- `evidence/TC-001-homepage.png` (valid PNG) — initial load.
- `evidence/TC-055-quiz-results.png` (valid PNG) — full result cards with Fit scores.
- Console: 0 errors at end (1 transient 429 mid-run). Network: all 200 except two self-induced 429s.

## 9. Summary — top 3 fixes
1. Migrate the prod exact-title endpoint to the shared searchTitles() (D-01) — un-breaks title search + reference flow input.
2. Normalize the Sci-Fi genre at the SQL boundary (D-02) — restores a headline genre.
3. Wire real provider deep links with an honest disabled state (D-03) — the most-clicked action currently deceives.
**Ready for ordinary users? No** — D-01–D-03 break search, a genre, and streaming actions respectively. Everything else is shippable with notes.

---

## 10. Rerun after defect fixes — 2026-10-17

### 10.1 Run details
- Target: **http://localhost:3101** — the fixed code from branch `fix/cinematch-d01-d08` (local dev server). **Nothing was deployed**; production still serves the old build.
- Browser: real (headless) Chromium via scripted Playwright, single worker, ordinary sequential pace. One test per original scenario: `e2e/d09-e2e-100.spec.ts` (TC-001…TC-100), full stdout captured.
- Viewports actually measured: **1366×768** for all scenarios, **375×812** during TC-098, **768×1024** during TC-099, restored to 1366×768 in TC-100.
- Live services during the run: catalogue Postgres up (4748 rows), OMDb up, Watchmode up (region IN), **TMDB unreachable from this machine/network** (re-confirmed after the run: `GET /api/search-title?q=Interstellar` → 502 within timeout).
- Screenshots: `evidence/D09-TC-001-homepage.png`, `evidence/D09-TC-055-quiz-results.png` (PNG magic bytes verified). Playwright traces/screenshots under `test-results/`.

### 10.2 Overall outcome
- Attempted 100/100. **PASS 95 · FAIL 0 · PARTIAL 0 · BLOCKED 5 · NOT RUN 0.**
- Blocked, all by the external TMDB outage (never counted as PASS): **TC-011, TC-012, TC-013, TC-014, TC-016** — these need live provider results. In each one the D-01 contract was verified live instead: HTTP 502 with a visible retryable alert, never a masked "No results". (TC-014/TC-016 also verified the outgoing query survives year/whitespace/punctuation encoding.)
- Simulated, disclosed: TC-018 genuine-empty state stubbed with a 200 body; TC-090 one aborted `/api/recommend` request; TC-092 429 body replayed. TC-011/TC-091 used the real live outage.
- Previous run for comparison: PASS 71 · FAIL 12 · PARTIAL 14 · BLOCKED 2 · NOT RUN 1.

### 10.3 Scenario statuses (rerun)
| IDs | Status | Notes |
|---|---|---|
| 001–010 | PASS ×10 | Hero, nav/scroll, brand click on fresh home shows no quit-confirm (D-04), in-app Back keeps answers, no overflow at 1366×768 |
| 015 | PASS | Whitespace trimmed, case preserved in the outgoing query (`q=interSTELLAR`) |
| 017 | PASS | Typo query: no crash; provider outage surfaced as retryable error, no fabricated suggestion |
| 018 | PASS | Genuine empty (stubbed 200) shows "No results found" with no alert; error state carries `role=alert` |
| 011–014, 016 | BLOCKED (provider) ×5 | TMDB unreachable; live 502 + retryable alert path (D-01) verified |
| 019–052 | PASS ×34 | Quiz flows: selection/deselection exclusivity, caps, aria-pressed on all option groups (D-05), switch aria-checked, notes 200-char boundary, Cancel confirm + clear, 1-char guidance (D-08) |
| 053–054 | PASS ×2 | Reference search now OMDb-backed: live chips carry real IMDb `tt` ids; cap 3 + removal works (previously BLOCKED) |
| 055–068 | PASS ×14 | Results: loading → 3 full cards; Comedy+Sci-Fi returns sci-fi evidence (D-02); runtime caps; noise-free safety wording; rating-source labels (D-06); media type labels (D-06); hidden-gem rule explained (D-06); Fit N/100 only, no %/probability; counts match what is shown; "Show me 3 more"/alternates report the real count (D-counts) |
| 069–076 | PASS ×8 | Watch options = verified provider link only, no google.com search anywhere; disabled "No watch link" with named reason when none (D-03); new tab keeps app state; no fabricated freshness timestamps (D-08) |
| 077–089 | PASS ×13 | Save/unsave/persist, Saved Picks view, Seen it / Not for me, More like this excludes the seed, Start over resets |
| 090–092 | PASS ×3 | Retry recovers after a simulated single failure; provider-failure vs converse empty are distinct states; 429 message clear (simulated 429 body) |
| 093–100 | PASS ×8 | Privacy copy matches actual storage/requests (D-07), storage keys audit, "Reset my taste" clears local state and calls the server, keyboard-only pass, H1/labelled inputs/named controls/live regions (D-05), 375×812 and 768×1024 no overflow, clean finish at 1366×768 |

### 10.4 Defect verification
| ID | Fixed in | Verified by |
|---|---|---|
| D-01 | `api/index.ts` + `server.ts` now both use shared `server/titleSearch.ts: searchTitles()` | Unit: `tests/titleSearch.test.ts` (injected fetch: success, timeout→502, 429 passthrough, empty≠error). Live: TC-011/TC-091 502 + retryable alert. Provider-success path BLOCKED by the TMDB outage here |
| D-02 | `server/genres.ts` canonicalisation (Sci-Fi ↔ Science Fiction ↔ sci fi), used at SQL boundary + ranking + enrichment | TC-056 returns sci-fi-tagged picks; `tests/dbMovies.test.ts` covers the SQL sets; `tests/genres.test.ts` |
| D-03 | `server/watchmode.ts` provider URLs; `MovieCard` link-only-or-disabled | TC-069/070/073/074: real provider URL, no search fallback anywhere, disabled control named, app state preserved |
| D-04 | `App.tsx handleBrandClick` confirms only when progress/results exist | TC-003 (no dialog on fresh home); confirm path shares `handleCancel` covered by TC-042 |
| D-05 | `Wizard.tsx`/`App.tsx` aria-pressed, input labels, live regions | TC-025, TC-096, TC-097; axe suite: 0 serious/critical violations |
| D-06 | `MovieCard.tsx` media type + rating source badges, gem rule text; `omdb.ts` ratingSource | TC-061, TC-064, TC-065, TC-067, TC-068 |
| D-07 | New copy + `POST /api/taste/reset` (`deleteAnonData`) | TC-093/094/095; `tests/learning.test.ts` (anon-data isolation) |
| D-08 | Provider logo `aria-hidden`, no invented timestamps, min-length hints | TC-020, TC-075, TC-076 |

### 10.5 Automated checks (same commit)
- `npx tsc --noEmit` / `npm run lint`: clean. `npm run build` (vite): OK.
- `npm test` (vitest): 303 tests — 298 pass, 0 fail, 5 skipped.
- Existing browser suites re-run green after updating 2 stale assertions in `e2e/feedback.spec.ts` (watch control is a link or a disabled button; new D-07 copy) and singular/plural results-heading regexes: visual, baseline screenshots, feedback, smoke, edge, personas, axe — all pass.
- New regression coverage added: `tests/genres.test.ts`, `tests/titleSearch.test.ts`, `tests/dbMovies.test.ts`, `tests/learning.test.ts`, `tests/noteParser.test.ts`.

### 10.6 Limits of this rerun
- Headless only; no touch/real-device testing, tap sizes unmeasured (unchanged from run 1).
- Browser Back still exits the SPA (no history entry) — environmental, unchanged.
- D-01 provider-success rendering could not be exercised live (TMDB outage); covered by unit tests with injected fetch.
- Rate-limit messaging (TC-092) verified with a replayed 429 body, not a natural hit.

