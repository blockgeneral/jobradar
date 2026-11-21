#!/usr/bin/env bash
# Drives the real ./jobradar setup wizard as a brand-new user, with a fake `docker` (test/fake-docker) mapping
# containers to a local n8n + renderer and every external API to test/mock-server.js.
#   N8N_BIN=/path/to/n8n bash test/setup-wizard.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W=/tmp/jobradar-wizard; S=/tmp/jobradar-wizard-state
for p in $(ps aux | grep -E '[n]8n start|[r]enderer/server\.js|[m]ock-server\.js' | awk '{print $2}'); do kill "$p" 2>/dev/null || true; done; sleep 1
rm -rf "$W" "$S"; mkdir -p "$S"
git -C "$ROOT" archive --format=tar HEAD | (mkdir -p "$W" && tar -x -C "$W")   # exactly what a git clone gives you
cp -r "$ROOT/renderer/node_modules" "$W/renderer/"                             # (the Docker image would npm install these)
node "$ROOT/test/mock-server.js" 5689 "$S/mock" > "$S/mock.log" 2>&1 & MP=$!
trap 'kill $MP 2>/dev/null; for p in $(cat "$S"/pids 2>/dev/null); do kill "$p" 2>/dev/null; done' EXIT
sleep 1
# a CV to import
node -e "const {toHtml}=require('$ROOT/renderer/render.js');require('fs').writeFileSync('$S/cv.html',toHtml(require('fs').readFileSync('$ROOT/examples/candidate/resume_base.md','utf8'),'resume','CV'))"
google-chrome --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf="$S/My CV.pdf" "file://$S/cv.html" >/dev/null 2>&1

export PATH="$ROOT/test/fake-docker:$PATH" FAKE_DOCKER_STATE="$S" FAKE_N8N_BIN="${N8N_BIN:-n8n}" FAKE_API=http://127.0.0.1:5689
export ANTHROPIC_BASE_URL=$FAKE_API TELEGRAM_API_BASE=$FAKE_API JOBRADAR_HOOK=http://127.0.0.1:5698/webhook
# answers, in order: time zone · key · channel (1 = Telegram) · bot token · (chat found automatically) · profile 1 = import CV ·
# CV path (drag-and-drop style) · roles · location · pay · companies (2 links + 1 bad) · empty line ends the list
ESCAPED_CV="$(printf '%s' "$S/My CV.pdf" | sed 's/ /\\ /g') "
cd "$W"
printf '%s\n' "Europe/Vienna" "wrong-key" "test-key" "1" "123:abc" "1" "$ESCAPED_CV" "Backend engineer" "Lisbon; remote EU" "75k EUR" "remote-first, strong engineering culture" \
  "https://jobs.ashbyhq.com/supabase*" "https://job-boards.greenhouse.io/anthropic" "https://example.com/careers" "" \
  | ./jobradar setup 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee "$S/setup.out"
echo; echo "──── checks"
ok() { echo "  ✔ $*"; }
grep -q "^ANTHROPIC_API_KEY=test-key" .env && ok ".env has the working key (bad key was rejected first)"
grep -q "That key didn't work" "$S/setup.out" && ok "invalid key rejected with a clear message"
grep -q "^TELEGRAM_CHAT_ID=42" .env && ok "Telegram chat id found automatically"
[ "$(stat -c %a .env)" = 600 ] && ok ".env is private (600)"
for f in resume_base.md cover_letter_base.md experience_inventory.md search_profile.md cv_review.md; do [ -f "candidate/$f" ] || { echo "missing candidate/$f"; exit 1; }; done; ok "CV imported → 4 candidate files + cv_review.md"
grep -q "Your CV review" "$S/setup.out" && ok "review shown in the terminal"
node -e 'const s=require("./settings.json");const c=JSON.stringify(s.companies);if(!c.includes("supabase")||!c.includes("anthropic")||c.includes("example.com"))process.exit(1)' && ok "companies added from pasted links (bad link refused)"
grep -q "not a supported job board" "$S/setup.out" && ok "unsupported link explained"
grep -q "workflows installed and switched on (4)" "$S/setup.out" && ok "4 workflows installed + published (Telegram user)"
for i in $(seq 1 60); do [ -s "$S/mock/telegram_messages.jsonl" ] && grep -q '"ap:' "$S/mock/telegram_messages.jsonl" && break; sleep 2; done
grep -q '"ap:' "$S/mock/telegram_messages.jsonl" && ok "first-run preview: a job card arrived in Telegram"
ls output/*/ >/dev/null 2>&1 && ok "job folder written: $(ls output | head -1)"
./jobradar status 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -q "supabase" && ok "./jobradar status lists companies"
echo "WIZARD PASSED"
