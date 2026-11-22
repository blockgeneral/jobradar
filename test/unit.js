// Unit tests: source adapters, filters, guardrails, notifications, and the Code-node logic the e2e run can't reach
// (email commands, reply detection, digests). Run: node test/unit.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const libSrc = ['util', 'sources', 'prompts', 'guard', 'notify'].map((n) => fs.readFileSync(path.join(ROOT, 'src/lib', n + '.js'), 'utf8')).join('\n');
const L = new Function('$env', libSrc + '; return { normalize, watchList, normName, preFilter, checkTailoring, keywordCoverage, toIso, detectAts, companiesFromSettings, buildRequests, parseBody, telegramCard, emailForJob, computeReport, telegramReport, inQuietHours, shortHash, fillCoverLetter, countryLock, claimCheck, contactLinks, resumeDiff, changesDoc, manualRequests, pickManual, parseLinkedInAlert, matchLead, lightJob, leadRequests, lightCard };')({ NOTIFY_CHANNELS: 'telegram,email' });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✔ ' + name); };
const now = Date.now();

// Code-node harness: runs a //@node block from src/wf with fake n8n globals
function nodeBlocks(file) { const o = {}; for (const c of fs.readFileSync(path.join(ROOT, 'src/wf', file), 'utf8').split(/^\/\/@node\s+/m).slice(1)) o[c.split('\n')[0].trim()] = c.split('\n').slice(1).join('\n'); return o; }
const OTH = nodeBlocks('others.js');
const RAD = nodeBlocks('radar.js');
async function runNode(code, { input = [], nodes = {}, env = {}, state = {} }) {
  const fn = new Function('$input', '$', '$env', '$getWorkflowStaticData', '$execution', `return (async function(){\n${code}\n${libSrc}\n}).call(this)`);
  const $ = (name) => { if (!(name in nodes)) throw new Error('node not executed: ' + name); const items = nodes[name].map((j) => ({ json: j })); return { all: () => items, first: () => items[0] }; };
  return fn.call({ helpers: {} }, { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) }, $, env, () => state, { id: 'test' });
}

