// Unit tests: source adapters, filters, guardrails, notifications, and the Code-node logic the e2e run can't reach
// (email commands, reply detection, digests). Run: node test/unit.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const libSrc = ['util', 'sources', 'prompts', 'guard', 'notify'].map((n) => fs.readFileSync(path.join(ROOT, 'src/lib', n + '.js'), 'utf8')).join('\n');
const L = new Function('$env', libSrc + '; return { normalize, preFilter, checkTailoring, keywordCoverage, toIso, detectAts, companiesFromSettings, buildRequests, parseBody, telegramCard, emailForJob, computeReport, telegramReport, inQuietHours, shortHash, fillCoverLetter };')({ NOTIFY_CHANNELS: 'telegram,email' });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✔ ' + name); };
const now = Date.now();

// Code-node harness: runs a //@node block from src/wf with fake n8n globals
function nodeBlocks(file) { const o = {}; for (const c of fs.readFileSync(path.join(ROOT, 'src/wf', file), 'utf8').split(/^\/\/@node\s+/m).slice(1)) o[c.split('\n')[0].trim()] = c.split('\n').slice(1).join('\n'); return o; }
const OTH = nodeBlocks('others.js');
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
    assert.equal(issues.length, 2);
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
  const verdicts = await runNode(OTH.replies_apply, { input: [{ content: [{ type: 'tool_use', input: { jr_id: 'JR-AAAAAA', outcome: 'intro', summary: 'n8n wants a call' } }] }], nodes: { '🔍 Plausible replies': pre.map((x) => x.json) } });
  t('reply verdict → tracker row + heads-up', () => { assert.equal(verdicts[0].json.row.outcome, 'intro'); assert.ok(verdicts[0].json.note.includes('📞')); });
  const dig = await runNode(OTH.reports_build, { env: { NOTIFY_CHANNELS: 'email', NOTIFY_EMAIL_TO: 'me+jobradar@x.com' },
    input: [{ jr_id: 'JR-1', status: 'digest_pending', score: 80, company: 'A', title: 'AE', apply_url: 'https://a' }, { jr_id: 'JR-2', status: 'notified', score: 90 }],
    nodes: { "⏰ What's due": [{ due: 'digest', reports: {} }] } });
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
  t('jr ids are stable and short', () => { assert.equal(L.shortHash('ashby:n8n:1'), L.shortHash('ashby:n8n:1')); assert.equal(L.shortHash('x').length, 6); });
  console.log(`\nunit OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
