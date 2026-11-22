// JobRadar chat — change anything in plain language from the n8n chat page.
// The n8n workflow "6 Chat" forwards each message here (POST /chat {sessionId, message} → {output}).
// Claude reads the user's files through tools, STAGES edits, shows them before → after, and saves only
// after the user's own message says yes (checked here in code, not left to the model).
const fs = require('fs');
const path = require('path');

const PROJECT = process.env.JOBRADAR_PROJECT || '/project';
const STATE = () => path.join(process.env.OUTPUT_DIR || path.join(PROJECT, 'output'), '.jobradar');

// Shared helpers from src/lib (same code the workflows use): structuredRequest/thinkingFor, claimCheck, stripHtmlComments.
let LIB = null;
function lib() {
  if (LIB) return LIB;
  const src = ['util', 'guard', 'prompts'].map((n) => fs.readFileSync(path.join(PROJECT, 'src', 'lib', n + '.js'), 'utf8')).join('\n');
  LIB = new Function('$env', src + '; return { thinkingFor, claimCheck, stripHtmlComments };')({});
  return LIB;
}

const FILES = {
  settings: { file: 'settings.json', about: 'how JobRadar behaves: watched companies, job boards, title/language filters, score thresholds, notification style, quiet hours' },
  profile: { file: 'candidate/search_profile.md', about: 'who the user is and what they want: hard requirements (location, language, pay), roles, seniority, values, red flags — the screener reads it for every job' },
  resume: { file: 'candidate/resume_base.md', about: 'base resume; tailoring only reorders and rewords it' },
  cover: { file: 'candidate/cover_letter_base.md', about: 'base cover letter in the user\'s own words, with {{HIRING_TEAM}}, {{WHY_COMPANY}}, {{LOCATION_LINE}} slots' },
  facts: { file: 'candidate/experience_inventory.md', about: 'fact sheet: everything true about their work (tailoring may use only facts in here or the resume), plus "# Never claim" rules' },
  review: { file: 'candidate/cv_review.md', about: 'the review written when their CV was imported, ending with open questions (read-only)', readOnly: true },
};
const EDITABLE = ['profile', 'resume', 'cover', 'facts'];

