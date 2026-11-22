//@node plan_run
// ⚙️ Plan run — load settings + candidate files, decide which sources to poll this run
const items = $input.all();
const files = {};
for (let i = 0; i < items.length; i++) {
  const bin = items[i].binary && items[i].binary.data;
  if (!bin) continue;
  files[bin.fileName] = (await this.helpers.getBinaryDataBuffer(i, 'data')).toString('utf8');
}
for (const f of ['settings.json', 'resume_base.md', 'cover_letter_base.md', 'search_profile.md']) {
  if (!files[f]) throw new Error(`Missing ${f === 'settings.json' ? f : 'candidate/' + f}. Run ./jobradar setup, or the onboarding interview (onboarding/README.md).`);
}
let settings;
try { settings = JSON.parse(files['settings.json']); } catch (e) { throw new Error('settings.json is not valid JSON: ' + e.message); }
const env = { APIFY_TOKEN: envGet('APIFY_TOKEN'), MOCK: envGet('JOBRADAR_MOCK_BASE') };
let manualUrl = '';
let leads = null;
try {
  const b = $('🔗 Run from CLI').first().json.body || {};
  manualUrl = typeof b.url === 'string' ? b.url.trim() : '';
  if (Array.isArray(b.leads)) leads = b.leads.filter((l) => l && l.id && l.title && l.company).slice(0, 60);
} catch (e) { /* not started from the webhook */ }
// Night pause (notifications.quietHours with "pause": true): scheduled runs do nothing — no AI calls, no messages.
// LinkedIn alert jobs that arrive meanwhile wait and are checked on the first run after the pause.
// Runs you start yourself (./jobradar run, a pasted link) still go through.
const state0 = $getWorkflowStaticData('global');
let scheduled = false;
try { scheduled = $('⏰ Every 15 minutes').all().length > 0; } catch (e) { /* not started by the schedule */ }
const qh = (settings.notifications || {}).quietHours || {};
const paused = qh.pause === true && (scheduled || leads) && !manualUrl && inQuietHours(qh, envGet('GENERIC_TIMEZONE'), Date.now());
if (paused) {
  if (leads && leads.length) state0.pendingLeads = (state0.pendingLeads || []).concat(leads).slice(-150);
  return [];
}
if (!leads && !manualUrl && scheduled && (state0.pendingLeads || []).length) { leads = state0.pendingLeads; state0.pendingLeads = []; }
let reqs;
if (leads) {
  // LinkedIn alert jobs: skip the ones already handled, and the ones your title/location filters drop anyway
  const state = $getWorkflowStaticData('global');
  const watched = watchList(settings, []);
  leads = leads.filter((l, i, a) => a.findIndex((x) => x.id === l.id) === i && !(state.seen || {})['linkedin:' + l.id]);
  leads = leads.filter((l) => { const w = watched[normName(l.company)]; return !preFilter({ title: l.title, description: '', location: l.location || '', dream: !!(w && w.dream), postedAt: null }, settings, Date.now()); });
  reqs = leadRequests(leads, settings, state.leadBoards, Date.now(), env.MOCK || '').reqs;
} else reqs = manualUrl ? manualRequests(manualUrl, env.MOCK || '') : buildRequests(settings, env, Date.now(), env.MOCK || '');
const { invalid } = companiesFromSettings(settings);
const candidate = { files, settings, invalidCompanies: invalid, manualUrl, leads };
if (leads && !leads.length) return [];
if (!reqs.length) return [{ json: { url: 'about:blank', source: 'none', _candidate: candidate } }];
return reqs.map((r, i) => ({ json: i === 0 ? Object.assign({}, r, { _candidate: candidate }) : r }));

