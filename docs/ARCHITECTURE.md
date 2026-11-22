# Architecture

```
            ┌──────────────── n8n ────────────────────────────────────────────────┐
 every 15m  │ 1 Radar: read settings + candidate → fetch boards → dedupe/filter     │
 ──────────▶│   → Claude Haiku (screen) → gate → Claude Sonnet (tailor)             │
            │   → guardrails → renderer (docx/pdf) → 9 Send → tracker table         │
 every 1m   │ 2 Telegram buttons: getUpdates → tracker + edit card                  │
 IMAP       │ 3 Email buttons: "JR-CMD" mails in the JobRadar folder → tracker      │
 IMAP       │ 4 Reply detection (opt-in): inbox mail about applied companies → Claude│
 hourly     │ 5 Reports & digest: weekly / monthly / daily digest per settings       │
 you        │ 6 Chat (sign-in protected page) → renderer /chat → reply              │
 your inbox │ 7 LinkedIn alerts (IMAP) → jobs in the email → 1 Radar (lead mode)     │
            │ 9 Send: Telegram message · Telegram album · email (SMTP)               │
            │ table jobradar_jobs: one row per match (status, timestamps, outcome)   │
            └───────────────────────────────────────────────────────────────────────┘
                 │ POST /render, /save, /status, /chat         ▲ settings.json, candidate/ (read-only for n8n)
            ┌────▼──────────────┐      ┌──────────┐
            │ renderer (helper) │─────▶│ Gotenberg│  (PDF)
            │ md → docx/pdf     │      └──────────┘
            │ → output/<job>    │──────▶ Claude (chat, tool use)
            │ chat: stage edits │
            │ → save on "yes"   │──────▶ settings.json, candidate/ (the only writer, with .bak)
            └───────────────────┘
```

**Design choices**
- *Direct ATS feeds over job boards and MCP servers* for the poller: deterministic, free, and they update the minute a role is published. MCP servers are great in chat; Hiring Cafe's community MCP is used as one extra source.
- *Rules before AI*: titles, languages, freshness and duplicates are filtered in code, so Claude only sees plausible jobs.
- *Two models*: Haiku screens cheaply; Sonnet writes. Both return schema-constrained JSON (`output_config.format`; the 5.5 models reject forced tool use and `temperature`), so results are always valid JSON. Ranges and list lengths the JSON schema can't express are clamped in the gate.
- *Truth checks in code, not prompts*: every number in a tailored resume must exist in the candidate's files; never-claim patterns; required sections; unchanged contact line. Cover letters are assembled in code — the AI only fills three slots.
- *No public URL needed*: Telegram buttons are polled with `getUpdates`; email buttons are `mailto:` commands read over IMAP.
- *Settings over workflow edits*: users change `settings.json` and `candidate/`; workflows read them on every run, so updates never overwrite personal config.
- *LinkedIn without scraping*: workflow 7 reads LinkedIn's alert emails (IMAP, read-only) and posts the jobs to the radar's webhook as `{leads}`. The radar looks each one up on the company's own board (watched board, a board found before, or a guessed public Ashby/Greenhouse/Lever slug), screens the full posting, and falls back to a title-only card. Dedupe is against jobs that actually got a card (tracker rows with files, or source `linkedin`).
- *State*: the tracker is an n8n Data Table (survives updates, editable in the UI); per-workflow static data only caches "seen" job IDs.
- *Chat edits are staged, consent is checked in code*: Claude in the chat can only stage changes (text replace, facts, settings paths, companies). The helper shows before → after and writes only after the user's own latest message says yes; a bare "yes"/"no" is handled without the model. n8n keeps a read-only mount; the helper is the single writer and keeps a .bak.
- *Run status for "why so quiet?"*: each radar run posts its numbers (filter reasons, screened, sent, broken sources) to the helper (`output/.jobradar/status.jsonl`); the chat reads them.
- *A pasted link uses the board's feed*: known job boards are looked up through their API (pages are often built by JavaScript); unknown sites are read as HTML. Pasted links skip dedupe and filters but say why they'd normally be skipped.
- *Humans apply*: nothing is ever submitted automatically.

**Source layout**: `src/lib/*.js` (sources, prompts, guardrails, notifications), `src/wf/*.js` (one block per Code node), `build/build.js` → `workflows/*.json`, `renderer/` (Node + docx), `tools/` (CLI helpers), `onboarding/` (interview skill), `test/` (unit + end-to-end with mocks).
