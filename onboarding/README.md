# Onboarding: the 30-minute interview

JobRadar tailors your applications from files that describe you. The better those files, the better every application. This interview builds them with you, like an intake call with a recruiter: one question at a time, follow-ups on the details, and an honest list of what you should never claim.

## Start from what you have
Already have a CV? Run `./jobradar import-cv` (setup offers it too). Claude reads your PDF, writes your starting files, and gives you an honest review: what works, what to fix first, what applicant tracking systems will choke on, and how a recruiter reads you in 10 seconds. The interview then builds on that instead of starting from zero.

## Option A — Claude app (best; voice works)
1. Zip this folder's `SKILL.md` (or the whole `onboarding/` folder) and add it in Claude: **Settings → Capabilities → Skills → Upload**.
2. Start a new chat: *"Run the JobRadar onboarding interview. Here's my CV."* Attach your CV or LinkedIn PDF, and `candidate/cv_review.md` if you ran the import.
3. Use voice mode if you prefer talking. Answer one question at a time.
4. At the end Claude writes your files. Download them into `candidate/` and merge the settings snippet into `settings.json`.

## Option B — any AI chat
Open `PROMPT.md`, copy everything, paste it into a new chat, and go.

## What you get
| File | What it's for |
|---|---|
| `candidate/experience_inventory.md` | Everything true about your work, in detail, plus what to lead with for each type of role you target. Tailoring may use any fact here and nothing else. |
| `candidate/resume_base.md` | Your master resume. Each application starts from this. |
| `candidate/cover_letter_base.md` | Your letter in your voice, with three slots JobRadar fills per job. |
| `candidate/search_profile.md` | Your must-haves (location, language, pay) and preferences. Read for every job. |
| settings snippet | Companies, job-title filters and "never claim" guardrails for `settings.json`. |

Run `./jobradar setup` (or `./jobradar restart`) after updating the files. Redo the interview whenever your story changes.