//@node source_health
// 🩺 Source health — tell me (once a day per source) when a board or company link is broken
const plan = $('⚙️ Plan run').all();
const resp = $input.all();
const state = $getWorkflowStaticData('global');
state.health = state.health || {};
const now = Date.now();
const bad = [];
const invalid = plan[0].json._candidate.leads ? [] : (plan[0].json._candidate.invalidCompanies || []);
for (const u of invalid) {
  const key = 'url:' + u;
  if (!state.health[key] || now - state.health[key] > 864e5) { bad.push({ name: u, problem: "can't tell which job board this careers link uses — paste the link of the page that lists the jobs" }); state.health[key] = now; }
}
for (let i = 0; i < resp.length; i++) {
  const req = plan[i] && plan[i].json;
  if (!req || req.source === 'none' || req.manualUrl || req.lead) continue; // a pasted link / LinkedIn lead lookup isn't a source to monitor
  const r = resp[i].json;
  let problem = null;
  if (r.error) problem = (r.error.message || JSON.stringify(r.error)).slice(0, 140);
  else {
    const d = parseBody(r.data);
    if (d === null || d === '') problem = 'empty response';
    else if (req.slug && req.source !== 'himalayas' && req.source !== 'personio' && typeof d === 'object' && !Array.isArray(d) && !d.jobs && !d.offers && !d.content && !d.result && !d.data) problem = 'unexpected response — wrong company link?';
    else if (d && d.error && req.source === 'hiringcafe_mcp') problem = 'Hiring Cafe MCP error: ' + JSON.stringify(d.error).slice(0, 100);
    else if (d && d.result && d.result.isError) { // MCP tools report failures inside a normal 200 reply
      const msg = [].concat(d.result.content || []).map((c) => c && c.text).filter(Boolean).join(' ');
      problem = 'returned an error: ' + (msg || 'no details').slice(0, 120);
    } else if (!req.company) {
      // job boards (not company pages, which can legitimately have no openings): zero usable jobs for a day = broken
      let count = 0; try { count = normalize(req, r.data).length; } catch (e) {}
      state.yield = state.yield || {};
      const y = state.yield[req.source + ':' + (req.slug || '')] = state.yield[req.source + ':' + (req.slug || '')] || { since: now, last: null };
      if (count > 0) y.last = now;
      else if (now - (y.last || y.since) > 864e5) problem = 'no usable jobs for over 24 hours — the source may have changed or be blocking us';
    }
  }
  const key = req.source + ':' + (req.slug || '');
  if (problem) {
    if (!state.health[key] || now - state.health[key] > 864e5) { bad.push({ name: req.company || req.source, problem, src: req.source }); state.health[key] = now; }
  } else if (state.health[key]) delete state.health[key];
}
await postStatus(this.helpers, 'health', { run: $execution.id, problems: bad.map((b) => ({ name: b.name + (b.src ? ' (' + b.src + ')' : ''), problem: b.problem })) });
if (!bad.length) return [];
const lines = bad.map((b) => `• ${b.name}${b.src ? ' (' + b.src + ')' : ''}: ${b.problem}`);
const text = `JobRadar source check — these sources aren't delivering jobs. Fix or switch them off in settings.json:\n\n${lines.join('\n')}`;
return [
  { json: { kind: 'tg_text', tg: { text: '🩺 ' + text, disable_web_page_preview: true } } },
  { json: { kind: 'email', subject: 'JobRadar: some sources need attention', text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${escHtml(text)}</pre>` } },
];

//@node normalize
// 🧹 Normalize · dedupe · filter — one schema for every source; only new, relevant jobs go on (no tokens spent yet)
const plan = $('⚙️ Plan run').all();
const { files, settings } = plan[0].json._candidate;
const fetched = $('🌐 Fetch job sources').all();
const tracked = $('🗃️ Already sent').all().map((x) => x.json).filter((r) => r && r.uid);
const watchRows = $input.all().map((x) => x.json).filter((r) => r && r.name);
const watched = watchList(settings, watchRows);
const now = Date.now();
const state = $getWorkflowStaticData('global');
state.seen = state.seen || {};
const known = new Set();
const carded = new Set(); // jobs that actually went out as a card (tailored files, or a LinkedIn title-only card)
for (const r of tracked) {
  known.add(r.uid); if (r.alt_key) known.add('alt:' + r.alt_key);
  if (r.folder || r.source === 'linkedin') { carded.add(r.uid); if (r.alt_key) carded.add('alt:' + r.alt_key); }
}
// A job is "judged" once it was screened or filtered for a reason other than its age. Dream-company reposts and
// LinkedIn leads come through again unless judged or carded. Everything seen before this rule existed (or on the
// very first run) counts as judged — no burst of old roles.
state.judged = state.judged || state.dreamDone || {};
if (state.judgedBefore == null) state.judgedBefore = state.dreamDoneBefore != null ? state.dreamDoneBefore : now;
delete state.dreamDone; delete state.dreamDoneBefore;
const judged = (j) => !!state.judged[j.uid] || (state.seen[j.uid] != null && state.seen[j.uid] <= state.judgedBefore);
const leads = plan[0].json._candidate.leads;
const firstInstall = !state.initialized && tracked.length === 0;
const f = settings.filters || {};
const sc = settings.scoring || {};
const freshH = firstInstall ? 24 * ((settings.preview && settings.preview.days) || 7) : (f.freshHours || 72);

let jobs = [];
state.leadBoards = state.leadBoards || {};
const guessed = {};
for (let i = 0; i < fetched.length; i++) {
  const req = plan[i] ? plan[i].json : null;
  const r = fetched[i].json;
  if (!req || req.source === 'none') continue;
  if (req.guess) guessed[req.guess] = guessed[req.guess] || false;
  if (r.error) continue;
  try {
    const got = normalize(req, r.data);
    if (req.guess && got.length) { guessed[req.guess] = true; state.leadBoards[req.guess] = { ats: req.source, slug: req.slug, at: now }; }
    jobs = jobs.concat(got);
  } catch (e) { /* malformed payload — reported by 🩺 */ }
}
if (leads) {
  // each LinkedIn lead → its posting on the company's own job board (full description), else a title-only job
  for (const [n, found] of Object.entries(guessed)) if (!found) state.leadBoards[n] = { none: true, at: now };
  const out = [];
  for (const l of leads) {
    const n = normName(l.company);
    const hit = matchLead(l, jobs.filter((j) => normName(j.company) === n));
    out.push(hit ? Object.assign(hit, { viaLinkedIn: true, leadId: l.id, sourceLabel: hit.sourceLabel + ' · via LinkedIn alert' }) : lightJob(l));
  }
  jobs = out;
}
const manualUrl = plan[0].json._candidate.manualUrl;
if (manualUrl) {
  const one = jobs.length === 1 && jobs[0].source === 'manual' ? jobs[0] : pickManual(jobs, manualUrl);
  jobs = one ? [Object.assign(one, { manual: true })] : [];
  if (!one) await postStatus(this.helpers, 'gate', { run: $execution.id, manualUrl, manual: { found: false, note: "couldn't find that posting on its job board or read the page — it may be closed, or the page needs a login" } });
}
for (const j of jobs) { const w = watched[normName(j.company)]; if (w) { j.watched = true; if (w.dream) j.dream = true; if (w.relocateTo) j.relocateTo = w.relocateTo; } }
const stats = { fetched: jobs.length };
if (leads) { stats.linkedin = leads.length; stats.linkedinMatched = jobs.filter((j) => j.viaLinkedIn).length; }
// You just said you'd relocate for a company: its open roles get one fresh look under the new location rule
// (jobs you already got a card for still never repeat).
state.relocateKey = state.relocateKey || {};
for (const c of companiesFromSettings(settings).companies) {
  const key = c.relocateTo ? JSON.stringify(c.relocateTo) : '';
  const n = normName(c.name);
  if ((state.relocateKey[n] || '') === key) continue;
  state.relocateKey[n] = key;
  if (!key || !state.initialized) continue;
  const alt = 'alt:' + String(c.name).toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim() + '|';
  for (const k of Object.keys(state.seen)) if (k.includes(':' + c.slug + ':') || k.startsWith(alt)) delete state.seen[k];
  for (const k of Object.keys(state.judged)) if (k.includes(':' + c.slug + ':')) delete state.judged[k];
  stats.recheck = (stats.recheck || 0) + 1;
}
const passed = [];
const batch = new Set();
const mark = (j) => { state.seen[j.uid] = now; state.seen['alt:' + j.altKey] = now; if (j.leadId) state.seen['linkedin:' + j.leadId] = now; };
const noAge = Object.assign({}, settings, { filters: Object.assign({}, f, { freshHours: Infinity }) });
for (const j of jobs) {
  if (batch.has(j.uid) || batch.has('alt:' + j.altKey)) { stats.duplicate = (stats.duplicate || 0) + 1; continue; }
  batch.add(j.uid); batch.add('alt:' + j.altKey);
  if (j.manual) { passed.push(j); continue; } // you asked for this one: no dedupe, no filters
  if (leads || (j.dream && state.initialized)) {
    // Reposts + LinkedIn alerts: a role you never got a card for comes through again, whatever its date says
    // (a repost often keeps the old date, or a new ID with the same title). Each one is screened once.
    if (carded.has(j.uid) || carded.has('alt:' + j.altKey) || judged(j)) { state.judged[j.uid] = state.judged[j.uid] || now; mark(j); stats.seen = (stats.seen || 0) + 1; continue; }
    const repost = known.has(j.uid) || known.has('alt:' + j.altKey) || state.seen[j.uid] || state.seen['alt:' + j.altKey];
    const why = preFilter(j, noAge, now);
    if (why) { stats[why] = (stats[why] || 0) + 1; mark(j); state.judged[j.uid] = now; continue; }
    if (repost) stats.repost = (stats.repost || 0) + 1;
    passed.push(j); continue;
  }
  if (known.has(j.uid) || known.has('alt:' + j.altKey) || state.seen[j.uid] || state.seen['alt:' + j.altKey]) { stats.seen = (stats.seen || 0) + 1; continue; }
  const age = hoursSince(j.postedAt, now);
  // never flood: on the very first run only recent jobs (or undated ones at dream companies) go through
  if (!state.initialized && (age === null ? !j.dream : age > freshH)) { mark(j); stats.seeded = (stats.seeded || 0) + 1; continue; }
  const reason = preFilter(j, Object.assign({}, settings, { filters: Object.assign({}, f, { freshHours: freshH }) }), now);
  if (reason) { stats[reason] = (stats[reason] || 0) + 1; mark(j); if (reason !== 'too-old') state.judged[j.uid] = now; continue; }
  passed.push(j);
}
passed.sort((a, b) => (b.dream - a.dream) || ((b.postedAt || '').localeCompare(a.postedAt || '')));
const cap = Math.max(sc.maxScoredPerRun || 40, leads ? leads.length : 0); // a LinkedIn batch is screened in one go
const toScore = passed.slice(0, cap);
toScore.forEach((j) => { mark(j); state.judged[j.uid] = now; });
stats.toScore = toScore.length; stats.deferred = passed.length - toScore.length;
for (const k of Object.keys(state.seen)) if (now - state.seen[k] > 90 * 864e5) delete state.seen[k];
for (const k of Object.keys(state.judged)) if (now - state.judged[k] > 90 * 864e5) delete state.judged[k];
if (!leads) state.initialized = true;
if (!leads) state.lastRun = { at: new Date(now).toISOString(), stats, firstInstall };
if (!manualUrl) await postStatus(this.helpers, 'normalize', { run: $execution.id, stats });

const model = envGet('SCORING_MODEL') || 'claude-haiku-5-5';
return toScore.map((j) => ({ json: { job: j, preview: firstInstall && !leads, scoreRequest: scoreRequest(j, files['search_profile.md'], files['resume_base.md'], model) } }));

//@node gate
// 🎯 Gate — skills ≥ min AND values ≥ min appear; strong matches + dream companies get tailored now, the rest go to the daily "worth a look" list
const prev = $('🧹 Normalize · dedupe · filter').all();
const { files, settings } = $('⚙️ Plan run').first().json._candidate;
const sc = settings.scoring || {};
const minS = sc.minSkillsFit != null ? sc.minSkillsFit : 50;
const minV = sc.minValuesFit != null ? sc.minValuesFit : 50;
const instantAt = sc.instantAt != null ? sc.instantAt : 75;
const resp = $input.all();
const state = $getWorkflowStaticData('global');
const model = envGet('TAILORING_MODEL') || 'claude-sonnet-5-5';
const instant = [], digest = [], light = [];
let preview = false;
let manualResult = null;
for (let i = 0; i < resp.length; i++) {
  const p = prev[i] && prev[i].json;
  if (!p || !p.job) continue;
  preview = preview || p.preview;
  const job = p.job;
  const r = resp[i].json;
  const fit = r.error ? null : toolInput(r);
  if (!fit) {
    (job.light ? light : instant).push({ job, scoreError: true, fit: { score: null, skills_fit: null, values_fit: null, why: [], gaps: [], red_flags: [], keywords: [], values_match: [], role_family: '', seniority_fit: '', location_eligible: 'unclear', english_only: 'unclear', comp_meets_floor: 'unknown' },
      warnings: ['Not screened — Claude call failed (' + String((r.error && (r.error.message || r.error)) || 'no output').slice(0, 90) + ')'] });
    continue;
  }
  // JSON outputs can't enforce ranges/lengths in the schema — clamp here.
  const pct = (v) => (typeof v === 'number' && !isNaN(v) ? Math.max(0, Math.min(100, Math.round(v))) : v);
  fit.score = pct(fit.score); fit.skills_fit = pct(fit.skills_fit); fit.values_fit = pct(fit.values_fit);
  for (const [k, n] of [['why', 4], ['gaps', 4], ['red_flags', 3], ['values_match', 4], ['keywords', 12]]) if (Array.isArray(fit[k])) fit[k] = fit[k].slice(0, n);
  const skills = fit.skills_fit != null ? fit.skills_fit : fit.score;
  const values = fit.values_fit != null ? fit.values_fit : 50;
  // Safety net: the board said "anywhere" but the text says one country — never let that pass as a clean "yes".
  const lock = countryLock(job.description, files['search_profile.md']);
  const lockWarn = [];
  if (lock && fit.location_eligible === 'yes' && !relocateCovers(job.relocateTo, lock.country)) {
    fit.location_eligible = 'unclear';
    lockWarn.push(`Location: posting reads ${lock.country}-only (${lock.evidence}), though the board says "${job.location || 'remote'}". Check before applying.`);
  }
  const hardNo = fit.location_eligible === 'no' || fit.english_only === 'no' || fit.comp_meets_floor === 'no';
  const low = skills < (job.dream ? minS - 10 : minS) || values < minV;
  if (job.manual) {
    const why = [];
    if (fit.location_eligible === 'no') why.push('location: ' + (fit.location_reason || 'not hireable from where you are'));
    if (fit.english_only === 'no') why.push('needs a language other than English');
    if (fit.comp_meets_floor === 'no') why.push('pay is below your floor');
    if (low) why.push(`fit below your minimum (skills ${skills}, values ${values})`);
    manualResult = { found: true, company: job.company, title: job.title, score: fit.score, skills_fit: fit.skills_fit, values_fit: fit.values_fit, why: fit.why, gaps: fit.gaps, would_normally_skip: why };
    instant.push({ job, fit, warnings: lockWarn.concat(why.length ? ['You asked for this one — normally skipped: ' + why.join('; ')] : []) });
    continue;
  }
  if (job.light) { // LinkedIn alert, posting not on a public job board: nothing tailored. Same bar as everything else:
    // dream or ≥ instantAt → title-only card now; ≥ the skills minimum → daily "worth a look" list; else dropped.
    if (hardNo || (low && !job.dream)) continue;
    if (job.dream || fit.score >= instantAt) light.push({ job, fit, warnings: lockWarn });
    else if (fit.score >= minS) digest.push({ job, fit, warnings: lockWarn });
    continue;
  }
  if (hardNo || low) continue;
  (job.dream || fit.score >= instantAt ? instant : digest).push({ job, fit, warnings: lockWarn });
}
instant.sort((a, b) => (b.job.dream - a.job.dream) || ((b.fit.score || 0) - (a.fit.score || 0)));
const brief = (m) => ({ company: m.job.company, title: m.job.title, score: m.fit.score, url: m.job.applyUrl || m.job.url });
await postStatus(this.helpers, 'gate', { run: $execution.id, screened: resp.length, instant: instant.map(brief), digest: digest.map(brief), light: light.map(brief),
  manualUrl: $('⚙️ Plan run').first().json._candidate.manualUrl || undefined, manual: manualResult || undefined });
const fromLeads = !!$('⚙️ Plan run').first().json._candidate.leads; // a LinkedIn batch has no "next run" to wait for
const cap = preview ? ((settings.preview && settings.preview.count) || 3) : fromLeads ? Math.max(sc.maxTailoredPerRun || 4, instant.length) : (sc.maxTailoredPerRun || 4);
for (const m of instant.slice(cap)) { delete state.seen[m.job.uid]; delete state.seen['alt:' + m.job.altKey]; if (state.judged) delete state.judged[m.job.uid]; } // over the cap: picked up next run
return instant.slice(0, cap).map((m) => ({ json: Object.assign(m, { tier: 'instant', preview,
  tailorRequest: tailorRequest(m.job, m.fit, files['resume_base.md'], files['cover_letter_base.md'], files['search_profile.md'], files['experience_inventory.md'], model) }) }))
  .concat(digest.map((m) => ({ json: Object.assign(m, { tier: 'digest' }) })))
  .concat(light.map((m) => ({ json: Object.assign(m, { tier: 'light', jrId: 'JR-' + shortHash(m.job.uid) }) })));

//@node digest_rows
// 📝 "Worth a look" rows — listed in tomorrow's daily summary, not tailored
const now = new Date().toISOString();
return $input.all().map(({ json: m }) => ({ json: trackerRow(m.job, m.fit, { status: 'digest_pending', notified_at: now, folder: '', channel: channelsEnabled().join(',') }) }));

//@node compose
// 🛡️ Guardrails & compose — assemble the letter, check the AI's work, prepare files + notifications
const prev = $('🎯 Gate').all();
const { files, settings } = $('⚙️ Plan run').first().json._candidate;
const resp = $input.all();
const now = Date.now();
const resumeBase = files['resume_base.md'];
const coverBase = files['cover_letter_base.md'];
const nameLine = (stripHtmlComments(resumeBase).match(/^#\s+(.+)$/m) || [, 'Candidate'])[1].trim();
const nameFile = slugify(nameLine).replace(/-/g, '_');
const n = settings.notifications || {};
const formats = (Array.isArray(n.files) ? n.files : [n.files || 'docx']).filter((x) => x === 'docx' || x === 'pdf');
const out = [];
for (let i = 0; i < resp.length; i++) {
  const m = prev[i] && prev[i].json;
  if (!m) continue;
  const { job, fit } = m;
  const r = resp[i].json;
  const t = r.error ? null : toolInput(r);
  const warnings = [].concat(m.warnings || []);
  let resumeMd, slots, tailored = true;
  if (t && t.resume_md) {
    resumeMd = t.resume_md.trim() + '\n';
    slots = { HIRING_TEAM: t.hiring_team || `${job.company} Hiring Team`, WHY_COMPANY: t.why_company || '', LOCATION_LINE: t.location_line || '' };
  } else {
    tailored = false;
    warnings.push('Not tailored — these are your base files (' + String((r.error && (r.error.message || r.error)) || 'no output').slice(0, 80) + ')');
    resumeMd = stripHtmlComments(resumeBase);
    const opts = (coverBase.match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ''));
    slots = { HIRING_TEAM: `${job.company} Hiring Team`, WHY_COMPANY: '', LOCATION_LINE: opts[opts.length - 1] || '' };
  }
  const coverLetter = fillCoverLetter(coverBase, slots);
  const issues = tailored ? checkTailoring(resumeBase, resumeMd, coverLetter, {
    inventory: files['experience_inventory.md'] || '',
    forbidden: (settings.guardrails && settings.guardrails.neverClaim) || [],
    coverSlotsText: slots.WHY_COMPANY + ' ' + slots.HIRING_TEAM,
  }) : [];
  const kw = keywordCoverage(fit.keywords, resumeMd + '\n' + coverLetter);
  const jrId = 'JR-' + shortHash(job.uid);
  const folder = `${new Date(now).toISOString().slice(0, 10)}_${slugify(job.company, 30)}_${slugify(job.title, 40)}`;
  const co = slugify(job.company, 30).replace(/-/g, '_');
  const docs = { resumeBase: `${nameFile}_Resume_${co}`, coverBase: `${nameFile}_Cover_Letter_${co}`, changesBase: `${nameFile}_What_Changed_${co}` };
  // what tailoring changed vs. the base resume: one line on the card + a review file when anything changed
  const diff = tailored ? resumeDiff(resumeBase, resumeMd) : null;
  const changes = diff ? { summary: diff.summary, unchanged: diff.unchanged, pct: diff.pct, counts: diff.counts } : null;
  const changesMd = diff && !diff.unchanged ? changesDoc(diff, job.company, slots) : null;
  const review = t ? { role_summary: t.role_summary, changes: t.changes, verify: t.verify, intro_call_prep: t.intro_call_prep, outreach_note: t.outreach_note, team_search: t.team_search } : null;
  out.push({ json: { jrId, job, fit, review, issues, warnings, keywordCoverage: kw, changes, changesMd, resumeMd, coverLetter, folder, docs, formats, preview: !!m.preview,
    record: { jrId, job, fit, review, issues, warnings, keywordCoverage: kw, changes, docs, formats, createdAt: new Date(now).toISOString() } } });
}
return out;

//@node render_requests
// 📑 Render requests — one request per document and format
const jobs = $('🛡️ Guardrails & compose').all();
const out = [];
for (const it of jobs) {
  const j = it.json;
  for (const format of j.formats) {
    out.push({ json: { jrId: j.jrId, prop: `resume_${format}`, body: { folder: j.folder, fileBase: j.docs.resumeBase, kind: 'resume', format, markdown: j.resumeMd, title: `${j.docs.resumeBase}` } } });
    out.push({ json: { jrId: j.jrId, prop: `cover_${format}`, body: { folder: j.folder, fileBase: j.docs.coverBase, kind: 'letter', format, markdown: j.coverLetter, title: `${j.docs.coverBase}` } } });
    if (j.changesMd && j.docs.changesBase) out.push({ json: { jrId: j.jrId, prop: `changes_${format}`, body: { folder: j.folder, fileBase: j.docs.changesBase, kind: 'resume', format, markdown: j.changesMd, title: `${j.docs.changesBase}` } } });
  }
}
return out;

//@node save_sources
// 🗂️ Editable sources — resume.md, cover_letter.md and job.json next to the files (for ./jobradar rerender)
return $input.all().map((it) => ({ json: { body: { folder: it.json.folder, files: {
  'resume.md': it.json.resumeMd, 'cover_letter.md': it.json.coverLetter, 'job.json': JSON.stringify(it.json.record, null, 2),
  ...(it.json.changesMd ? { 'what_changed.md': it.json.changesMd } : {}) } } } }));

//@node bundle
// 📦 Bundle — files per job + the notifications to send (Telegram card + album, and/or one email)
const reqs = $('📑 Render requests').all();
const jobs = $('🛡️ Guardrails & compose').all().map((x) => x.json);
const { settings } = $('⚙️ Plan run').first().json._candidate;
const n = settings.notifications || {};
const rendered = $input.all();
const byJob = {};
for (let i = 0; i < rendered.length; i++) {
  const rq = reqs[i] && reqs[i].json;
  const it = rendered[i];
  if (!rq || !it.binary || !it.binary.data) continue;
  const bin = Object.assign({}, it.binary.data, { fileName: `${rq.body.fileBase}.${rq.body.format}` });
  (byJob[rq.jrId] = byJob[rq.jrId] || {})[rq.prop] = bin;
}
const channels = channelsEnabled();
const quiet = inQuietHours(n.quietHours, envGet('GENERIC_TIMEZONE'), Date.now());
const to = envGet('NOTIFY_EMAIL_TO') || envGet('SMTP_USER') || '';
const digest = n.delivery === 'digest';
const out = [];
for (const c of jobs) {
  if (digest) continue;
  const bins = byJob[c.jrId] || {};
  if (channels.includes('telegram')) {
    const card = telegramCard(c, n);
    if (quiet) card.disable_notification = true;
    if (c.preview) card.text = '👋 <i>First run: a match from the last few days.</i>\n\n' + card.text;
    out.push({ json: { kind: 'tg_text', jrId: c.jrId, tg: card } });
    for (const fmt of c.formats) {
      const r = bins[`resume_${fmt}`], cv = bins[`cover_${fmt}`], ch = bins[`changes_${fmt}`];
      if (!r || !cv) continue;
      const media = [{ type: 'document', media: 'attach://doc1' }, { type: 'document', media: 'attach://doc2' }];
      const binary = { doc1: r, doc2: cv };
      if (ch) { media.push({ type: 'document', media: 'attach://doc3' }); binary.doc3 = ch; }
      media[media.length - 1].caption = `${c.job.company} · ${fmt.toUpperCase()}`;
      out.push({ json: { kind: ch ? 'tg_album3' : 'tg_album', jrId: c.jrId, silent: quiet, media }, binary });
    }
  }
  if (channels.includes('email')) {
    const e = emailForJob(c, n, to);
    const binary = {}; const props = [];
    for (const [k, v] of Object.entries(bins)) { binary[k] = v; props.push(k); }
    out.push({ json: { kind: 'email', jrId: c.jrId, subject: (c.preview ? '[first run] ' : '') + e.subject, html: e.html, text: e.text, attach: props.join(',') }, binary });
  }
}
return out;

//@node track_rows
// 📝 Tracker rows — every tailored match goes into the jobradar_jobs table (status, timestamps, outcome later)
const { settings } = $('⚙️ Plan run').first().json._candidate;
const digest = (settings.notifications || {}).delivery === 'digest';
const now = new Date().toISOString();
return $('🛡️ Guardrails & compose').all().map(({ json: c }) => ({ json: Object.assign(trackerRow(c.job, c.fit, {
  status: digest ? 'digest_pending' : 'notified', notified_at: now, folder: c.folder, channel: channelsEnabled().join(','),
}), { jr_id: c.jrId }) }));

//@node light_cards
// 🔎 LinkedIn title-only cards — the posting isn't on a public job board, so nothing is tailored; open it on LinkedIn
const { settings } = $('⚙️ Plan run').first().json._candidate;
const n = settings.notifications || {};
const quiet = inQuietHours(n.quietHours, envGet('GENERIC_TIMEZONE'), Date.now());
const channels = channelsEnabled();
const to = envGet('NOTIFY_EMAIL_TO') || envGet('SMTP_USER') || '';
const out = [];
for (const { json: c } of $input.all()) {
  if (channels.includes('telegram')) { const card = lightCard(c, n); if (quiet) card.disable_notification = true; out.push({ json: { kind: 'tg_text', jrId: c.jrId, tg: card } }); }
  if (channels.includes('email')) { const e = lightEmail(c, n, to); out.push({ json: { kind: 'email', jrId: c.jrId, subject: e.subject, html: e.html, text: e.text, attach: '' } }); }
}
return out;

//@node light_rows
// 📝 Tracker rows for the LinkedIn title-only cards (so ✅ Applied / ⏭ Skip and the reports work)
const now = new Date().toISOString();
return $input.all().map(({ json: c }) => ({ json: Object.assign(trackerRow(c.job, c.fit, { status: 'notified', notified_at: now, folder: '', channel: channelsEnabled().join(',') }), { jr_id: c.jrId }) }));