(async () => {
  console.log('sources');
  t('career links → ATS', () => {
    const cases = { 'https://jobs.ashbyhq.com/n8n': ['ashby', 'n8n'], 'https://job-boards.greenhouse.io/anthropic/jobs/123': ['greenhouse', 'anthropic'], 'https://boards.greenhouse.io/vercel': ['greenhouse', 'vercel'],
      'https://jobs.lever.co/palantir': ['lever', 'palantir'], 'https://jobs.eu.lever.co/mistral': ['lever_eu', 'mistral'], 'https://apply.workable.com/huggingface/': ['workable', 'huggingface'],
      'https://acme.recruitee.com/': ['recruitee', 'acme'], 'https://bitpanda.jobs.personio.de/': ['personio', 'bitpanda'], 'https://jobs.smartrecruiters.com/Visa': ['smartrecruiters', 'Visa'] };
    for (const [u, [ats, slug]] of Object.entries(cases)) assert.deepEqual(L.detectAts(u), { ats, slug }, u);
    assert.equal(L.detectAts('https://example.com/careers'), null);
    const { companies, invalid } = L.companiesFromSettings({ companies: ['https://jobs.ashbyhq.com/n8n', { url: 'https://jobs.lever.co/acme-corp', dream: true }, 'https://example.com/jobs'] });
    assert.equal(companies[0].name, 'n8n'); assert.equal(companies[1].name, 'Acme Corp'); assert.equal(companies[1].dream, true); assert.deepEqual(invalid, ['https://example.com/jobs']);
  });
  t('Hiring Cafe MCP (SSE + JSON text block) → jobs', () => {
    const sse = 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ jobs: [{ id: 'x', title: 'AE', company: 'Co', url: 'https://hiring.cafe/job/x', location: 'Remote' }] }) }] } });
    const j = L.normalize({ source: 'hiringcafe_mcp' }, sse);
    assert.equal(j.length, 1); assert.equal(j[0].company, 'Co'); assert.equal(j[0].remote, true);
    const structured = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: { results: [{ title: 'AM', companyName: 'B', apply_url: 'https://b/apply' }] } } });
    assert.equal(L.normalize({ source: 'hiringcafe_mcp' }, structured)[0].applyUrl, 'https://b/apply');
  });
  t('Pinpoint (SafetyWing) + watch-by-name', () => {
    assert.deepEqual(L.detectAts('https://safetywing.pinpointhq.com/en/postings/x'), { ats: 'pinpoint', slug: 'safetywing' });
    const j = L.normalize({ source: 'pinpoint', slug: 'safetywing', company: 'SafetyWing', dream: true }, JSON.stringify({ data: [{ id: 'p1', title: 'Platform Business Partner', url: 'https://u', workplace_type: 'remote', location: { name: 'Remote' }, description: '<p>UTC+0 to UTC+6</p>', compensation_visible: true, compensation_minimum: 90000, compensation_maximum: 120000, compensation_currency: 'USD', compensation_frequency: 'year' }] }));
    assert.equal(j[0].remote, true); assert.equal(j[0].postedAt, null); assert.equal(j[0].salary, 'USD 90000-120000 year');
    const w = L.watchList({ companies: [{ name: 'PetsApp', dream: true }, 'https://jobs.ashbyhq.com/n8n', { name: 'Deel', aliases: ['Deel Inc'] }] }, [{ name: 'Oyster', dream: true }]);
    assert.ok(w[L.normName('PetsApp')].dream); assert.ok(w[L.normName('n8n')]); assert.ok(w[L.normName('Deel Inc.')]); assert.ok(w[L.normName('oyster')]);
    assert.equal(L.companiesFromSettings({ companies: [{ name: 'PetsApp' }] }).companies.length, 0);
  });
  t('Recruitee / Personio / SmartRecruiters / Lever / Himalayas / Jobicy adapters', () => {
    let j = L.normalize({ source: 'recruitee', slug: 'acme', company: 'Acme' }, JSON.stringify({ offers: [{ id: 9, title: 'Account Executive', location: 'Vienna', country: 'Austria', remote: true, careers_url: 'u', careers_apply_url: 'a', published_at: '2026-11-21 08:00:00 UTC', description: '<p>x</p>' }] }));
    assert.equal(j[0].remote, true); assert.equal(j[0].applyUrl, 'a');
    j = L.normalize({ source: 'personio', slug: 'bitpanda', company: 'Bitpanda' }, '<workzag-jobs><position><id>77</id><office>Vienna</office><name>Account Manager</name><createdAt>2026-11-21T07:00:00+00:00</createdAt><jobDescriptions><jobDescription><name>About</name><value><![CDATA[<p>English team</p>]]></value></jobDescription></jobDescriptions></position></workzag-jobs>');
    assert.equal(j[0].title, 'Account Manager'); assert.equal(j[0].url, 'https://bitpanda.jobs.personio.de/job/77'); assert.ok(j[0].description.includes('English'));
    j = L.normalize({ source: 'smartrecruiters', slug: 'Visa', company: 'Visa' }, JSON.stringify({ content: [{ id: 's1', name: 'Account Executive', releasedDate: '2026-11-21T07:00:00Z', location: { city: 'Vienna', country: 'at', remote: false } }] }));
    assert.equal(j[0].location, 'Vienna, at');
    j = L.normalize({ source: 'lever', slug: 'acme', company: 'Acme' }, JSON.stringify([{ id: 'x1', text: 'Account Executive', categories: { allLocations: ['London', 'Remote EU'] }, createdAt: now - 3600e3, hostedUrl: 'h', applyUrl: 'a', workplaceType: 'remote', descriptionPlain: 'Sell' }]));
    assert.equal(j[0].location, 'London / Remote EU');
    j = L.normalize({ source: 'himalayas' }, JSON.stringify({ jobs: [{ title: 'AE', companyName: 'X', pubDate: Math.floor(now / 1000) - 600, guid: 'g', applicationLink: 'a', locationRestrictions: ['Austria'] }] }));
    assert.ok(Math.abs(new Date(j[0].postedAt) - (now - 600e3)) < 2000);
    j = L.normalize({ source: 'jobicy' }, JSON.stringify({ jobs: [{ id: 5, url: 'u', jobTitle: 'Account Manager &amp; Partnerships', companyName: 'Y', pubDate: '2026-11-21 08:00:20' }] }));
    assert.equal(j[0].title, 'Account Manager & Partnerships'); assert.equal(j[0].postedAt, '2026-11-21T08:00:20.000Z');
  });
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/settings.json'), 'utf8'));
  t('requests: MCP is POST, boards GET, Hiring Cafe only on its interval', () => {
    const s2 = JSON.parse(JSON.stringify(settings)); s2.hiringCafe = { enabled: true, via: 'mcp', queries: ['a', 'b'], everyMinutes: 60 };
    const atTop = new Date('2026-11-21T10:05:00Z').getTime(), mid = new Date('2026-11-21T10:35:00Z').getTime();
    assert.equal(L.buildRequests(s2, {}, atTop).filter((r) => r.source === 'hiringcafe_mcp' && r.method === 'POST').length, 2);
    assert.equal(L.buildRequests(s2, {}, mid).filter((r) => r.source === 'hiringcafe_mcp').length, 0);
  });

  console.log('filters & guardrails');
  const alex = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/sales-settings.json'), 'utf8'));
  const mk = (title, extra) => Object.assign({ title, description: '', location: '', postedAt: new Date(now - 3600e3).toISOString(), dream: false }, extra || {});
  t('title / language / freshness filters', () => {
    assert.equal(L.preFilter(mk('Mid-Market Account Executive'), alex, now), null);
    assert.equal(L.preFilter(mk('Sales Development Representative'), alex, now), 'title-not-relevant');
    assert.equal(L.preFilter(mk('SDR, EMEA', { dream: true }), alex, now), null);
    assert.equal(L.preFilter(mk('Account Executive (German-speaking)'), alex, now), 'title-excluded');
    assert.equal(L.preFilter(mk('Account Executive', { description: 'You are fluent in German (C1).' }), alex, now), 'language-requirement');
    assert.equal(L.preFilter(mk('Account Executive', { description: 'German is a plus.' }), alex, now), null);
    assert.equal(L.preFilter(mk('Account Executive', { postedAt: new Date(now - 200 * 3600e3).toISOString() }), alex, now), 'too-old');
  });
  const base = fs.readFileSync(path.join(ROOT, 'examples/candidate/resume_base.md'), 'utf8');
  const inventory = fs.readFileSync(path.join(ROOT, 'examples/candidate/experience_inventory.md'), 'utf8');
  const exNever = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/settings.json'), 'utf8')).guardrails.neverClaim;
  const clean = base.replace(/<!--[\s\S]*?-->/g, '');
  t('guardrails catch invented numbers, never-claim items, dropped sections; inventory facts allowed', () => {
    assert.deepEqual(L.checkTailoring(base, clean, 'Dear X', { forbidden: exNever, inventory, coverSlotsText: '' }), []);
    const bad = clean.replace('40% in two quarters', '65% in two quarters').replace('## Education and Languages', '## Education') + '\n- Ran production Kubernetes clusters';
    const issues = L.checkTailoring(base, bad, 'Dear X', { forbidden: exNever, inventory, coverSlotsText: 'We grew 300% together' });
    for (const k of ['65%', 'Kubernetes', 'Education and Languages', '300%']) assert.ok(issues.some((i) => i.includes(k)), k + ' → ' + JSON.stringify(issues));
    const fromInv = clean.replace('Mentored three mid-level engineers', 'Wrote 12 post-mortems; mentored three mid-level engineers');
    assert.deepEqual(L.checkTailoring(base, fromInv, 'x', { inventory, forbidden: exNever }), []);
    assert.ok(L.checkTailoring(base, clean.replace('sam.rivera@example.com', 'x@y.com'), 'x', { inventory }).some((i) => /Contact/.test(i)));
  });
  t('sales never-claim patterns', () => {
    const issues = L.checkTailoring('# A\n\n## S\n', '# A\n\n## S\nBuilt the partner program. Skills: PostgreSQL', 'x', { forbidden: alex.guardrails.neverClaim });
    assert.equal(issues.filter((i) => !/^Upgraded claim/.test(i)).length, 2);
    assert.ok(issues.some((i) => /^Upgraded claim: "built the partner program/.test(i)), JSON.stringify(issues));
  });
  t('upgraded claims: "worked" never becomes "built", "helped lead" stays hedged', () => {
    const cv = 'Worked the partner channel (agencies): built outreach lists, ran partner discussions. Helped lead the shift to annual contracts.';
    assert.ok(L.claimCheck(cv, '- Built the partner channel with agencies')[0].includes('built the partner channel'));
    assert.ok(/helped with this/.test(L.claimCheck(cv, '- Led the shift to annual contracts')[0]));
    assert.deepEqual(L.claimCheck(cv, '- Built outreach lists for agencies\n- Helped lead the shift to annual contracts'), []);
    assert.deepEqual(L.claimCheck(cv, "Your product was built for remote teams, and I'd like to grow your partner base."), []);
  });
  t('ATS keyword coverage', () => assert.deepEqual(L.keywordCoverage(['event-driven', 'MEDDPICC', 'on-call', 'design docs'], clean).missing, ['MEDDPICC']));

  console.log('notifications');
  const c = { jrId: 'JR-ABC123', job: { title: 'Mid-Market AE', company: 'n8n', location: 'Remote - EMEA / Berlin', workplaceType: 'Remote', postedAt: new Date(now - 22 * 60000).toISOString(), applyUrl: 'https://a/apply', url: 'https://a', dream: true, salary: '€130K – €160K OTE', sourceLabel: 'Ashby (direct)' },
    fit: { score: 87, why: ['Full-cycle AE on a technical product'], gaps: ['MEDDPICC'], keywords: [] }, review: { outreach_note: 'Hi — applied for the AE role.', team_search: 'n8n head of sales', verify: ['MEDDPICC asked'], changes: ['Headline'] },
    issues: [], warnings: [], keywordCoverage: { covered: [], missing: [], pct: null } };
  t('Telegram card: compact, all buttons valid', () => {
    const card = L.telegramCard(c, { style: 'compact' });
    assert.ok(card.text.length < 600, card.text.length);
    const flat = card.reply_markup.inline_keyboard.flat();
    assert.ok(flat.every((b) => b.url || b.callback_data || b.copy_text));
    assert.ok(flat.find((b) => b.copy_text).copy_text.text.length <= 256);
    assert.ok(flat.filter((b) => b.callback_data).every((b) => Buffer.byteLength(b.callback_data) <= 64));
    const noBtn = L.telegramCard(c, { buttons: { linkedinSearch: false, copyOutreachNote: false, statusButtons: false } });
    assert.equal(noBtn.reply_markup.inline_keyboard.length, 1);
    assert.ok(L.telegramCard(c, { style: 'detailed' }).text.includes('What changed'));
  });
  t('email: subject line is the headline; mailto commands', () => {
    const e = L.emailForJob(c, {}, 'me+jobradar@gmail.com');
    assert.match(e.subject, /^87 · Mid-Market AE at n8n · Remote - EMEA · posted 22 min ago$/);
    assert.ok(e.html.includes('mailto:me+jobradar@gmail.com?subject=JobRadar%20APPLIED%20JR-ABC123%20JR-CMD'));
  });
  t('quiet hours wrap past midnight', () => {
    const at = (h) => new Date(`2026-11-21T${h}:00Z`).getTime();
    assert.equal(L.inQuietHours({ from: '22:30', to: '07:30' }, 'UTC', at('23:00')), true);
    assert.equal(L.inQuietHours({ from: '22:30', to: '07:30' }, 'UTC', at('06:59')), true);
    assert.equal(L.inQuietHours({ from: '22:30', to: '07:30' }, 'UTC', at('12:00')), false);
  });
  t('report maths + honest small-sample note', () => {
    const iso = (d) => new Date(now - d * 864e5).toISOString();
    const rows = [
      { jr_id: 'a', status: 'applied', notified_at: iso(3), applied_at: iso(3), posted_at: iso(3.1), outcome: 'intro', source: 'ashby', minutes_to_alert: 12 },
      { jr_id: 'b', status: 'applied', notified_at: iso(6), applied_at: iso(6), posted_at: iso(6.05), outcome: 'rejected', source: 'greenhouse', minutes_to_alert: 30 },
      { jr_id: 'c', status: 'applied', notified_at: iso(9), applied_at: iso(8), outcome: '', source: 'ashby', minutes_to_alert: 40 },
      { jr_id: 'd', status: 'skipped', notified_at: iso(1), source: 'remotive', minutes_to_alert: 100 }];
    const R = L.computeReport(rows, 'weekly', now, { checkInAfterDays: 5 });
    assert.equal(R.notified, 3); assert.equal(R.applied, 2); assert.equal(R.responded, 2); assert.equal(R.intro, 1); assert.equal(R.pending.length, 1);
    const msgs = L.telegramReport(R);
    assert.ok(msgs[0].tg.text.includes('Small numbers')); assert.ok(msgs[1].tg.reply_markup.inline_keyboard[1].some((b) => b.callback_data === 'o:c:intro'));
  });

  console.log('workflow logic (email + replies + digest)');
  t('cover letter slot filling', () => assert.equal(L.fillCoverLetter('<!-- x -->Dear {{A}},\n\n{{B}}\n\nBye', { A: 'Team', B: '' }), 'Dear Team,\n\nBye\n'));
  const parsed = await runNode(OTH.inbox_parse, { input: [{ subject: 'JobRadar APPLIED JR-ABC123 JR-CMD' }, { subject: 'Re: JobRadar OUTCOME intro JR-XYZ789 JR-CMD' }, { subject: '87 · AE at n8n' }] });
  t('email command parsing (applied / outcome / ignore notifications)', () => {
    assert.equal(parsed.length, 2); assert.equal(parsed[0].json.status, 'applied'); assert.equal(parsed[1].json.outcome, 'intro');
  });
  const rows = [{ jr_id: 'JR-AAAAAA', company: 'n8n', title: 'AE', status: 'applied' }, { jr_id: 'JR-BBBBBB', company: 'Supabase', title: 'AE', status: 'skipped' }];
  const pre = await runNode(OTH.replies_prefilter, { input: rows, nodes: { '📨 New inbox mail': [
    { from: 'Jane <jane@n8n.io>', subject: 'Your application', text: 'Hi Alex, can we talk?' },
    { from: 'news@shop.com', subject: 'Sale!', text: '50% off' },
    { from: 'no-reply@ashbyhq.com', subject: 'Update on your application', text: 'Thank you for applying to Supabase' }] } });
  t('reply detection: only mail about applied companies reaches Claude', () => {
    assert.equal(pre.length, 1); assert.ok(pre[0].json.request.messages[0].content.includes('JR-AAAAAA'));
  });
  const verdicts = await runNode(OTH.replies_apply, { input: [{ content: [{ type: 'text', text: JSON.stringify({ jr_id: 'JR-AAAAAA', outcome: 'intro', summary: 'n8n wants a call' }) }], stop_reason: 'end_turn' }], nodes: { '🔍 Plausible replies': pre.map((x) => x.json) } });
  t('reply verdict → tracker row + heads-up', () => { assert.equal(verdicts[0].json.row.outcome, 'intro'); assert.ok(verdicts[0].json.note.includes('📞')); });
  const dig = await runNode(OTH.reports_build, { env: { NOTIFY_CHANNELS: 'email', NOTIFY_EMAIL_TO: 'me+jobradar@x.com' }, input: [],
    nodes: { '🗃️ Tracker': [{ jr_id: 'JR-1', status: 'digest_pending', score: 70, skills_fit: 70, values_fit: 60, company: 'A', title: 'AE', apply_url: 'https://a' }, { jr_id: 'JR-2', status: 'notified', score: 90 }],
      "⏰ What's due": [{ due: 'digest', reports: {}, settings: {} }] } });
  t('digest: one email + marks pending rows as sent', () => {
    assert.equal(dig.filter((x) => x.json.kind === 'email').length, 1); assert.deepEqual(dig.filter((x) => x.json.kind === 'row_update').map((x) => x.json.row), [{ jr_id: 'JR-1', status: 'notified' }]);
  });
  const st = {};
  const presses = await runNode(OTH.actions_parse, { env: { TELEGRAM_CHAT_ID: '42' }, state: st, input: [{ data: JSON.stringify({ ok: true, result: [
    { update_id: 5, callback_query: { id: 'q', data: 'o:JR-1:offer', message: { chat: { id: 42 }, message_id: 1, reply_markup: { inline_keyboard: [[{ text: 'x', callback_data: 'o:JR-1:reply' }]] } } } }] }) }] });
  t('Telegram outcome press → row + edited buttons + offset advanced', () => {
    assert.equal(presses[0].json.set.outcome, 'offer'); assert.equal(st.offset, 6);
    assert.ok(JSON.stringify(presses[0].json.tgCalls[1].body.reply_markup).includes('🎉 offer'));
  });
  const wk = await runNode(OTH.reports_build, { env: { NOTIFY_CHANNELS: 'telegram' }, input: [{ name: 'Watched Co', dream: true }],
    nodes: { '🗃️ Tracker': [
      { jr_id: 'JR-3', company: 'Cool Co', values_fit: 85, notified_at: new Date().toISOString(), status: 'notified', values_note: 'async, remote-first' },
      { jr_id: 'JR-4', company: 'Watched Co', values_fit: 90, notified_at: new Date().toISOString(), status: 'notified' },
      { jr_id: 'JR-5', company: 'Meh Co', values_fit: 55, notified_at: new Date().toISOString(), status: 'notified' }],
      "⏰ What's due": [{ due: 'weekly', reports: {}, settings: { companies: ['https://jobs.ashbyhq.com/n8n'] } }] } });
  t('discovery: suggests unwatched companies with values ≥70, one-tap ➕', () => {
    const d = wk.find((x) => x.json.tg && /might want to watch/.test(x.json.tg.text));
    assert.ok(d && /Cool Co/.test(d.json.tg.text) && !/Watched Co|Meh Co/.test(d.json.tg.text));
    assert.equal(d.json.tg.reply_markup.inline_keyboard[0][0].callback_data, 'w:Cool Co');
  });
  const wpress = await runNode(OTH.actions_parse, { env: { TELEGRAM_CHAT_ID: '42' }, input: [{ data: JSON.stringify({ result: [
    { update_id: 9, callback_query: { id: 'q', data: 'w:Cool Co', message: { chat: { id: 42 }, message_id: 2, reply_markup: { inline_keyboard: [[{ text: '➕ Cool Co', callback_data: 'w:Cool Co' }]] } } } }] }) }] });
  t('➕ press → watch row + button turns into 👀', () => {
    assert.equal(wpress[0].json.watch.name, 'Cool Co'); assert.ok(JSON.stringify(wpress[0].json.tgCalls[1].body).includes('👀 Watching Cool Co'));
  });
  const wmail = await runNode(OTH.inbox_parse, { input: [{ subject: 'JobRadar WATCH Cool Co JR-CMD' }] });
  t('email ➕ Watch command', () => assert.equal(wmail[0].json.watch.name, 'Cool Co'));
  t('jr ids are stable and short', () => { assert.equal(L.shortHash('ashby:n8n:1'), L.shortHash('ashby:n8n:1')); assert.equal(L.shortHash('x').length, 6); });
  
// countryLock: board says "anywhere", posting text says one country
{
  const alexProfile = '# Who I am (one line)\nAccount Executive based in Vienna, Austria.\n';
  const usProfile = '# Who I am (one line)\nAE based in Austin, Texas, United States.\n';
  t('countryLock flags US pay zones', () => assert.equal((L.countryLock('Zone 3: All other US locations - $116,000', alexProfile) || {}).country, 'US'));
  t('countryLock flags US work authorization', () => assert.equal((L.countryLock('You must be authorized to work in the United States.', alexProfile) || {}).country, 'US'));
  t('countryLock flags UK right to work', () => assert.equal((L.countryLock('Candidates must have the right to work in the UK.', alexProfile) || {}).country, 'UK'));
  t('countryLock ignores truly global roles', () => assert.equal(L.countryLock('Fully remote; we hire anywhere through an employer of record. Pay in EUR.', alexProfile), null));
  t('countryLock stays quiet for candidates who live there', () => assert.equal(L.countryLock('Zone 3: All other US locations', usProfile), null));
}

// 🩺 source health: dead sources must not pass as healthy
{
  const cand = { files: {}, settings: {}, invalidCompanies: [] };
  const hcReq = { source: 'hiringcafe_mcp', slug: 'account executive', method: 'POST', url: 'x', _candidate: cand };
  const sse403 = 'event: message\ndata: {"result":{"content":[{"type":"text","text":"HiringCafe responded with HTTP 403 for https://hiring.cafe/jobs/x"}],"isError":true},"jsonrpc":"2.0","id":1}\n\n';
  const out = await runNode(RAD.source_health, { input: [{ data: sse403 }], nodes: { '⚙️ Plan run': [hcReq] }, state: {} });
  t('🩺 MCP isError inside a 200 reply → alert', () => { assert.ok(out.length === 2 && /HTTP 403/.test(out[0].json.tg.text), JSON.stringify(out).slice(0, 200)); });

  const wwr = { source: 'weworkremotely', method: 'GET', url: 'x', _candidate: cand };
  const empty = '<rss><channel></channel></rss>';
  const fresh = await runNode(RAD.source_health, { input: [{ data: empty }], nodes: { '⚙️ Plan run': [wwr] }, state: {} });
  t('🩺 board with no jobs: quiet on the first day', () => assert.equal(fresh.length, 0));
  const old = { yield: { 'weworkremotely:': { since: Date.now() - 2 * 864e5, last: null } } };
  const stale = await runNode(RAD.source_health, { input: [{ data: empty }], nodes: { '⚙️ Plan run': [wwr] }, state: old });
  t('🩺 board with no usable jobs for 24h+ → alert', () => assert.ok(stale.length === 2 && /no usable jobs/.test(stale[0].json.tg.text)));
  const company = { source: 'ashby', company: 'Quiet Co', slug: 'quiet', method: 'GET', url: 'x', _candidate: cand };
  const none = await runNode(RAD.source_health, { input: [{ data: { jobs: [] } }], nodes: { '⚙️ Plan run': [company] }, state: { yield: {} } });
  t('🩺 company page with no openings is fine', () => assert.equal(none.length, 0));
}

// 👤 named contact: link the person when the posting names them, generic searches otherwise
{
  const job = { company: 'n8n', description: 'Great role.' };
  t('👤 nobody named → recruiter + hiring-team searches', () => assert.deepEqual(L.contactLinks(job, {}, null).map((l) => l.text), ['🔎 Recruiters', '🔎 Hiring team']));
  t('👤 named hiring manager → search for that exact person + recruiter search', () => {
    const l = L.contactLinks(job, { contact_name: 'Jane Doe', contact_role: 'hiring_manager' }, null);
    assert.deepEqual(l.map((x) => x.text), ['👤 Jane Doe (hiring manager)', '🔎 Recruiters']);
    assert.ok(/Jane%20Doe%20n8n|Jane\+Doe\+n8n/.test(l[0].url), l[0].url);
  });
  t('👤 LinkedIn profile in the posting → direct link', () => {
    const l = L.contactLinks({ company: 'n8n', description: 'Questions? Reach out to Sam: https://www.linkedin.com/in/sam-recruits/ thanks' }, { contact_name: 'Sam Lee', contact_role: 'recruiter' }, null);
    assert.equal(l[0].url, 'https://www.linkedin.com/in/sam-recruits/');
    assert.deepEqual(l.map((x) => x.text), ['👤 Sam Lee (recruiter)', '🔎 Hiring team']);
  });
  t('👤 a made-up non-LinkedIn URL is ignored', () => assert.ok(!/evil/.test(L.contactLinks(job, { contact_name: 'Jane Doe', contact_url: 'https://evil.example/x' }, null)[0].url)));
}

// ✏️ what tailoring changed
{
  const base = '# Sam\nBackend Engineer\n\n## Summary\nI build payment systems. I like Go.\n\n## Experience\n- Rewrote checkout in Go\n- Cut p99 latency by 40%\n- Mentored three engineers\n- Ran on-call for payments';
  t('✏️ identical resume → unchanged', () => assert.equal(L.resumeDiff(base, base).unchanged, true));
  const tailored = base.replace('Backend Engineer', 'Platform Engineer').replace('- Mentored three engineers\n- Ran on-call for payments', '- Ran on-call for payments\n- Mentored three engineers').replace('- Cut p99 latency by 40%', '- Cut p99 checkout latency by 40%');
  const d = L.resumeDiff(base, tailored);
  t('✏️ reworded lines are paired before → after', () => {
    const rw = d.items.filter((x) => x.type === 'reworded').map((x) => [x.before, x.after]);
    assert.deepEqual(rw, [['Backend Engineer', 'Platform Engineer'], ['- Cut p99 latency by 40%', '- Cut p99 checkout latency by 40%']]);
  });
  t('✏️ reordered bullets count as moved, not changed', () => assert.equal(d.counts.moved, 1));
  t('✏️ card summary + review doc', () => {
    assert.match(d.summary, /summary\/headline rewritten · 1 line reworded · 1 moved/);
    const doc = L.changesDoc(d, 'Acme', { HIRING_TEAM: 'Acme Team', WHY_COMPANY: 'I use Acme daily.', LOCATION_LINE: 'Remote works.' });
    assert.ok(/\*\*Before:\*\* Cut p99 latency by 40%/.test(doc) && /\*\*After:\*\* Cut p99 checkout latency/.test(doc) && /I use Acme daily/.test(doc), doc);
  });
}

// 🔁 reposts: a dream-company role you never got a card for comes through again
{
  const D = 864e5;
  const cfgS = { companies: [{ name: 'Acme', url: 'https://jobs.lever.co/acme', dream: true }, { name: 'Beta', url: 'https://jobs.lever.co/beta' }], filters: { titleExclude: ['engineer'] }, scoring: {} };
  const plan = (slug, company, dream) => ({ source: 'lever', slug, company, dream, _candidate: { files: { 'search_profile.md': 'p', 'resume_base.md': '# Sam\n' }, settings: cfgS, manualUrl: '' } });
  const lever = (id, title, ageDays) => ({ data: JSON.stringify([{ id, text: title, categories: { allLocations: ['Remote EU'] }, createdAt: now - ageDays * D, hostedUrl: 'https://jobs.lever.co/x/' + id, applyUrl: 'a', workplaceType: 'remote', descriptionPlain: 'Sell software' }]) });
  const run = (slug, company, dream, job, tracked, state) => runNode(RAD.normalize, { input: [], state,
    nodes: { '⚙️ Plan run': [plan(slug, company, dream)], '🌐 Fetch job sources': [job], '🗃️ Already sent': tracked } });
  const old = () => ({ initialized: true, judgedBefore: now - 30 * D, seen: { 'lever:acme:old': now - 5 * D, 'alt:acme|account executive': now - 5 * D }, judged: { 'lever:acme:old': now - 5 * D } });

  let st = old();
  let out = await run('acme', 'Acme', true, lever('new', 'Account Executive', 10), [], st);
  t('🔁 dream repost (new ID, same title, old date) is screened again', () => { assert.equal(out.length, 1); assert.equal(st.lastRun.stats.repost, 1); assert.ok(st.judged['lever:acme:new']); });
  out = await run('acme', 'Acme', true, lever('new', 'Account Executive', 10), [], st);
  t('🔁 …but only once', () => assert.equal(out.length, 0));
  st = old();
  out = await run('acme', 'Acme', true, lever('new', 'Account Executive', 10), [{ uid: 'lever:acme:old', alt_key: 'acme|account executive', folder: '2026-11-01_acme_ae' }], st);
  t('🔁 no repeat when a card already went out for that role', () => assert.equal(out.length, 0));
  st = old();
  out = await run('acme', 'Acme', true, lever('old', 'Account Executive', 10), [], st);
  t('🔁 same dream job already screened is not re-screened', () => assert.equal(out.length, 0));
  st = { initialized: true, seen: { 'lever:acme:legacy': now - 5 * D } };
  out = await run('acme', 'Acme', true, lever('legacy', 'Account Executive', 10), [], st);
  t('🔁 jobs seen before the update don\'t come back in a burst', () => { assert.equal(out.length, 0); assert.ok(st.judgedBefore); });
  st = { initialized: true, seen: { 'lever:acme:legacy': now - 5 * D } };
  out = await run('acme', 'Acme', true, lever('fresh', 'Account Executive', 12), [], st);
  t('🔁 a new dream job with an old date gets through', () => assert.equal(out.length, 1));
  st = { initialized: true, seen: { 'alt:beta|account executive': now - 5 * D } };
  out = await run('beta', 'Beta', false, lever('new', 'Account Executive', 1), [], st);
  t('🔁 other companies: same title is still a duplicate', () => assert.equal(out.length, 0));
  st = { initialized: true, seen: {} };
  out = await run('beta', 'Beta', false, lever('n2', 'Account Executive', 10), [], st);
  t('🔁 other companies: old dates are still filtered', () => { assert.equal(out.length, 0); assert.equal(st.lastRun.stats['too-old'], 1); });
  st = { initialized: true, seen: {} };
  out = await run('acme', 'Acme', true, lever('eng', 'Software Engineer', 1), [], st);
  t('🔁 dream jobs still respect title filters (and stay filtered)', () => { assert.equal(out.length, 0); assert.ok(st.judged['lever:acme:eng']); });
}

// 💼 LinkedIn job alerts
{
  const TXT = `Your job alert for account executive in European Union
New jobs match your preferences.

Account Executive, Mid-Market
n8n
Berlin, Germany (Remote)
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc%3D&refId=x

---------------------------------------------------------

Senior Account Executive
Cool Co
Vienna, Austria
Actively recruiting
View job: https://www.linkedin.com/comm/jobs/view/4099999999/?trackingId=def

---------------------------------------------------------

See all jobs: https://www.linkedin.com/comm/jobs/search?keywords=account
Unsubscribe: https://www.linkedin.com/comm/psettings/email-unsubscribe?x`;
  const HTML = `<html><head><style>.x{}</style></head><body><table>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x"><img src="logo.png" alt="n8n"></a></td>
<td><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=x" style="color:#0a66c2">Account Executive, Mid-Market</a>
<p>n8n · Berlin, Germany (Remote)</p><p>Promoted</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4099999999/?trackingId=def">Senior Account Executive</a><p>Cool Co · Vienna, Austria</p><p>3 connections</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search?keywords=account">See all jobs</a></td></tr></table></body></html>`;
  t('💼 alert email (plain text) → leads', () => {
    const l = L.parseLinkedInAlert(TXT, '');
    assert.equal(l.length, 2, JSON.stringify(l));
    assert.deepEqual(l[0], { id: '4012345678', title: 'Account Executive, Mid-Market', company: 'n8n', location: 'Berlin, Germany (Remote)', url: 'https://www.linkedin.com/jobs/view/4012345678/' });
    assert.equal(l[1].company, 'Cool Co'); assert.equal(l[1].location, 'Vienna, Austria');
  });
  t('💼 alert email (HTML only) → same leads, logos and noise skipped', () => {
    const l = L.parseLinkedInAlert('', HTML);
    assert.equal(l.length, 2, JSON.stringify(l));
    assert.equal(l[0].title, 'Account Executive, Mid-Market'); assert.equal(l[0].company, 'n8n'); assert.equal(l[0].location, 'Berlin, Germany (Remote)');
    assert.equal(l[1].title, 'Senior Account Executive'); assert.equal(l[1].company, 'Cool Co');
  });
  t('💼 lead ↔ board posting: loose title match, no false match', () => {
    const jobs = [{ title: 'Sr. Account Executive (EMEA)' }, { title: 'Account Manager' }];
    assert.equal(L.matchLead({ title: 'Senior Account Executive' }, jobs).title, 'Sr. Account Executive (EMEA)');
    assert.equal(L.matchLead({ title: 'Partnerships Lead' }, jobs), null);
  });
  t('💼 where to look: own board, remembered board, guesses, nothing', () => {
    const settings = { companies: [{ name: 'n8n', url: 'https://jobs.ashbyhq.com/n8n', dream: true }] };
    const leads = [{ id: '1', title: 'AE', company: 'n8n' }, { id: '2', title: 'AE', company: 'Cool Co' }, { id: '3', title: 'AE', company: 'Known Inc' }, { id: '4', title: 'AE', company: 'Nobody' }];
    const boards = { [L.normName('Known Inc')]: { ats: 'lever', slug: 'known', at: now }, [L.normName('Nobody')]: { none: true, at: now } };
    const { reqs } = L.leadRequests(leads, settings, boards, now, '');
    assert.ok(reqs.some((r) => r.source === 'ashby' && r.slug === 'n8n' && r.dream && r.lead));
    assert.ok(reqs.some((r) => r.source === 'lever' && r.slug === 'known'));
    assert.deepEqual(reqs.filter((r) => r.guess === 'cool').map((r) => r.source + ':' + r.slug).sort(), ['ashby:cool', 'ashby:cool-co', 'greenhouse:cool', 'greenhouse:cool-co', 'lever:cool', 'lever:cool-co']);
    assert.ok(!reqs.some((r) => /nobody/.test(r.slug)));
  });
  // the radar in lead mode
  const D = 864e5;
  const cfgS = { companies: [{ name: 'n8n', url: 'https://jobs.ashbyhq.com/n8n', dream: true }], filters: { titleExclude: ['engineer'] }, scoring: {} };
  const leads = [{ id: '11', title: 'Account Executive, Mid-Market', company: 'n8n', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/11/' },
    { id: '22', title: 'Partnerships Manager', company: 'Cool Co', location: 'Vienna', url: 'https://www.linkedin.com/jobs/view/22/' },
    { id: '33', title: 'Account Manager', company: 'Hidden GmbH', location: 'Remote EU', url: 'https://www.linkedin.com/jobs/view/33/' }];
  const cand = { files: { 'search_profile.md': 'p', 'resume_base.md': '# Sam\n' }, settings: cfgS, manualUrl: '', leads };
  const plan = [{ source: 'ashby', company: 'n8n', slug: 'n8n', dream: true, lead: true, _candidate: cand }, { source: 'ashby', company: 'Cool Co', slug: 'coolco', guess: 'cool', lead: true },
    { source: 'greenhouse', company: 'Hidden GmbH', slug: 'hidden', guess: 'hidden', lead: true }];
  const ashby = (id, title, days) => ({ id, title, location: 'Remote', isListed: true, isRemote: true, publishedAt: new Date(now - days * D).toISOString(), jobUrl: 'https://jobs.ashbyhq.com/x/' + id, applyUrl: 'a', descriptionPlain: 'Sell' });
  const fetched = [{ data: JSON.stringify({ jobs: [ashby('a1', 'Account Executive, Mid-Market', 20), ashby('a2', 'Engineer', 1)] }) }, { data: JSON.stringify({ jobs: [ashby('c1', 'Partnerships Manager', 1)] }) }, { error: { message: '404' } }];
  let st = { initialized: true, seen: {}, judgedBefore: now - 30 * D };
  let out = await runNode(RAD.normalize, { input: [], state: st, nodes: { '⚙️ Plan run': plan, '🌐 Fetch job sources': fetched, '🗃️ Already sent': [] } });
  t('💼 lead mode: found on the board → full posting (even if old); not found → title-only', () => {
    const jobs = out.map((x) => x.json.job);
    assert.equal(jobs.length, 3, JSON.stringify(jobs.map((j) => j.uid)));
    const n8n = jobs.find((j) => j.company === 'n8n'); assert.ok(n8n.viaLinkedIn && n8n.dream && n8n.uid === 'ashby:n8n:a1' && /via LinkedIn/.test(n8n.sourceLabel));
    assert.ok(jobs.find((j) => j.company === 'Cool Co').viaLinkedIn);
    const hid = jobs.find((j) => j.company === 'Hidden GmbH'); assert.ok(hid.light && hid.uid === 'linkedin:33' && /Only the title/.test(hid.description));
    assert.deepEqual(st.leadBoards[L.normName('Cool Co')].slug, 'coolco'); assert.ok(st.leadBoards.hidden.none);
    assert.ok(st.seen['linkedin:11'] && st.seen['linkedin:33']); assert.equal(st.initialized, true);
  });
  out = await runNode(RAD.normalize, { input: [], state: st, nodes: { '⚙️ Plan run': plan, '🌐 Fetch job sources': fetched, '🗃️ Already sent': [] } });
  t('💼 the same alert again → nothing new', () => assert.equal(out.length, 0));
  st = { initialized: true, seen: {}, judgedBefore: now - 30 * D };
  out = await runNode(RAD.normalize, { input: [], state: st, nodes: { '⚙️ Plan run': plan, '🌐 Fetch job sources': fetched,
    '🗃️ Already sent': [{ uid: 'ashby:n8n:a1', alt_key: 'n8n|account executive, mid-market', folder: '2026-11-20_n8n' }, { uid: 'linkedin:33', alt_key: 'x', source: 'linkedin', folder: '' }] } });
  t('💼 no second card for a job you already got one for (board card or title-only card)', () => assert.deepEqual(out.map((x) => x.json.job.company), ['Cool Co']));

  // gate → light tier (not tailored), dream light even when the title-only score is low
  const light = L.lightJob(leads[2]); const lightDream = Object.assign(L.lightJob({ id: '44', title: 'AE', company: 'n8n', location: '' }), { dream: true });
  const fitOf = (score) => ({ content: [{ type: 'text', text: JSON.stringify({ score, skills_fit: score, values_fit: 60, location_eligible: 'unclear', english_only: 'unclear', comp_meets_floor: 'unknown', why: ['Title matches'] }) }] });
  const g = await runNode(RAD.gate, { input: [fitOf(70), fitOf(30)], state: {},
    nodes: { '🧹 Normalize · dedupe · filter': [{ job: light }, { job: lightDream }], '⚙️ Plan run': [{ _candidate: Object.assign({}, cand, { settings: { scoring: {} } }) }] } });
  t('💼 gate: title-only jobs become title-only cards, never tailored', () => {
    assert.deepEqual(g.map((x) => x.json.tier), ['light', 'light']); assert.ok(!g.some((x) => x.json.tailorRequest)); assert.ok(g[0].json.jrId);
  });
  t('💼 title-only card: LinkedIn link, says nothing is tailored, Applied/Skip', () => {
    const c = L.lightCard({ job: light, fit: { score: 70, why: ['Title matches'] }, jrId: 'JR-ABC123' }, {});
    assert.ok(/from the title only/.test(c.text) && /nothing is tailored/.test(c.text));
    const kb = c.reply_markup.inline_keyboard.flat();
    assert.equal(kb[0].url, 'https://www.linkedin.com/jobs/view/33/'); assert.ok(kb.some((b) => b.callback_data === 'ap:JR-ABC123'));
  });
  const lp = await runNode(OTH.linkedin_parse, { input: [{ date: new Date().toUTCString(), subject: 'New jobs for account executive', textPlain: TXT, textHtml: HTML },
    { date: new Date(now - 10 * D).toUTCString(), subject: 'Old alert', textPlain: TXT }], state: {} });
  t('💼 alert workflow: fresh alerts → one batch of leads; old ones ignored', () => { assert.equal(lp.length, 1); assert.equal(lp[0].json.kind, 'leads'); assert.equal(lp[0].json.leads.length, 2); });
  const st2 = {};
  const bad = await runNode(OTH.linkedin_parse, { input: [{ date: new Date().toUTCString(), subject: 'Account Executive at Acme and 9 more jobs', textPlain: 'something new and unreadable', textHtml: '<p>nope</p>' }], state: st2 });
  const bad2 = await runNode(OTH.linkedin_parse, { input: [{ date: new Date().toUTCString(), subject: 'Account Executive at Acme and 9 more jobs', textPlain: 'x' }], state: st2 });
  t('💼 an alert it can\'t read → a heads-up the same day, once a day', () => { assert.ok(bad.some((x) => x.json.kind === 'tg_text' && /LinkedIn alert/.test(x.json.tg.text))); assert.equal(bad2.length, 0); });
}

// 💬 chat: staged edits, saved only after the user's own "yes"
{
  const os = require('os');
  const P = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-chat-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(P, 'src'), { recursive: true });
  fs.mkdirSync(path.join(P, 'candidate'));
  fs.writeFileSync(path.join(P, 'settings.json'), JSON.stringify({ companies: [{ name: 'n8n', dream: true }], scoring: { instantAt: 75 } }, null, 2));
  fs.writeFileSync(path.join(P, 'candidate/experience_inventory.md'), '<!-- EXPERIENCE INVENTORY -->\n# Acme\n- Sold things\n\n# Never claim\n- PostgreSQL\n');
  fs.writeFileSync(path.join(P, 'candidate/resume_base.md'), '# Sam Rivera\nAE\n');
  process.env.JOBRADAR_PROJECT = P; process.env.OUTPUT_DIR = path.join(P, 'output');
  delete require.cache[require.resolve(path.join(ROOT, 'renderer/chat.js'))];
  const C = require(path.join(ROOT, 'renderer/chat.js'));
  const script = (steps) => { let i = 0; return async () => steps[Math.min(i++, steps.length - 1)]; };
  const tu = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'tu' + Math.random(), name, input }] });
  const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
  const cfg = () => JSON.parse(fs.readFileSync(path.join(P, 'settings.json'), 'utf8'));

  const r1 = await C.handleChat('s1', 'watch Supabase as a dream company', { claude: script([tu('watch_company', { name: 'Supabase', dream: true }), say('Staged Supabase as a dream company. Save?')]) });
  t('💬 a change is staged and shown, not saved', () => { assert.ok(/Ready to save/.test(r1.output) && /watch Supabase ⭐/.test(r1.output), r1.output); assert.equal(cfg().companies.length, 1); });
  const r2 = await C.handleChat('s1', 'yes', {});
  t('💬 "yes" saves it (with a backup)', () => { assert.ok(/Saved: settings.json/.test(r2.output)); assert.ok(cfg().companies.some((c) => c.name === 'Supabase' && c.dream)); assert.ok(fs.existsSync(path.join(P, 'settings.json.bak'))); });

  const r3 = await C.handleChat('s2', 'only ping me above 70', { claude: script([tu('change_settings', { changes: [{ path: 'scoring.instantAt', value: 70 }], why: 'higher bar' }), tu('save_pending', {}), say('Saved!')]) });
  t('💬 the AI cannot save without the user\'s yes', () => { assert.equal(cfg().scoring.instantAt, 75); assert.ok(/Ready to save/.test(r3.output) && /scoring.instantAt: 75 → 70/.test(r3.output), r3.output); });
  const r4 = await C.handleChat('s2', 'no', {});
  t('💬 "no" drops staged changes', () => { assert.ok(/nothing was saved/.test(r4.output)); assert.equal(cfg().scoring.instantAt, 75); });

  let sys = '';
  await C.handleChat('s7', 'hi', { claude: async (b) => { sys = b.system; return say('hi'); } });
  t('💬 the chat prompt maps "ping me above X" to scoring.instantAt', () => assert.ok(/"only ping me above X"[^\n]*scoring\.instantAt = X/.test(sys), sys));
  await C.handleChat('s3', 'remember: I ran partner payouts every month', { claude: script([tu('add_fact', { text: 'Ran partner payouts every month' }), say('Got it — save to your fact sheet?')]) });
  await C.handleChat('s3', 'yes please', { claude: script([tu('save_pending', {}), say('Saved to your fact sheet.')]) });
  t('💬 facts go under "Added in chat", rules under "Never claim"', () => {
    const inv = fs.readFileSync(path.join(P, 'candidate/experience_inventory.md'), 'utf8');
    assert.ok(/# Added in chat\n- Ran partner payouts every month/.test(inv) && /# Never claim\n- PostgreSQL/.test(inv), inv);
  });

  const bad = await C.handleChat('s4', 'set nonsense', { claude: script([tu('change_settings', { changes: [{ path: '__proto__.x', value: 1 }], why: 'x' }), say('That did not work.')]) });
  t('💬 dangerous settings paths are refused', () => assert.ok(!/Ready to save/.test(bad.output)));

  fs.mkdirSync(path.join(P, 'output/.jobradar'), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(P, 'output/.jobradar/status.jsonl'), [
    { at: now, run: 1, part: 'normalize', stats: { fetched: 120, seen: 100, title: 15, toScore: 5 } },
    { at: now, run: 1, part: 'health', problems: [{ name: 'Hiring Cafe (hiringcafe_mcp)', problem: 'returned an error: HTTP 403' }] },
    { at: now, run: 1, part: 'gate', screened: 5, instant: [{ company: 'n8n', title: 'AE', score: 81 }], digest: [] },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  t('💬 status sums the recent runs', () => { const st = C.readStatus(24); assert.equal(st.totals.fetched, 120); assert.equal(st.totals.sent_now, 1); assert.ok(st.broken_sources['Hiring Cafe (hiringcafe_mcp)']); });
}

// 🔗 a pasted job link
{
  t('🔗 known job board link → that board\'s feed', () => {
    const r = L.manualRequests('https://jobs.ashbyhq.com/n8n/0f3c2b1a-aaaa-bbbb-cccc-1234567890ab', '')[0];
    assert.equal(r.source, 'ashby'); assert.equal(r.slug, 'n8n'); assert.ok(/api\.ashbyhq\.com/.test(r.url)); assert.ok(r.manualUrl);
  });
  t('🔗 unknown site → read the page', () => assert.equal(L.manualRequests('https://careers.example.com/jobs/123', '')[0].source, 'manual'));
  t('🔗 picks the one posting from the whole board', () => {
    const jobs = [{ uid: 'ashby:n8n:1111', url: 'https://jobs.ashbyhq.com/n8n/aaaa-1111' }, { uid: 'ashby:n8n:2222', url: 'https://jobs.ashbyhq.com/n8n/bbbb-2222' }];
    assert.equal(L.pickManual(jobs, 'https://jobs.ashbyhq.com/n8n/bbbb-2222/application?utm=x').uid, 'ashby:n8n:2222');
    assert.equal(L.pickManual(jobs, 'https://jobs.ashbyhq.com/n8n/cccc-3333'), null);
  });
  t('🔗 a plain job page becomes a job', () => {
    const html = '<html><head><title>Account Executive – Acme</title><meta property="og:site_name" content="Acme"></head><body><nav>menu</nav><h1>Account Executive</h1><p>Sell Acme to mid-market teams. Remote EU.</p><script>x()</script></body></html>';
    const j = L.normalize({ source: 'manual', url: 'https://acme.example/jobs/1', manualUrl: 'https://acme.example/jobs/1' }, html)[0];
    assert.equal(j.company, 'Acme'); assert.ok(/Account Executive/.test(j.title)); assert.ok(/mid-market/.test(j.description) && !/menu|x\(\)/.test(j.description));
  });
}
console.log(`\nunit OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
