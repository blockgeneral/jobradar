# Getting started (~20 minutes)

JobRadar runs in Docker, so it's the same on every computer. Only the first step differs: **Mac**, **Windows** or **Linux**. Then everyone continues at [Step 2](#2-get-a-claude-api-key).

---

## 1. Install Docker and open a terminal

### Mac
1. Install **Docker Desktop** (Apple chip or Intel): https://www.docker.com/products/docker-desktop/ — or [OrbStack](https://orbstack.dev).
2. Open it, accept the terms, skip sign-in, and wait for **Engine running** (bottom-left).
3. Docker Desktop → Settings → General → **Start Docker Desktop when you sign in**.
4. Open **Terminal** (⌘ + Space → "Terminal").

### Windows 10 / 11
JobRadar runs inside **WSL** (a built-in Linux layer). Docker Desktop uses it anyway.
1. Open **PowerShell as Administrator** and run:
   ```powershell
   wsl --install -d Ubuntu
   ```
   Restart when asked. Ubuntu opens and asks you to pick a username and password.
2. Install **Docker Desktop for Windows**: https://www.docker.com/products/docker-desktop/ — keep **"Use WSL 2"** ticked.
3. Docker Desktop → Settings → **Resources → WSL integration** → switch **Ubuntu** on → Apply.
4. Open **Ubuntu** from the Start menu (or Windows Terminal → Ubuntu tab). **Run every command below in this Ubuntu window** — not PowerShell, not Git Bash.
5. Stay in your Ubuntu home folder (`cd ~`). Don't clone into `/mnt/c/...` — it's slower and file permissions get odd.

Tips: dragging your CV from Windows Explorer into the Ubuntu window works. To open your files later: `explorer.exe output` from the `jobradar` folder.

### Linux
1. Install **Docker Engine** with the compose plugin: https://docs.docker.com/engine/install/
2. Let your user run Docker without sudo: `sudo usermod -aG docker $USER`, then log out and back in.
3. Open a terminal.

---

## 2. Get a Claude API key
1. https://platform.claude.com → sign in.
2. Credit:
   - **On Claude Max or Team?** Your plan includes monthly API credits ($100 on Max 5x, $200 on Max 20x). On claude.ai go to **Settings → Billing → API credits → Link organization** and pick your Console org. No card needed. Unused credit expires each billing cycle; when it runs out, JobRadar pauses until the next cycle (nothing is charged).
   - **Otherwise:** Console → **Billing** → add $10 credit.
3. **API keys** → **Create key** → "Somewhere else (API key)" → name it `jobradar` → copy it (`sk-ant-…`). Don't paste it anywhere but the setup wizard.
4. Recommended: Console → **Limits** → set a monthly spend limit (e.g. $50–75), so a misconfiguration can't burn your whole balance.

Pro and other app-only plans don't include API use. Expect roughly $10–20/month.

## 3. Choose where notifications go
- **Telegram:** open **@BotFather** → `/newbot` → any name → copy the **token**.
- **Email:** your address + an **app password** (Gmail: https://myaccount.google.com/apppasswords — needs 2-step verification; Outlook and iCloud have the same).

## 4. Have your CV as a PDF
Word: **File → Save as PDF**. LinkedIn: your profile → **More → Save to PDF**.

## 5. Download JobRadar and run setup
```bash
cd ~
git clone https://github.com/blockgeneral/jobradar.git
cd jobradar
./jobradar setup
```
Mac: if asked to install "command line developer tools", click **Install** and run the commands again.
Linux/WSL: if `git` is missing, `sudo apt install -y git`.

## 6. Answer the setup questions

| Setup asks | What to do |
|---|---|
| Time zone | Enter if it's right (e.g. `Europe/Vienna`) |
| 1 · Claude API key | Paste it — it's tested on the spot |
| 2 · Notifications | `1` Telegram · `2` Email · `3` Both |
| Telegram token | Paste it, then open your bot in Telegram and press **Start** — setup finds your chat |
| Email | Address + app password; setup writes `gmail-filter.xml` and shows how to import it |
| 3 · Your profile | `1` Import my CV |
| CV file | Drag the PDF into the terminal window, press Enter |
| Roles | e.g. `Account Executive, Partnerships Manager` |
| Where you can work | e.g. `Vienna; remote EU/EMEA or via EOR; hybrid Vienna` |
| Minimum pay | e.g. `120k USD OTE` — or Enter to skip |
| What matters in a company | e.g. `remote-first, product I believe in, well-run, learning from great people` |
| 4 · Companies | One per line: a careers-page link **or** just a company name. `*` = dream company. Empty line to finish — or skip and add them later in the chat |

You'll see your **CV review**, then setup builds and starts everything (a few minutes the first time) and runs a first search.

## 7. Check it worked
- A **test message** arrives in Telegram (or email).
- Within minutes: **up to 3 job cards** from the last 7 days, each with your tailored resume and cover letter (Word).
- Your profile is in `candidate/`, each job's files in `output/`.

## 8. Make it yours — in the chat
- Run `./jobradar chat`. The first time, n8n asks you to create a local login (only on your computer) — then the chat opens.
- Say **"interview me"**: it asks the open questions from your CV review one at a time and saves your answers to your fact sheet, which makes tailoring much better.
- Change anything the same way: companies, filters, pay, quiet hours, "why so quiet?", or paste a job link to check it now. Every change is shown first and saved only when you say yes.
- Prefer files? Everything also lives in `candidate/` and `settings.json` ([reference](SETTINGS.md)). The voice interview for Claude app users: [onboarding/README.md](../onboarding/README.md).

## Everyday commands
```bash
./jobradar chat         # change anything in plain words
./jobradar run          # check job boards now
./jobradar companies    # add companies
./jobradar import-cv    # import a new CV version
./jobradar status       # what's running + latest jobs
./jobradar report       # weekly report now
./jobradar update       # latest version, keeps your data
./jobradar stop | start | logs
```

## Keep it running
It checks every 15 minutes while the computer is awake and Docker is running.
- **Mac:** System Settings → Battery → Options → *Prevent automatic sleeping when the display is off* (on power).
- **Windows:** Settings → System → Power → *When plugged in, put my device to sleep after* → Never. Keep Docker Desktop running.
- **Always-on:** the same folder works on a small Linux server (~€4/month).

## If something goes wrong
- **"Docker isn't running"** — open Docker Desktop, wait for *Engine running*. Windows: check WSL integration for Ubuntu is on.
- **"runs inside WSL"** — you're in Git Bash or PowerShell; open the Ubuntu window instead.
- **Key rejected** — add credit in the Anthropic console.
- **Telegram chat not found** — press Start in your bot, run `./jobradar setup` again.
- **No job cards** — `./jobradar logs`, and check n8n → Executions at http://localhost:5678.
