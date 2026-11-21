// Assertions for test/e2e.sh
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const T = process.argv[2];
const L = (n) => { const p = path.join(T, 'mock', n + '.jsonl'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };
const ok = (m) => console.log('  ✔ ' + m);
const channels = (process.env.E2E_CHANNELS || 'telegram,email').split(',');
const EXP = Number(process.env.E2E_EXPECT || 5); const SK = EXP > 1 ? 1 : 0; const DIG = Number(process.env.E2E_DIGEST || 1);

const src = L('sources');
const hc = src.find((s) => s.source === 'hiringcafe_mcp');
assert(hc && hc.method === 'POST' && /tools\/call/.test(hc.body), 'Hiring Cafe MCP called with POST JSON-RPC'); ok('Hiring Cafe MCP queried (POST tools/call)');
assert(src.filter((s) => s.source === 'ashby').every((s) => s.method === 'GET'), 'ATS polled with GET'); ok('ATS boards polled with GET');

const an = L('anthropic');
const scored = an.filter((a) => a.tool === 'job_fit'), tailored = an.filter((a) => a.tool === 'tailored_application');
console.log(`  · Claude calls: ${scored.length} screens, ${tailored.length} tailorings`);
assert.equal(tailored.length, EXP, 'tailored count'); ok(`first run tailored ${EXP} strong/dream match(es)`);
assert(scored.length >= EXP + DIG && scored.length <= EXP + DIG + 2, 'screen count sane (dedupe + filters worked, run 2 added nothing)'); ok('dedupe + filters: run #2 sent nothing new');

const msgs = L('telegram_messages');
const cards = msgs.filter((m) => m.reply_markup && JSON.stringify(m.reply_markup).includes('"ap:'));
if (channels.includes('telegram')) {
  assert.equal(cards.length, EXP, 'job cards'); ok(`${EXP} Telegram job card(s)`);
  for (const c of cards) {
    const flat = c.reply_markup.inline_keyboard.flat();
    assert(flat.some((b) => b.copy_text), 'copy-note button'); assert(flat.some((b) => /Apply/.test(b.text) && b.url), 'apply button');
    assert(c.text.length < 1200, 'card is compact (' + c.text.length + ' chars)');
    assert(/First run/.test(c.text), 'preview label');
  }
  ok('cards are compact (<1200 chars) with Apply / LinkedIn / copy-note / Applied-Skip buttons');
  const lie = cards.find((c) => /Anthropic/.test(c.text));
  if (lie) { assert(/95%/.test(lie.text) && /⚠️/.test(lie.text), 'planted number flagged on card'); ok('a planted fake number ("95%") is flagged on the card'); }
  const albums = L('telegram_albums');
  assert.equal(albums.length, EXP, 'albums');
  for (const a of albums) { assert.equal(a.files.length, 2); assert(a.files.every((f) => /\.docx$/.test(f.filename) && f.magic === 'PK')); }
  ok(`${EXP} file album(s), each resume + cover letter as real .docx`);
  const calls = L('telegram_calls');
  assert.equal(calls.filter((c) => c.method === 'answerCallbackQuery' && !/^Watching/.test(c.body.text || '')).length, 1 + SK, 'presses answered (foreign chat ignored)');
  const edits = calls.filter((c) => c.method === 'editMessageReplyMarkup');
  assert(edits.some((e) => JSON.stringify(e.body).includes('✅ Applied')) && (!SK || edits.some((e) => JSON.stringify(e.body).includes('Skipped'))));
  ok('✅ Applied / ⏭ Skip presses handled; card buttons updated; other chats ignored');
  if (EXP >= 5) {
    assert(cards.some((c) => /SafetyWing/.test(c.text)), 'SafetyWing via Pinpoint'); ok('SafetyWing found through its Pinpoint job board (undated dream role included on first run)');
    assert(cards.some((c) => /PetsApp/.test(c.text) && /⭐/.test(c.text)), 'PetsApp by name'); ok('PetsApp recognised by name on We Work Remotely and treated as a dream company');
    assert(cards.every((c) => /skills \d+ · values \d+/.test(c.text)), 'skills/values on cards'); ok('cards show skills and values fit');
  }
  if (DIG) {
    const wl = msgs.find((m) => /Worth a look/.test(m.text || ''));
    assert(wl && /DataFlowCo/.test(wl.text), 'worth-a-look list'); ok('a 74-score role went to the daily "worth a look" list, untailored');
  }
  const disc = msgs.find((m) => /Companies you might want to watch/.test(m.text || ''));
  if (EXP >= 5) { assert(disc && /CafeCo/.test(disc.text), 'discovery'); ok('weekly report suggests a company with strong values fit that isn\'t watched yet (CafeCo)'); }
  const rep = msgs.find((m) => /your week/.test(m.text || ''));
  assert(rep && /applied: 1/.test(rep.text) && new RegExp('skipped: ' + SK).test(rep.text), 'weekly report counts'); ok('weekly report: ' + rep.text.split('\n')[2]);
}
if (channels.includes('email')) {
  const mails = L('smtp').map((m) => m.raw);
  const jobMails = mails.filter((r) => /Content-Disposition: attachment/i.test(r) && /\.docx/.test(r));
  assert.equal(jobMails.length, EXP, 'job emails with attachments'); ok(`${EXP} job email(s), each with 2 .docx attachments`);
  assert(jobMails.every((r) => /JR-CMD/.test(r) && /mailto:me\+jobradar@example\.com/.test(r)), 'mailto status buttons'); ok('email ✅/⏭ buttons are mailto commands to the plus-address');
  assert(mails.some((r) => /your[ _]week/i.test(r)), 'report email'); ok('weekly report email sent');
}
const out = fs.readdirSync(path.join(T, 'out'));
assert.equal(out.length, EXP, 'job folders');
for (const d of out) { const f = fs.readdirSync(path.join(T, 'out', d)); for (const need of ['resume.md', 'cover_letter.md', 'job.json']) assert(f.includes(need), d + ' has ' + need); assert(f.filter((x) => x.endsWith('.docx')).length === 2); }
ok('output/<job>/ has resume.md, cover_letter.md, job.json + 2 .docx');

// tracker table
const { execFileSync } = require('child_process');
const db = path.join(T, 'n8n', '.n8n', 'database.sqlite');
const py = `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);t=[r[0] for r in c.execute("select name from sqlite_master where type='table' and name like 'data_table_user_%'")]
rows=[]
for n in t:
  cur=c.execute(f'select * from "{n}"');cols=[d[0] for d in cur.description];rows+= [dict(zip(cols,r)) for r in cur.fetchall()]
print(json.dumps(rows))`;
const allRows = JSON.parse(execFileSync('python3', ['-c', py, db]).toString());
const rows = allRows.filter((r) => r.jr_id);
const watch = allRows.filter((r) => r.name && !r.jr_id);
assert.equal(rows.length, EXP + DIG, 'tracker rows');
if (DIG) { assert(rows.filter((r) => r.status === 'notified').length === EXP - 1 - SK + DIG, 'digest rows marked sent after the daily list'); ok('daily list marked its rows as sent'); }
if (EXP >= 5) { assert(watch.some((w) => w.name === 'CafeCo'), 'watch table'); ok('tapping ➕ CafeCo added it to the watch list (jobradar_watch)'); }
assert.equal(rows.filter((r) => r.status === 'applied' && r.applied_at).length, 1); assert.equal(rows.filter((r) => r.status === 'skipped').length, SK);
ok(`tracker: ${EXP + DIG} row(s), 1 applied (timestamped), ${SK} skipped`);
console.log('\nE2E PASSED');
