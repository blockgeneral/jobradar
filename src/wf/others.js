//@node send_route
// 🧭 Route — drop envelopes for channels that aren't switched on
const ch = channelsEnabled();
const ok = { tg_text: 'telegram', tg_album: 'telegram', tg_album3: 'telegram', tg_call: 'telegram', email: 'email' };
return $input.all().filter((it) => ch.includes(ok[it.json.kind]));

//@node actions_poll
// 📥 Poll Telegram — button presses arrive here (no public URL needed: we ask Telegram for updates every minute)
if (!channelsEnabled().includes('telegram')) return [];
const state = $getWorkflowStaticData('global');
return [{ json: { offset: state.offset || 0 } }];

//@node actions_parse
// 🧠 Parse button presses → tracker updates + Telegram replies
const state = $getWorkflowStaticData('global');
let body = $input.first().json;
if (typeof body.data === 'string') { try { body = JSON.parse(body.data); } catch (e) { body = {}; } }
const updates = (body && body.result) || [];
if (updates.length) state.offset = updates[updates.length - 1].update_id + 1;
const myChat = String(envGet('TELEGRAM_CHAT_ID') || '');
const now = new Date().toISOString();
const out = [];
const OUT_LABEL = { reply: '💬 replied', rejected: '❌ rejected', intro: '📞 intro call', offer: '🎉 offer', none: '👻 no answer' };
for (const u of updates) {
  const q = u.callback_query;
  if (!q || !q.data || String(q.message && q.message.chat && q.message.chat.id) !== myChat) continue;
  const [act, id, outcome] = q.data.split(':');
  let set = null, toast = '', markup = (q.message.reply_markup && q.message.reply_markup.inline_keyboard) || [];
  if (act === 'w') {
    const name = q.data.slice(2);
    const idx = markup.findIndex((row) => row.some((b) => b.callback_data === q.data));
    if (idx >= 0) markup[idx] = [{ text: `👀 Watching ${name}`, callback_data: 'noop:w' }];
    out.push({ json: { watch: { name, dream: true, added_at: now, source: 'telegram' }, tgCalls: [
      { method: 'answerCallbackQuery', body: { callback_query_id: q.id, text: `Watching ${name} — its roles now get priority` } },
      { method: 'editMessageReplyMarkup', body: { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: markup } } } ] } });
    continue;
  }
  if (act === 'ap') { set = { status: 'applied', applied_at: now }; toast = 'Marked as applied ✅ Good luck!'; }
  else if (act === 'sk') { set = { status: 'skipped' }; toast = 'Skipped ⏭'; }
  else if (act === 'o' && OUT_LABEL[outcome]) { set = { outcome, outcome_at: now }; toast = 'Saved: ' + OUT_LABEL[outcome]; }
  else if (act === 'noop') { out.push({ json: { tgCalls: [{ method: 'answerCallbackQuery', body: { callback_query_id: q.id } }] } }); continue; }
  if (!set) continue;
  // replace the pressed row with a status line so the card shows what you did
  if (act === 'ap' || act === 'sk') {
    markup = markup.filter((row) => !row.some((b) => b.callback_data && /^(ap|sk):/.test(b.callback_data)));
    markup.push([{ text: act === 'ap' ? `✅ Applied · ${now.slice(5, 10)}` : '⏭ Skipped', callback_data: 'noop:' + id }]);
  } else {
    const idx = markup.findIndex((row) => row.some((b) => b.callback_data && b.callback_data.startsWith(`o:${id}:`)));
    if (idx >= 0) markup[idx] = [{ text: OUT_LABEL[outcome], callback_data: 'noop:' + id }];
  }
  out.push({ json: { jr_id: id, set, tgCalls: [
    { method: 'answerCallbackQuery', body: { callback_query_id: q.id, text: toast } },
    { method: 'editMessageReplyMarkup', body: { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: markup } } },
  ] } });
}
return out;

//@node actions_rows
// rows to update in jobradar_jobs
return $input.all().filter((it) => it.json.set).map((it) => ({ json: Object.assign({ jr_id: it.json.jr_id }, it.json.set) }));

//@node watch_rows
// companies you tapped ➕ on → jobradar_watch
return $input.all().filter((it) => it.json.watch).map((it) => ({ json: it.json.watch }));

//@node actions_calls
// Telegram replies (toast + updated buttons)
return $input.all().flatMap((it) => it.json.tgCalls.map((c) => ({ json: c })));

