<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# CineMatch — Movie Night Picker

Tiny, cinematic movie-recommendation site: answer 7 quick questions about
your vibe, get exactly 3 picks with where-to-watch info. No accounts.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install --legacy-peer-deps`
2. Copy `.env.example` to `.env` and set keys (all server-side only):
   - `OMDB_API_KEY` — movie details/ratings/posters (https://www.omdbapi.com/apikey.aspx)
   - `WATCHMODE_API_KEY` + `WATCHMODE_REGION` — live streaming availability
   - `TMDB_API_KEY` — primary discovery (broad candidate search; without it
     the site falls back to its built-in catalog). Free at
     https://www.themoviedb.org/settings/api. Attribution required:
     "This product uses the TMDB API but is not endorsed or certified by TMDB."
   - `GEMINI_API_KEY` (optional) — warmer personalized reasons
3. Run the app:
   `npm run dev` (uses `tsx server.ts`; Vite middleware in development)

## Checks

- `npm run lint` — TypeScript type check
- `npm test` — relevance/unit/integration suite (`tsx --test`)
- `npm run build` — production client bundle; serve with `NODE_ENV=production`

## How recommendations work

Quiz + free-text note → note understanding (rule-based) → candidate
pool (TMDB discovery + local catalog) → hard filters (language, runtime,
maturity, era, exclusions — never silently relaxed) → weighted ranking
(`server/ranking.ts`, configurable `RANK_WEIGHTS`) → diversity selection →
factual match reasons → live providers. Relaxations are reported as
`notices` and shown in the UI; an impossible query returns partial/empty
results with guidance instead of unrelated filler.