const TOOLS = [
  { name: 'read_file', description: 'Read one of the user\'s JobRadar files before answering about it or changing it.',
    input_schema: { type: 'object', properties: { file: { type: 'string', enum: Object.keys(FILES) } }, required: ['file'] } },
  { name: 'propose_edit', description: 'Stage an edit to a text file: replace one exact passage (copied from read_file) with new text, or append when find is empty. Nothing is saved until the user says yes. Keep edits minimal and in the user\'s own words.',
    input_schema: { type: 'object', properties: { file: { type: 'string', enum: EDITABLE }, find: { type: 'string', description: 'Exact text that appears once in the file; empty string = append at the end' }, replace: { type: 'string' }, why: { type: 'string', description: 'One short line for the user' } }, required: ['file', 'find', 'replace', 'why'] } },
  { name: 'add_fact', description: 'Stage a fact the user just told you about their work for the fact sheet, in their words, no embellishment.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'add_never_claim', description: 'Stage a rule for things applications must never claim or say (e.g. a skill they lack, a wording they dislike).',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'change_settings', description: 'Stage changes to settings.json by dotted path, e.g. "scoring.instantAt" = 60 (the "ping me above X" setting), "hiringCafe.enabled" = false, "notifications.quietHours.from" = "23:00", "filters.titleExclude" = [..]. Read settings first. For companies use watch_company.',
    input_schema: { type: 'object', properties: { changes: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, value: { description: 'New JSON value' } }, required: ['path', 'value'] } }, why: { type: 'string' } }, required: ['changes', 'why'] } },
  { name: 'watch_company', description: 'Stage adding, starring (dream) or removing a watched company. url = their careers/job-board page if the user gave one.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, dream: { type: 'boolean' }, remove: { type: 'boolean' } }, required: ['name'] } },
  { name: 'save_pending', description: 'Save all staged changes. Only call this right after the user clearly said yes to them.', input_schema: { type: 'object', properties: {} } },
  { name: 'discard_pending', description: 'Drop all staged changes.', input_schema: { type: 'object', properties: {} } },
  { name: 'jobradar_status', description: 'Recent radar runs: jobs seen, why they were filtered, how many were screened, matches sent, broken sources. Use for "why so quiet?", "is it working?".', input_schema: { type: 'object', properties: { hours: { type: 'number' } } } },
  { name: 'check_job', description: 'Screen one job posting link right now and, if it fits, tailor the application and send the usual card. Takes up to two minutes.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
];

const rd = (key) => { const p = path.join(PROJECT, FILES[key].file); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const safeId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';

function loadSession(id) {
  const p = path.join(STATE(), 'chat', safeId(id) + '.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { messages: [], pending: [] }; }
}
function saveSession(id, s) {
  const dir = path.join(STATE(), 'chat');
  fs.mkdirSync(dir, { recursive: true });
  // keep the last ~30 turns, cut only at a plain user message so tool calls stay paired
  let m = s.messages;
  if (m.length > 60) { let i = m.length - 60; while (i < m.length && !(m[i].role === 'user' && typeof m[i].content === 'string')) i++; m = m.slice(i); }
  fs.writeFileSync(path.join(dir, safeId(id) + '.json'), JSON.stringify({ messages: m, pending: s.pending || [] }));
}

// ---- staging ----
function stageText(s, key, find, replace, why) {
  const before = rd(key);
  if (!before && find) return { error: `${FILES[key].file} doesn't exist yet` };
  let after;
  if (!find) after = before.replace(/\s*$/, '\n') + replace.replace(/^\n+/, '') + (replace.endsWith('\n') ? '' : '\n');
  else {
    const n = before.split(find).length - 1;
    if (n === 0) return { error: 'that passage is not in the file — read_file again and copy it exactly' };
    if (n > 1) return { error: `that passage appears ${n} times — include more surrounding text` };
    after = before.replace(find, () => replace);
  }
  // pending changes to the same file chain on each other
  const prev = s.pending.filter((p) => p.key === key);
  if (prev.length) {
    const base = prev[prev.length - 1].after;
    if (!find) after = base.replace(/\s*$/, '\n') + replace.replace(/^\n+/, '') + (replace.endsWith('\n') ? '' : '\n');
    else if (base.includes(find)) after = base.replace(find, () => replace);
    else return { error: 'that passage is not in the staged version of the file' };
  }
  s.pending.push({ key, file: FILES[key].file, why, find, replace, after });
  return { staged: true, file: FILES[key].file, why };
}

function appendUnder(md, heading, line) {
  const h = `# ${heading}`;
  if (md.includes(h)) {
    const i = md.indexOf(h) + h.length;
    const next = md.slice(i).search(/\n# /);
    const end = next < 0 ? md.length : i + next;
    return md.slice(0, end).replace(/\s*$/, '\n') + `- ${line}\n` + md.slice(end).replace(/^\n*/, md.slice(end) ? '\n' : '');
  }
  return md.replace(/\s*$/, '\n\n') + `${h}\n- ${line}\n`;
}

function stageFact(s, text, never) {
  const key = 'facts';
  const prev = s.pending.filter((p) => p.key === key);
  const base = prev.length ? prev[prev.length - 1].after : (rd(key) || '<!-- EXPERIENCE INVENTORY -->\n');
  const clean = String(text).replace(/^[-\s]+/, '').trim();
  const after = never ? appendUnder(base, 'Never claim', clean) : appendUnder(base, 'Added in chat', `${clean} (${new Date().toISOString().slice(0, 10)})`);
  s.pending.push({ key, file: FILES[key].file, why: never ? 'new never-claim rule' : 'new fact for your fact sheet', find: '', replace: '- ' + clean, after });
  return { staged: true, file: FILES[key].file };
}

function setPath(obj, dotted, value) {
  const parts = String(dotted).split('.').filter(Boolean);
  if (!parts.length || parts.some((p) => /^(__proto__|constructor|prototype)$/.test(p))) throw new Error('bad path');
  let o = obj;
  for (const p of parts.slice(0, -1)) { if (o[p] === undefined || o[p] === null || typeof o[p] !== 'object') o[p] = {}; o = o[p]; }
  const last = parts[parts.length - 1];
  const before = o[last];
  o[last] = value;
  return before;
}

function settingsBase(s) {
  const prev = s.pending.filter((p) => p.key === 'settings');
  return JSON.parse(prev.length ? prev[prev.length - 1].after : (fs.readFileSync(path.join(PROJECT, 'settings.json'), 'utf8')));
}

function stageSettings(s, changes, why) {
  let cfg;
  try { cfg = settingsBase(s); } catch (e) { return { error: 'settings.json is not valid JSON: ' + e.message }; }
  const lines = [];
  for (const c of changes || []) {
    try { const before = setPath(cfg, c.path, c.value); lines.push(`${c.path}: ${JSON.stringify(before)} → ${JSON.stringify(c.value)}`); }
    catch (e) { return { error: `can't set ${c.path}: ${e.message}` }; }
  }
  s.pending.push({ key: 'settings', file: 'settings.json', why, lines, after: JSON.stringify(cfg, null, 2) + '\n' });
  return { staged: true, changes: lines };
}

const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function stageCompany(s, { name, url, dream, remove }) {
  let cfg;
  try { cfg = settingsBase(s); } catch (e) { return { error: 'settings.json is not valid JSON: ' + e.message }; }
  cfg.companies = cfg.companies || [];
  const i = cfg.companies.findIndex((c) => normName(c.name) === normName(name) || (c.aliases || []).some((a) => normName(a) === normName(name)));
  let line;
  if (remove) {
    if (i < 0) return { error: `${name} isn't on the watch list` };
    cfg.companies.splice(i, 1); line = `stop watching ${name}`;
  } else if (i >= 0) {
    if (url) cfg.companies[i].url = url;
    if (dream !== undefined) { if (dream) cfg.companies[i].dream = true; else delete cfg.companies[i].dream; }
    line = `${cfg.companies[i].name}: ${dream ? '⭐ dream company' : 'updated'}${url ? ' · ' + url : ''}`;
  } else {
    const e = { name }; if (url) e.url = url; if (dream) e.dream = true;
    cfg.companies.push(e); line = `watch ${name}${dream ? ' ⭐' : ''}${url ? ' · ' + url : ' (found by name on job boards)'}`;
  }
  s.pending.push({ key: 'settings', file: 'settings.json', why: line, lines: [line], after: JSON.stringify(cfg, null, 2) + '\n' });
  return { staged: true, change: line };
}

const CONSENT = /^\s*(y|ya|yes|yep|yeah|yup|sure|ok|okay|save|save it|save them|do it|go|go ahead|apply|confirm|confirmed|correct|looks good|perfect|great|good|ja|так|да)\b/i;
function savePending(s, lastUser) {
  if (!s.pending.length) return { error: 'nothing is staged' };
  if (!CONSENT.test(lastUser || '')) return { error: 'the user has not said yes in their latest message — ask them to confirm first' };
  const L = lib();
  const done = [];
  const lastByKey = {};
  for (const p of s.pending) lastByKey[p.key] = p; // later stages already include earlier ones
  for (const p of Object.values(lastByKey)) {
    const full = path.join(PROJECT, p.file);
    if (p.key === 'settings') JSON.parse(p.after); // never write broken JSON
    if (fs.existsSync(full)) fs.copyFileSync(full, full + '.bak');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, p.after);
    done.push(p.file);
  }
  const notes = [];
  // resume / cover edits must not grow claims beyond the fact sheet
  for (const k of ['resume', 'cover']) if (lastByKey[k]) for (const c of L.claimCheck(rd('facts') + '\n' + rd('resume'), lastByKey[k].replace || '')) notes.push(c);
  s.pending = [];
  return { saved: done, backups: done.map((f) => f + '.bak'), applies: 'from the next radar run (within 15 minutes)', claim_warnings: notes };
}

function previewPending(pending) {
  const out = [];
  for (const p of pending) {
    if (p.lines) for (const l of p.lines) out.push(`• **${p.file}** — ${l}`);
    else if (!p.find) out.push(`• **${p.file}** — add: “${String(p.replace).replace(/^[-\s]+/, '').slice(0, 300)}”`);
    else out.push(`• **${p.file}**\n   before: “${p.find.slice(0, 300)}”\n   after: “${p.replace.slice(0, 300)}”`);
  }
  return out.join('\n');
}

// ---- status (written by the radar after each run: output/.jobradar/status.jsonl) ----
function readStatus(hours) {
  const p = path.join(STATE(), 'status.jsonl');
  if (!fs.existsSync(p)) return { note: 'no radar runs recorded yet — the radar reports here after each run' };
  const since = Date.now() - (hours || 24) * 3600e3;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((r) => r && Date.parse(r.at) >= since);
  const runs = new Set(rows.map((r) => r.run)).size;
  const sum = {}; const problems = {}; const matches = [];
  for (const r of rows) {
    if (r.part === 'normalize') for (const [k, v] of Object.entries(r.stats || {})) if (typeof v === 'number') sum[k] = (sum[k] || 0) + v;
    if (r.part === 'health') for (const b of r.problems || []) problems[b.name] = b.problem;
    if (r.part === 'gate') { sum.screened = (sum.screened || 0) + (r.screened || 0); sum.sent_now = (sum.sent_now || 0) + (r.instant || []).length; sum.daily_list = (sum.daily_list || 0) + (r.digest || []).length; matches.push(...(r.instant || []), ...(r.digest || [])); }
  }
  const last = rows.length ? rows[rows.length - 1].at : null;
  return { hours: hours || 24, runs, last_run: last, totals: sum, matches: matches.slice(-10), broken_sources: problems,
    legend: 'fetched = jobs seen on all sources; seen = already known; repost = dream-company jobs let through again because no card was ever sent for them; the other counts are filter reasons (title, location, language, stale); toScore = sent to the AI screener' };
}

async function checkJob(url) {
  if (!/^https?:\/\//i.test(url || '')) return { error: 'send a full link starting with http' };
  const n8n = process.env.N8N_URL || 'http://n8n:5678';
  const started = Date.now();
  try {
    const r = await fetch(`${n8n}/webhook/jobradar-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(240e3) });
    if (!r.ok) return { error: 'the radar did not accept the link (HTTP ' + r.status + ')' };
  } catch (e) { return { error: 'could not reach the radar: ' + e.message }; }
  const p = path.join(STATE(), 'status.jsonl');
  const rows = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : [];
  const g = rows.filter((x) => x.part === 'gate' && x.manualUrl === url && Date.parse(x.at) >= started - 5000).pop();
  if (!g) return { note: 'sent to the radar; no verdict recorded — check Telegram/email for the card' };
  return g.manual || { note: 'screened — see the card in Telegram/email' };
}

// ---- the conversation ----
function systemPrompt() {
  const L = lib();
  const resume = rd('resume');
  const name = ((L.stripHtmlComments(resume).match(/^#\s+(.+)$/m) || [])[1] || '').trim();
  const review = rd('review');
  const qs = (review.match(/(?:questions?)[\s\S]*$/i) || [''])[0].slice(0, 1500);
  return `You are the JobRadar assistant${name ? ' for ' + name : ''}. JobRadar finds new job postings, screens them against the user's profile with Claude, tailors their resume and cover letter from their own files, and sends a card (Telegram/email). The user always applies themselves — you never apply, email or message anyone.

You help them change anything about how JobRadar searches and what it writes, in plain language, the way they'd ask a person. Their files (use read_file before talking about or changing one):
${Object.entries(FILES).map(([k, f]) => `- ${k} (${f.file}): ${f.about}`).join('\n')}

How you work:
- Figure out which file the request touches, read it, then stage the smallest change that does what they asked (propose_edit / add_fact / add_never_claim / change_settings / watch_company). Say in one or two plain lines what you staged and ask "Save?". The exact before → after is shown to them automatically under your reply. Call save_pending only after they say yes in their latest message.
- Never invent anything about the user. The fact sheet holds only what they told you, in their words — no embellishment, no bigger verbs ("helped" stays "helped"), no counts they didn't give. If something is unclear, ask one short question.
- Profile-building: when they want better applications, or say "interview me", ask the open questions from their CV review one at a time (skip ones already answered in the fact sheet), and stage each answer with add_fact before asking the next.
- "Why so quiet?", "is it working?" → jobradar_status, then explain in plain words (what came in, what was filtered and why, what was sent, anything broken). A link to a job posting → check_job.
- Settings changes apply from the next radar run (within 15 minutes); no restart needed.
- Thresholds people mix up: "only ping me above X", "fewer pings", "only tell me about strong matches" → scoring.instantAt = X (matches above it are tailored and pinged right away; matches below it but above the minimums go to the daily "worth a look" list; dream companies always ping). "Stop showing me weak matches at all" → scoring.minSkillsFit / scoring.minValuesFit.
- Be brief and concrete. No JSON or file paths unless they ask. Today is ${new Date().toISOString().slice(0, 10)}.
${qs ? '\nOpen questions from their CV review:\n' + qs : ''}`;
}

async function claude(body) {
  const env = process.env;
  const r = await fetch((env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120e3),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return j;
}

async function handleChat(sessionId, message, deps) {
  const call = (deps && deps.claude) || claude;
  const text = String(message || '').trim();
  if (!text) return { output: 'Tell me what you\'d like to change — e.g. "watch Supabase as a dream company", "why so quiet today?", or paste a job link.' };
  const s = loadSession(sessionId);
  // a plain "no" drops staged changes without needing the model
  if (s.pending.length && /^\s*(no|nope|cancel|discard|drop it|don't|dont)\b/i.test(text)) {
    s.pending = []; s.messages.push({ role: 'user', content: text }, { role: 'assistant', content: 'Dropped — nothing was saved.' }); saveSession(sessionId, s);
    return { output: 'Dropped — nothing was saved.' };
  }
  // a bare "yes" to staged changes saves them directly — no model call, no room for misreading
  if (s.pending.length && /^\s*(y|yes|yep|yeah|yup|sure|ok|okay|save|save it|do it|go|go ahead|confirm|looks good|perfect)\s*[.!]*\s*$/i.test(text)) {
    const r = savePending(s, text);
    const msg = r.saved ? `✅ Saved: ${r.saved.join(', ')} (backups kept as .bak). Applies from the next radar run.${r.claim_warnings && r.claim_warnings.length ? '\n⚠️ Check: ' + r.claim_warnings.join('; ') : ''}` : r.error;
    s.messages.push({ role: 'user', content: text }, { role: 'assistant', content: msg }); saveSession(sessionId, s);
    return { output: msg };
  }
  s.messages.push({ role: 'user', content: text });
  const model = process.env.TAILORING_MODEL || 'claude-sonnet-5-5';
  const t = lib().thinkingFor(model, 'low');
  let reply = '';
  let savedNow = null;
  for (let round = 0; round < 8; round++) {
    const body = { model, max_tokens: 8000, system: systemPrompt(), tools: TOOLS, messages: s.messages };
    if (t.thinking) { body.thinking = t.thinking; body.output_config = { effort: t.effort }; }
    const resp = await call(body);
    s.messages.push({ role: 'assistant', content: resp.content });
    const uses = (resp.content || []).filter((c) => c.type === 'tool_use');
    reply = (resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() || reply;
    if (!uses.length || resp.stop_reason !== 'tool_use') break;
    const results = [];
    for (const u of uses) {
      let out;
      try {
        const a = u.input || {};
        if (u.name === 'read_file') out = FILES[a.file] ? { file: FILES[a.file].file, content: rd(a.file) || '(empty — not created yet)' } : { error: 'unknown file' };
        else if (u.name === 'propose_edit') out = EDITABLE.includes(a.file) ? stageText(s, a.file, a.find || '', a.replace || '', a.why || '') : { error: 'that file is read-only' };
        else if (u.name === 'add_fact') out = stageFact(s, a.text, false);
        else if (u.name === 'add_never_claim') out = stageFact(s, a.text, true);
        else if (u.name === 'change_settings') out = stageSettings(s, a.changes, a.why);
        else if (u.name === 'watch_company') out = stageCompany(s, a);
        else if (u.name === 'save_pending') { out = savePending(s, text); if (out.saved) savedNow = out; }
        else if (u.name === 'discard_pending') { s.pending = []; out = { discarded: true }; }
        else if (u.name === 'jobradar_status') out = readStatus(a.hours);
        else if (u.name === 'check_job') out = await ((deps && deps.checkJob) || checkJob)(a.url);
        else out = { error: 'unknown tool' };
      } catch (e) { out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) });
    }
    s.messages.push({ role: 'user', content: results });
  }
  let output = reply || 'Done.';
  if (s.pending.length && !savedNow) {
    output += `\n\n---\n**Ready to save** — reply **yes** to save or **no** to drop:\n${previewPending(s.pending)}`;
  }
  if (savedNow && !/saved/i.test(reply)) output += `\n\n✅ Saved: ${savedNow.saved.join(', ')} (backups kept as .bak). Applies from the next radar run.`;
  saveSession(sessionId, s);
  return { output };
}

module.exports = { handleChat, readStatus, stageSettings, stageCompany, stageText, stageFact, savePending, previewPending, CONSENT, FILES, setPath };