//@node inbox_parse
// ✉️ Email commands — the ✅/⏭/outcome buttons in emails send "JobRadar APPLIED JR-XXXXXX JR-CMD"
const now = new Date().toISOString();
const out = [];
for (const it of $input.all()) {
  const subj = String(it.json.subject || '');
  const wm = subj.match(/JobRadar\s+WATCH\s+(.+?)\s+JR-CMD/i);
  if (wm) { out.push({ json: { watch: { name: wm[1].trim(), dream: true, added_at: now, source: 'email' } } }); continue; }
  const m = subj.match(/JobRadar\s+(APPLIED|SKIP|OUTCOME\s+(reply|rejected|intro|offer|none))\s+(JR-[A-Z0-9]{6})/i);
  if (!m) continue;
  const id = m[3].toUpperCase();
  const cmd = m[1].toUpperCase();
  const set = cmd === 'APPLIED' ? { status: 'applied', applied_at: now } : cmd === 'SKIP' ? { status: 'skipped' } : { outcome: m[2].toLowerCase(), outcome_at: now };
  out.push({ json: Object.assign({ jr_id: id }, set) });
}
return out;

//@node inbox_rows
return $input.all().filter((it) => it.json.jr_id).map((it) => it);

//@node inbox_watch
return $input.all().filter((it) => it.json.watch).map((it) => ({ json: it.json.watch }));

//@node replies_prefilter
// 🔍 Reply detection — only mail that plausibly comes from a company you applied to goes to Claude
const rows = $input.all().map((x) => x.json).filter((r) => r && r.jr_id && r.status === 'applied');
const mails = $('📨 New inbox mail').all().map((x) => x.json);
const ATS = /(greenhouse|ashbyhq|lever\.co|workable|recruitee|personio|smartrecruiters|teamtailor|bamboohr|myworkday|icims|jobvite)/i;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const out = [];
for (const m of mails) {
  const from = String(m.from || (m.metadata && m.metadata.from) || '');
  const subj = String(m.subject || '');
  const text = String(m.text || m.textPlain || m.textHtml || '').slice(0, 2500);
  const hay = norm(from + ' ' + subj);
  const cands = rows.filter((r) => { const c = norm(r.company); return c.length >= 3 && (hay.includes(c) || (ATS.test(from) && norm(text).includes(c))); });
  if (!cands.length) continue;
  const list = cands.slice(0, 6).map((r) => `${r.jr_id}: ${r.company} — ${r.title}`).join('\n');
  out.push({ json: { from, subject: subj, request: structuredRequest({ name: 'classify', description: 'Classify a recruiting email', input_schema: { type: 'object', properties: {
      jr_id: { type: 'string', description: 'Which application this email is about (one of the ids), or "none".' },
      outcome: { type: 'string', enum: ['reply', 'rejected', 'intro', 'offer', 'irrelevant'], description: 'reply = a human replied/asked something; intro = invitation to a call/interview; rejected = not moving forward; irrelevant = newsletter, auto-acknowledgement ("we received your application"), marketing.' },
      summary: { type: 'string', description: 'One short line for the candidate.' } }, required: ['jr_id', 'outcome', 'summary'] } }, {
    model: envGet('SCORING_MODEL') || 'claude-haiku-5-5', max_tokens: 1500,
    messages: [{ role: 'user', content: `Applications:\n${list}\n\nEmail\nFrom: ${from}\nSubject: ${subj}\n\n${text}` }],
  }) } });
}
return out;

//@node replies_apply
// Apply Claude's verdicts → tracker + a heads-up notification
const prev = $('🔍 Plausible replies').all();
const out = [];
$input.all().forEach((it, i) => {
  const v = toolInput(it.json);
  const p = prev[i] && prev[i].json;
  if (!v || !p || v.outcome === 'irrelevant' || !/^JR-/.test(v.jr_id || '')) return;
  const icon = { reply: '💬', rejected: '❌', intro: '📞', offer: '🎉' }[v.outcome] || '📬';
  out.push({ json: { row: { jr_id: v.jr_id, outcome: v.outcome, outcome_at: new Date().toISOString() },
    note: `${icon} ${v.summary}\nFrom: ${p.from}\nSubject: ${p.subject}` } });
});
return out;

//@node replies_rows
return $input.all().map((it) => ({ json: it.json.row }));

//@node replies_notes
return $input.all().flatMap((it) => [
  { json: { kind: 'tg_text', tg: { text: it.json.note, disable_web_page_preview: true } } },
  { json: { kind: 'email', subject: 'JobRadar: ' + it.json.note.split('\n')[0], text: it.json.note, html: `<pre style="font-family:inherit;white-space:pre-wrap">${escHtml(it.json.note)}</pre>` } },
]);

