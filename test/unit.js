// Unit tests: source adapters, filters, guardrails, notifications, and the Code-node logic the e2e run can't reach
// (email commands, reply detection, digests). Run: node test/unit.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const libSrc = ['util', 'sources', 'prompts', 'guard', 'notify'].map((n) => fs.readFileSync(path.join(ROOT, 'src/lib', n + '.js'), 'utf8')).join('\n');
const L = new Function('$env', libSrc + '; return { normalize, watchList, normName, preFilter, checkTailoring, keywordCoverage, toIso, detectAts, companiesFromSettings, buildRequests, parseBody, telegramCard, emailForJob, computeReport, telegramReport, inQuietHours, shortHash, fillCoverLetter, countryLock, claimCheck, contactLinks };')({ NOTIFY_CHANNELS: 'telegram,email' });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✔ ' + name); };
const now = Date.now();

// Code-node harness: runs a //@node block from src/wf with fake n8n globals
function nodeBlocks(file) { const o = {}; for (const c of fs.readFileSync(path.join(ROOT, 'src/wf', file), 'utf8').split(/^\/\/@node\s+/m).slice(1)) o[c.split('\n')[0].trim()] = c.split('\n').slice(1).join('\n'); return o; }
const OTH = nodeBlocks('others.js');
const RAD = nodeBlocks('radar.js');
async function runNode(code, { input = [], nodes = {}, env = {}, state = {} }) {
  const fn = new Function('$input', '$', '$env', '$getWorkflowStaticData', `return (async function(){\n${code}\n${libSrc}\n}).call(this)`);
  const $ = (name) => { if (!(name in nodes)) throw new Error('node not executed: ' + name); const items = nodes[name].map((j) => ({ json: j })); return { all: () => items, first: () => items[0] }; };
  return fn.call({ helpers: {} }, { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) }, $, env, () => state);
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
console.log(`\nunit OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
