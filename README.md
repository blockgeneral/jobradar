# JobRadar

**Be one of the first applicants, with an application that's actually yours.**

Most roles get 100+ applications within hours, and recruiters read the first few dozen. JobRadar checks the career pages of companies you care about every 15 minutes, screens each new role against what *you* want, tailors your resume and cover letter from your own material, checks the AI didn't invent anything, and sends you one tidy notification with the files and an Apply button.

**You always apply yourself.** JobRadar never submits anything, never logs into job sites, never scrapes LinkedIn.

Built with [n8n](https://n8n.io) and [Claude](https://claude.ai). Free and open source (MIT).

```
🎯 Mid-Market Account Executive (EMEA)
🏢 n8n ⭐ · 📍 Remote - EMEA
📊 87/100 · 💶 €130K – €160K OTE · 🕒 22 min ago
✨ Full-cycle AE on a technical product, annual contracts

⚠️ Check before sending
• MEDDPICC is required — your resume doesn't claim it

[🚀 Apply] [📄 Job post]
[🔎 Recruiters] [🔎 Hiring team]
[📋 Copy LinkedIn note]
[✅ Applied] [⏭ Skip]
📎 Your_Name_Resume_n8n.docx · Your_Name_Cover_Letter_n8n.docx
```

---

## What you need (about 20 minutes)

1. **Docker** — [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [OrbStack](https://orbstack.dev) on a Mac, Docker Engine on Linux. Open it.
2. **A Claude API key** — [console.anthropic.com](https://console.anthropic.com) → API keys, with ~$10 of credit. (A Claude app subscription doesn't include API use.) Expect roughly $10–20 a month (estimate; check your usage page after week one).
3. **Somewhere to be notified** — Telegram (a bot you create in 1 minute with @BotFather) and/or email (Gmail, Outlook, iCloud or any SMTP/IMAP mailbox with an app password).

## Install

```bash
git clone https://github.com/<you>/jobradar.git
cd jobradar
./jobradar setup
```

The setup asks for your key, connects Telegram or email (it finds your Telegram chat by itself and tests everything), builds the containers, takes your list of companies, and runs a first search. **Within a few minutes you get your 3 best matches from the last 7 days**, so you can see it working straight away. After that, new matches arrive within ~15 minutes of being posted.

## Step 2: the interview (do this once, it's what makes it good)

JobRadar can only be as good as what it knows about you. The [onboarding interview](onboarding/README.md) is a 30-minute conversation with Claude, like an intake call with a recruiter: one question at a time, follow-ups on the details, and an honest list of what you should never claim. Voice works. It writes four files into `candidate/`:

| File | What it is |
|---|---|
| `experience_inventory.md` | Everything true about your work, in detail. The tailoring step may use any fact here — and nothing else. |
| `resume_base.md` | Your master resume. |
| `cover_letter_base.md` | Your letter in your voice. Only three slots change per job; the rest stays word for word. |
| `search_profile.md` | Your must-haves (where you can work, languages, minimum pay) and preferences. |

## Every day

- A notification arrives. Read the ⚠️ lines, open the two Word files, fix anything, then tap **Apply**.
- Tap **✅ Applied** or **⏭ Skip** so your stats stay honest. (Email: the buttons open a pre-filled email; just hit send.)
- Tap **🔎 Recruiters / Hiring team** and **📋 Copy LinkedIn note** to reach a human the same day.
- Want to edit the files outside Word? Edit `output/<job>/resume.md`, then `./jobradar rerender <job>`.

**Every Monday** you get a report: what was found, what you applied to, responses, rejections, intro calls, how fast you were — and whether applying early actually gets you more replies. On the 1st of each month, a 30-day roll-up. Both ask "what happened with these?" with one-tap answers.

## Email users: no inbox clutter

JobRadar sends to your plus-address (`you+jobradar@gmail.com`). The setup writes a `gmail-filter.xml`; import it once (Gmail → Settings → Filters → Import) and every JobRadar email skips your inbox and lands under a **JobRadar** label. Turn on notifications for that label in the Gmail app so matches still reach your phone.

## Make it yours: `settings.json`

Everything about *what* to find and *how* to notify lives in one file. Highlights (full reference: [docs/SETTINGS.md](docs/SETTINGS.md)):

- `companies` — paste career-page links (`https://jobs.ashbyhq.com/n8n`). Add `"dream": true` for a lower bar. Or run `./jobradar companies`.
- `notifications.style` — `compact` (default) or `detailed`.
- `notifications.files` — `["docx"]`, `["pdf"]` or both.
- `notifications.delivery` — `instant` (default) or `digest` (one summary a day).
- `notifications.quietHours` — Telegram arrives silently at night.
- `notifications.minScore`, `notifications.buttons` — what's worth a ping, which buttons you want.
- `filters` — job titles to keep or drop, languages you don't speak.
- `reports` — weekly day/time, monthly roll-up.
- `replyDetection.enabled` — email users: JobRadar reads only new mail that mentions a company you applied to, and Claude labels it reply / rejection / interview.
- `guardrails.neverClaim` — things that must never appear in your resume (it warns you if they do).

Changes apply on the next run. Keys and channels live in `.env` (`./jobradar setup` again, or edit and `./jobradar restart`).

## Where jobs come from

| Source | How | Speed |
|---|---|---|
| Company career pages on Ashby, Greenhouse, Lever, Workable, Recruitee, Personio, SmartRecruiters | their public job-board feeds | minutes after publishing |
| We Work Remotely, Remotive, RemoteOK, Jobicy, Himalayas | public feeds | minutes to hours |
| Hiring Cafe | the community [Hiring Cafe MCP server](https://hiringcafe-mcp.vercel.app/) (unofficial), or an Apify task | hourly |
| LinkedIn | **not used** — scraping it breaks LinkedIn's terms. Keep your own LinkedIn alerts on. |

## How it decides (and why you can trust the drafts)

1. Rules first (titles, languages, freshness, duplicates) — no AI cost.
2. **Claude Haiku** screens what's left against your search profile: can they hire you where you live, is it English-only, does pay clear your floor, how good a fit (0–100).
3. **Claude Sonnet** tailors your resume and the three cover-letter slots, only from your files.
4. **Guardrails in plain code** check the result: any number not in your files, anything on your never-claim list, a missing section or changed contact details → a ⚠️ line on the card.
5. If Claude is down or out of credit, you still get the job, marked as not screened, with your base files.

## Commands

```
./jobradar setup        first-time setup (safe to re-run to change anything)
./jobradar run          check the job boards right now
./jobradar companies    add companies (paste career-page links)
./jobradar rerender X   rebuild the Word/PDF files after editing output/X/*.md
./jobradar report       send the weekly report now (or: report monthly)
./jobradar status       what's running, which companies, latest jobs
./jobradar update       get the latest version (keeps your data)
./jobradar start | stop | restart | logs
```

Inside n8n (http://localhost:5678) you'll find six workflows and a **jobradar_jobs** table — your application tracker, viewable and editable there.

## Running 24/7

It runs while your computer is awake and Docker is open. On a Mac, keep it plugged in with "Prevent automatic sleeping when the display is off". For true 24/7, put the same folder on a small Linux server (~€4/month) and run `./jobradar setup` there.

## Privacy

Everything runs on your machine. Your files, tracker and keys never leave it, except the job text and your profile sent to Claude for screening/tailoring, and the notifications you chose. `candidate/`, `settings.json`, `.env` and `output/` are git-ignored.

## Troubleshooting

- **Nothing arrives:** n8n → Executions shows each run. The first run only sends jobs from the last 7 days; later runs only *new* jobs.
- **🩺 source alert:** a company link moved or the board changed. Fix it in `settings.json`.
- **Claude 401/credit errors:** check the key and credit at console.anthropic.com, then `./jobradar restart`.
- **Telegram "chat not found":** send your bot a message, run `./jobradar setup` again.
- **Gmail login fails:** you need an *app password* (2-step verification on), not your normal password.

## For developers

- Workflow logic lives in `src/` (`lib/` shared helpers, `wf/` one block per n8n Code node) and is compiled into `workflows/*.json` by `node build/build.js`.
- `node test/unit.js` — adapters, filters, guardrails, notifications, email/reply/digest logic.
- `N8N_BIN=/path/to/n8n bash test/e2e.sh` — boots a real n8n, imports all workflows, runs search → notify → button presses → weekly report against mock boards, Claude, Telegram and SMTP; the renderer makes real Word files. `E2E_CANDIDATE=examples/candidate E2E_SETTINGS=$PWD/settings.example.json E2E_EXPECT=1` runs the same as a fictional backend engineer.
- Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT. Use it, fork it, improve it. If it lands you a job, tell us.
