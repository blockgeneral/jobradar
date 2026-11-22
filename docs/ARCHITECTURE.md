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
            │ 9 Send: Telegram message · Telegram album · email (SMTP)               │
            │ table jobradar_jobs: one row per match (status, timestamps, outcome)   │
            └───────────────────────────────────────────────────────────────────────┘
                 │ POST /render, /save                         ▲ settings.json, candidate/ (read-only)
            ┌────▼──────────┐      ┌──────────┐
            │ renderer      │─────▶│ Gotenberg│  (PDF)
            │ md → docx/pdf │      └──────────┘
            │ → output/<job>│
            └───────────────┘
```

**Design choices**
- *Direct ATS feeds over job boards and MCP servers* for the poller: deterministic, free, and they update the minute a role is published. MCP servers are great in chat; Hiring Cafe's community MCP is used as one extra source.
- *Rules before AI*: titles, languages, freshness and duplicates are filtered in code, so Claude only sees plausible jobs.
- *Two models*: Haiku screens cheaply; Sonnet writes. Both return schema-constrained JSON (`output_config.format`; the 5.5 models reject forced tool use and `temperature`), so results are always valid JSON. Ranges and list lengths the JSON schema can't express are clamped in the gate.
- *Truth checks in code, not prompts*: every number in a tailored resume must exist in the candidate's files; never-claim patterns; required sections; unchanged contact line. Cover letters are assembled in code — the AI only fills three slots.
- *No public URL needed*: Telegram buttons are polled with `getUpdates`; email buttons are `mailto:` commands read over IMAP.
- *Settings over workflow edits*: users change `settings.json` and `candidate/`; workflows read them on every run, so updates never overwrite personal config.
- *State*: the tracker is an n8n Data Table (survives updates, editable in the UI); per-workflow static data only caches "seen" job IDs.
- *Humans apply*: nothing is ever submitted automatically.

**Source layout**: `src/lib/*.js` (sources, prompts, guardrails, notifications), `src/wf/*.js` (one block per Code node), `build/build.js` → `workflows/*.json`, `renderer/` (Node + docx), `tools/` (CLI helpers), `onboarding/` (interview skill), `test/` (unit + end-to-end with mocks).
