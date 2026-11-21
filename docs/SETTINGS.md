# settings.json reference

Changes apply on the next run (every 15 minutes, or `./jobradar run`). Secrets and channels are in `.env`.

| Key | Default | What it does |
|---|---|---|
| `companies` | — | Career-page links. A string, or `{ "url": "...", "name": "...", "dream": true, "enabled": false }`. Supported: Ashby, Greenhouse, Lever (incl. EU), Workable, Recruitee, Personio, SmartRecruiters. |
| `boards.weworkremotely` | `true` | `true` (sales), `false`, or a WWR category slug, e.g. `remote-back-end-programming-jobs`, `remote-design-jobs`. |
| `boards.remotive` | `true` | `true` (sales-business), `false`, or a Remotive category: `software-dev`, `design`, `product`, `customer-support`, `marketing`, … |
| `boards.remoteok` | `true` | `true` (sales), `false`, or a RemoteOK tag: `backend`, `design`, `marketing`, … |
| `boards.jobicy`, `boards.himalayas` | `true` | On/off. Himalayas searches each phrase in `boardQueries`. |
| `boardQueries` | — | 2–4 phrases for your role, used by Himalayas and Hiring Cafe. |
| `hiringCafe` | on, MCP | `via: "mcp"` uses the community MCP server (`mcpUrl`, `queries`, `location`); `via: "apify"` uses an Apify task (`apifyTaskId` + `APIFY_TOKEN` in `.env`). `everyMinutes` limits how often. |
| `filters.freshHours` | `72` | Ignore postings older than this. |
| `filters.titleInclude` / `titleExclude` | — | Lowercase regex fragments. A title must match one include and no exclude. |
| `filters.titleIncludeDream` / `titleExcludeDream` | — | Extra includes / looser excludes for dream companies (e.g. accept SDR roles there). |
| `filters.languageExclude` | — | Phrases that mean a language you don't speak is required ("fluent german"). "X is a plus" stays in. |
| `filters.locationExclude` | `[]` | Optional regexes on the location text (the screener already judges location). |
| `scoring.threshold` / `dreamThreshold` | `70` / `55` | Minimum fit score to notify. |
| `scoring.maxScoredPerRun` / `maxTailoredPerRun` | `40` / `4` | Cost caps per run; extras wait for the next run. |
| `preview.days` / `preview.count` | `7` / `3` | First run only: best N matches from the last N days. |
| `notifications.delivery` | `instant` | `instant`, or `digest` (one summary at `digestTime`; files stay in `output/`). |
| `notifications.style` | `compact` | `compact` = role, score, why, what to check. `detailed` adds gaps, ATS keywords, what changed. |
| `notifications.files` | `["docx"]` | Any of `docx`, `pdf`. |
| `notifications.minScore` | `0` | Track but don't ping below this score. |
| `notifications.quietHours` | `22:30–07:30` | Telegram arrives silently in this window (your `TIMEZONE`). |
| `notifications.buttons` | all on | `linkedinSearch`, `copyOutreachNote`, `statusButtons`. |
| `reports` | Monday 08:30 + monthly | `weekly`, `weeklyDay`, `time`, `monthly`, `checkInAfterDays` (ask about outcomes after N days), `ghostedAfterDays`. |
| `replyDetection.enabled` | `false` | Email users: read new inbox mail that mentions a company you applied to and label it with Claude. Re-run `./jobradar setup` after switching on. |
| `guardrails.neverClaim` | — | `[{ "pattern": "regex", "message": "why" }]` — warns on the card if the tailored files contain it. |
