#!/usr/bin/env bash
# Full end-to-end test on a real n8n: install → radar → Telegram buttons → reports, with Telegram + email on.
# Everything external is mocked (test/mock-server.js, test/smtp-sink.js); the renderer runs for real.
#   N8N_BIN=/path/to/n8n bash test/e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N8N="${N8N_BIN:-n8n}"
T=/tmp/jobradar-e2e2
for p in $(ps aux | grep -E '[n]8n start|[r]enderer/server\.js|[m]ock-server\.js|[s]mtp-sink\.js' | awk '{print $2}'); do kill "$p" 2>/dev/null || true; done; sleep 1
rm -rf "$T"; mkdir -p "$T/work/candidate" "$T/out" "$T/mock" "$T/n8n"
cp "${E2E_CANDIDATE:-$ROOT/examples/candidate}"/*.md "$T/work/candidate/"
node -e 'const s=require(process.argv[1]);s.hiringCafe.enabled=true;s.hiringCafe.via="mcp";s.hiringCafe.everyMinutes=15;require("fs").writeFileSync(process.argv[2],JSON.stringify(s,null,2))' "${E2E_SETTINGS:-$ROOT/test/fixtures/sales-settings.json}" "$T/work/settings.json"

node "$ROOT/test/mock-server.js" 5689 "$T/mock" > "$T/mock.log" 2>&1 & P1=$!
node "$ROOT/test/smtp-sink.js" 2526 "$T/mock/smtp.jsonl" > "$T/smtp.log" 2>&1 & P2=$!
PORT=3101 OUTPUT_DIR="$T/out" GOTENBERG_URL=http://127.0.0.1:5689 node "$ROOT/renderer/server.js" > "$T/renderer.log" 2>&1 & P3=$!
trap 'kill $P1 $P2 $P3 2>/dev/null || true' EXIT
sleep 1.5

export N8N_USER_FOLDER="$T/n8n" N8N_BLOCK_ENV_ACCESS_IN_NODE=false N8N_RESTRICT_FILE_ACCESS_TO="$T/work" N8N_DIAGNOSTICS_ENABLED=false \
  N8N_LOG_LEVEL=error GENERIC_TIMEZONE=Europe/Vienna JOBRADAR_DIR="$T/work" JOBRADAR_MOCK_BASE=http://127.0.0.1:5689 \
  ANTHROPIC_API_KEY="${E2E_ANTHROPIC_KEY:-test-key}" ANTHROPIC_BASE_URL=http://127.0.0.1:5689 \
  TELEGRAM_BOT_TOKEN=123:abc TELEGRAM_CHAT_ID=42 TELEGRAM_API_BASE=http://127.0.0.1:5689 \
  RENDERER_URL=http://127.0.0.1:3101 NOTIFY_CHANNELS="${E2E_CHANNELS:-telegram,email}" NOTIFY_EMAIL_TO=me+jobradar@example.com \
  SMTP_HOST=127.0.0.1 SMTP_PORT=2526 SMTP_USER=me@example.com SMTP_PASS=x SMTP_SECURE=false SMTP_DISABLE_STARTTLS=true

run() { "$N8N" "$@" 2>&1 | grep -v -i "python task runner" || true; }
node "$ROOT/tools/credentials.js" > "$T/creds.json"
run import:credentials --input="$T/creds.json" | tail -1
for f in "$ROOT"/workflows/*.json; do run import:workflow --input="$f" | tail -1; done
for id in JobRadarSend0001 JobRadarMain0001 JobRadarActn0001 JobRadarRprt0001; do run publish:workflow --id=$id | tail -1; done
N8N_PORT=5690 N8N_LISTEN_ADDRESS=127.0.0.1 N8N_RUNNERS_BROKER_PORT=5691 "$N8N" start > "$T/n8n.log" 2>&1 & P4=$!
trap 'kill $P1 $P2 $P3 $P4 2>/dev/null || true' EXIT
for i in $(seq 1 180); do c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:5690/webhook/jobradar-report?type=none" || true); { [ "$c" = "200" ] || [ "$c" = "500" ]; } && break; sleep 1; done
sleep 8 # all published versions materialise
echo "n8n up (webhooks live after ${i}s)"
hook() { curl -s -m 600 -X POST "http://127.0.0.1:5690/webhook/$1" -o "$T/hook-$2.json" -w "  webhook $1 → HTTP %{http_code}\n"; }
echo "── radar #1"; hook jobradar-run r1
echo "── radar #2 (should send nothing new)"; hook jobradar-run r2
node -e '
const fs=require("fs");const m=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(x=>x.reply_markup&&JSON.stringify(x.reply_markup).includes("ap:"));
const ids=[...new Set(m.flatMap(x=>x.reply_markup.inline_keyboard.flat().map(b=>b.callback_data).filter(Boolean).filter(d=>d.startsWith("ap:"))))];
const ups=[{update_id:100,callback_query:{id:"cq1",data:ids[0],message:{message_id:7,chat:{id:42},reply_markup:m[0].reply_markup}}},
           {update_id:102,callback_query:{id:"cq3",data:ids[0],message:{message_id:9,chat:{id:999},reply_markup:{inline_keyboard:[]}}}}];
if(ids[1]) ups.push({update_id:101,callback_query:{id:"cq2",data:ids[1].replace("ap:","sk:"),message:{message_id:8,chat:{id:42},reply_markup:m[1].reply_markup}}});
if(!ids.length){console.log("  no cards to press");process.exit(0)}
fetch("http://127.0.0.1:5689/_ctl/updates",{method:"POST",body:JSON.stringify(ups)}).then(()=>console.log("  pressed",ids[0],"applied;",ids[1]||"-","skipped"));
' "$T/mock/telegram_messages.jsonl"
echo "── buttons"; hook jobradar-buttons b1
sleep 2
echo "── weekly report"; hook "jobradar-report?type=weekly" rep
sleep 2
node "$ROOT/test/e2e-assert.js" "$T"
