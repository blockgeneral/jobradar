# settings.json reference

Changes apply on the next run (every 15 minutes, or `./jobradar run`). Secrets and channels are in `.env`.

| Key | Default | What it does |
|---|---|---|
| `companies` | — | Career-page links (a string, or `{ "url": "...", "name": "...", "dream": true, "enabled": false }`), or a name only (`{ "name": "PetsApp", "aliases": ["PetsApp Ltd"] }`) to recognise that company on every job board. Polled directly: Ashby, Greenhouse, Lever (incl. EU), Workable, Recruitee, Personio, SmartRecruiters, Pinpoint. Companies added with ➕ live in the `jobradar_watch` table. Add `"relocateTo": ["United Kingdom", "Ireland"]` for a company you'd move for (e.g. it sponsors visas): roles based there count as hireable, and its open roles get one fresh look. Add `"repvue": 4.3` to show that company's RepVue rating on its cards (you look it up; JobRadar doesn't fetch RepVue). |
| `boards.weworkremotely` | `true` | `true` (sales), `false`, or a WWR category slug, e.g. `remote-back-end-programming-jobs`, `remote-design-jobs`. |
| `boards.remotive` | `true` | `true` (sales-business), `false`, or a Remotive category: `software-dev`, `design`, `product`, `customer-support`, `marketing`, … |
| `boards.remoteok` | `true` | `true` (sales), `false`, or a RemoteOK tag: `backend`, `design`, `marketing`, … |
| `boards.jobicy`, `boards.himalayas` | `true` | On/off. Himalayas searches each phrase in `boardQueries`. |
| `boards.openabroad` | `true` | `true` (sales), `false`, or an [Open Abroad](https://openabroad.org) kind of work: `software`, `marketing`, `design`, `data`, … (the slug in openabroad.org/work/<kind>/) |
| `boards.trulyremotework` | `true` | `true` (sales), `false`, or a TrulyRemoteWork category: `engineering`, `marketing`, … (an unknown category returns nothing, and the source check tells you after a day) |
| `boards.workable_search` | `true` | On/off. Workable's cross-company search, one request per phrase in `boardQueries` and place in `workableSearch`. |
| `workableSearch` | `[{ "location": "Europe", "remoteOnly": true }]` | Where the Workable search looks. A country (`{ "location": "Austria" }`) finds on-site, hybrid and remote roles there; add `"remoteOnly": true` for remote only. |
| `boards.jobgether` | `true` | On/off. [Jobgether](https://jobgether.com)'s API for agents (workflow 8, hourly). Listings name company, title and where applicants can be; JobRadar looks for the full posting on the company's own job board, else sends a title-only card. |
| `jobgetherLocations` | `["europe"]` | Jobgether location slugs, e.g. `["austria"]` (roles open to people in Austria, including EMEA- and worldwide-remote ones). |
| `boards.getro` | `true` | On/off. European VC portfolio job boards (workflow 8, every 3 hours): new jobs in their sitemaps whose title you want are read from the job's own page. |
| `vcBoards` | 9 boards | Replace the list of Getro-hosted boards, e.g. `["jobs.pointnine.com", "careers.speedinvest.com"]`. |
| `boardEvery` | `{ "openabroad": 60, "trulyremotework": 30, "workable_search": 60, "jobgether": 60, "getro": 180 }` | How often (minutes) the slower boards are read. The classic remote feeds and company boards run every 15 minutes. |
| `boardQueries` | — | 2–4 phrases for your role, used by Himalayas, Workable search, Jobgether and Hiring Cafe. |
| `hiringCafe` | on, MCP | `via: "mcp"` uses the community MCP server (`mcpUrl`, `queries`, `location`); `via: "apify"` uses an Apify task (`apifyTaskId` + `APIFY_TOKEN` in `.env`). `everyMinutes` limits how often. |
| `filters.freshHours` | `72` | Ignore postings older than this. |
| `filters.titleInclude` / `titleExclude` | — | Lowercase regex fragments. A title must match one include and no exclude. |
| `filters.titleIncludeDream` / `titleExcludeDream` | — | Looser excludes for dream companies. |
| `filters.dreamAnyTitle` | `true` | At dream companies every role that isn't excluded gets screened (the AI judges fit). `false` = dream roles must match `titleInclude` / `titleIncludeDream` too. |
| `filters.languageExclude` | — | Phrases that mean a language you don't speak is required ("fluent german"). "X is a plus" stays in. |
| `filters.locationExclude` | `[]` | Optional regexes on the location text (the screener already judges location). |
| `scoring.minSkillsFit` / `minValuesFit` | `50` / `50` | A role appears only when both are met (dream companies: skills −10). |
| `scoring.repvueMin` | — | Cards for a company whose `repvue` is below this say so, e.g. `4`. Nothing is dropped. |
| `scoring.instantAt` | `75` | Overall score for an instant, tailored notification. Below it (but above the minimums) → daily "worth a look" list. Dream companies are always instant. |
| `scoring.maxScoredPerRun` / `maxTailoredPerRun` | `40` / `4` | Cost caps per run; extras wait for the next run. |
| `preview.days` / `preview.count` | `7` / `3` | First run only: best N matches from the last N days. |
| `notifications.delivery` | `instant` | `instant`, or `digest` (everything in one summary at `digestTime`; files stay in `output/`). The "worth a look" list is sent at `digestTime` either way. |
| `notifications.style` | `compact` | `compact` = role, score, why, what to check. `detailed` adds gaps, ATS keywords, what changed. |
| `notifications.files` | `["docx"]` | Any of `docx`, `pdf`. |
| `notifications.quietHours` | `22:30–07:30` | Telegram arrives silently in this window (your `TIMEZONE`). Add `"pause": true` to stop the radar in this window instead: no AI cost, no messages; LinkedIn alert jobs wait and are checked on the first run after it. Runs you start yourself still go through. |
| `notifications.buttons` | all on | `linkedinSearch`, `copyOutreachNote`, `statusButtons`. |
| `reports` | Monday 08:30 + monthly | `weekly`, `weeklyDay`, `time`, `monthly`, `checkInAfterDays` (ask about outcomes after N days), `ghostedAfterDays`. |
| `replyDetection.enabled` | `false` | Email users: read new inbox mail that mentions a company you applied to and label it with Claude. Re-run `./jobradar setup` after switching on. |
| `guardrails.neverClaim` | — | `[{ "pattern": "regex", "message": "why" }]` — warns on the card if the tailored files contain it. |