//@node reports_due
// ⏰ What's due — reports and digests follow settings.json, so no workflow edits are needed
const items = $input.all();
let settings = {};
for (let i = 0; i < items.length; i++) {
  const b = items[i].binary && items[i].binary.data;
  if (b && b.fileName === 'settings.json') settings = JSON.parse((await this.helpers.getBinaryDataBuffer(i, 'data')).toString('utf8'));
}
const tz = envGet('GENERIC_TIMEZONE') || 'UTC';
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
  .formatToParts(new Date()).map((p) => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`;
const hour = Number(parts.hour) % 24;
const hh = (t) => Number(String(t || '08:00').split(':')[0]);
const rep = settings.reports || {};
const n = settings.notifications || {};
const state = $getWorkflowStaticData('global');
let force = envGet('JOBRADAR_FORCE_REPORT');
try { const w = $('🔗 Run from CLI').first().json; force = (w.query && w.query.type) || (w.body && w.body.type) || force; } catch (e) { /* not started from the CLI */ }
const due = [];
if (['weekly', 'monthly', 'digest'].includes(force)) due.push(force);
else {
  if (rep.weekly !== false && parts.weekday.toLowerCase() === String(rep.weeklyDay || 'monday').toLowerCase() && hour === hh(rep.time) && state.weekly !== today) { due.push('weekly'); state.weekly = today; }
  if (rep.monthly !== false && parts.day === '01' && hour === hh(rep.time) && state.monthly !== today) { due.push('monthly'); state.monthly = today; }
  // the daily list runs every day: "worth a look" roles (and everything, in digest mode)
  if (hour === hh(n.digestTime) && state.digest !== today) { due.push('digest'); state.digest = today; }
}
return due.map((d) => ({ json: { due: d, reports: rep, settings } }));

//@node reports_build
// 📊 Build reports / digest
const dues = $('⏰ What\'s due').all().map((x) => x.json);
const rows = $('🗃️ Tracker').all().map((x) => x.json).filter((r) => r && r.jr_id);
const watchRows = $input.all().map((x) => x.json).filter((r) => r && r.name);
const ch = channelsEnabled();
const to = envGet('NOTIFY_EMAIL_TO') || envGet('SMTP_USER') || '';
const out = [];
for (const d of dues) {
  if (d.due === 'digest') {
    const pend = rows.filter((r) => r.status === 'digest_pending').sort((a, b) => b.score - a.score);
    for (const e of digestEnvelopes(pend, ch, to)) out.push({ json: e });
    for (const r of pend) out.push({ json: { kind: 'row_update', row: { jr_id: r.jr_id, status: 'notified' } } });
    continue;
  }
  const R = computeReport(rows, d.due, Date.now(), d.reports);
  R.discover = discoverCompanies(rows, watchList(d.settings || {}, watchRows), Date.now() - (d.due === 'monthly' ? 30 : 7) * 864e5);
  if (ch.includes('telegram')) for (const m of telegramReport(R)) out.push({ json: m });
  if (ch.includes('email')) out.push({ json: emailReport(R, to) });
}
return out;

//@node reports_rows
return $input.all().filter((it) => it.json.kind === 'row_update').map((it) => ({ json: it.json.row }));

//@node reports_msgs
return $input.all().filter((it) => it.json.kind !== 'row_update');


//@node chat_reply
// 💬 Reply — hand the helper's answer to the chat window (or explain what went wrong)
const r = $input.first().json || {};
if (r.output) return [{ json: { output: r.output } }];
const err = (r.error && (r.error.message || r.error)) || 'no answer';
return [{ json: { output: "Sorry — I couldn't do that just now (" + String(err).slice(0, 160) + "). Is JobRadar running? Try `./jobradar status`." } }];

//@node linkedin_parse
// 💼 LinkedIn alert → leads: the jobs in each alert email go to the radar, which finds each posting on the company's
// own job board (full description, tailored files) or sends a title-only card. LinkedIn pages are never opened.
const state = $getWorkflowStaticData('global');
const now = Date.now();
const leads = []; let unreadable = 0;
for (const it of $input.all()) {
  const e = it.json || {};
  const at = Date.parse(e.date || '') || now;
  if (now - at > 3 * 864e5) continue; // old alerts (e.g. right after switching this on) aren't news
  const found = parseLinkedInAlert(e.textPlain || e.text || '', e.textHtml || e.html || '');
  if (!found.length && /job/i.test(String(e.subject || '')) && !/applied|application|viewed/i.test(String(e.subject || ''))) unreadable++;
  for (const l of found) if (!leads.some((x) => x.id === l.id)) leads.push(l);
}
const out = [];
if (leads.length) out.push({ json: { kind: 'leads', leads } });
// the parser is the fragile part (LinkedIn changes its emails): say so the same day, once a day
if (unreadable && (!state.unreadableAt || now - state.unreadableAt > 864e5)) {
  state.unreadableAt = now;
  const text = 'JobRadar couldn\'t read the jobs in a LinkedIn alert email — LinkedIn may have changed its format. Your other sources keep working; ask Claude to update the LinkedIn parser (forward it the alert).';
  out.push({ json: { kind: 'tg_text', tg: { text: '🩺 ' + text, disable_web_page_preview: true } } });
  out.push({ json: { kind: 'email', subject: 'JobRadar: a LinkedIn alert couldn\'t be read', text, html: `<p>${escHtml(text)}</p>` } });
}
if (leads.length) { state.lastLeadsAt = now; state.leadCount = (state.leadCount || 0) + leads.length; }
return out;
