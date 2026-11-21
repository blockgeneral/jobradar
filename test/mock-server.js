// Mock for e2e tests: job sources, Anthropic, Telegram, Gotenberg (renders real PDFs with headless Chrome).
// node test/mock-server.js <port> <logdir>
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const port = Number(process.argv[2] || 5679);
const logDir = process.argv[3] || '/tmp/jobradar-mock';
fs.mkdirSync(logDir, { recursive: true });
const log = (name, obj) => fs.appendFileSync(path.join(logDir, name + '.jsonl'), JSON.stringify(obj) + '\n');
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const baseResume = fs.readFileSync(path.join(__dirname, '../examples/candidate/resume_base.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();

const AE_DESC = 'We are hiring a Mid-Market Account Executive to own the full-cycle sales process for EMEA customers. You will run discovery, demos, negotiate annual contracts and work with Solutions Engineers. Requirements: 3+ years closing SaaS deals, experience with technical buyers, MEDDPICC, Salesforce. Remote within EMEA; we hire through an EOR in countries without an entity. OTE €130k–€160k.';
const SRC = {
  ashby: {
    n8n: { jobs: [
      { id: 'n8n-ae-1', title: 'Account Executive, Mid-Market (EMEA)', location: 'Remote - EMEA', secondaryLocations: [{ location: 'Berlin' }], isListed: true, isRemote: true, workplaceType: 'Remote', publishedAt: minsAgo(22), jobUrl: 'https://jobs.ashbyhq.com/n8n/n8n-ae-1', applyUrl: 'https://jobs.ashbyhq.com/n8n/n8n-ae-1/application', descriptionPlain: 'n8n is the workflow automation platform for technical teams. ' + AE_DESC, compensation: { compensationTierSummary: '€130K – €160K OTE' } },
      { id: 'n8n-sec', title: 'Sr Security Engineer', location: 'Remote', isListed: true, isRemote: true, workplaceType: 'Remote', publishedAt: minsAgo(30), jobUrl: 'https://jobs.ashbyhq.com/n8n/x', applyUrl: 'https://jobs.ashbyhq.com/n8n/x', descriptionPlain: 'Security.' },
      { id: 'n8n-old', title: 'Account Executive, Enterprise', location: 'Remote', isListed: true, isRemote: true, workplaceType: 'Remote', publishedAt: minsAgo(60 * 24 * 12), jobUrl: 'https://jobs.ashbyhq.com/n8n/old', applyUrl: 'https://jobs.ashbyhq.com/n8n/old', descriptionPlain: 'old' },
      { id: 'n8n-de', title: 'Account Executive (German-speaking)', location: 'Berlin', isListed: true, isRemote: false, workplaceType: 'Hybrid', publishedAt: minsAgo(40), jobUrl: 'https://jobs.ashbyhq.com/n8n/de', applyUrl: 'https://jobs.ashbyhq.com/n8n/de', descriptionPlain: 'Fluent German required.' },
    ] },
    supabase: { jobs: [{ id: 'sb-be-1', title: 'Senior Backend Engineer (Go)', location: 'Remote - Europe', isListed: true, isRemote: true, workplaceType: 'Remote', publishedAt: minsAgo(35), jobUrl: 'https://jobs.ashbyhq.com/supabase/sb-be-1', applyUrl: 'https://jobs.ashbyhq.com/supabase/sb-be-1/application', descriptionPlain: 'Build the Postgres platform APIs in Go. Event-driven systems, on-call, remote in Europe, English. Salary EUR 90k-120k.', compensation: { compensationTierSummary: '€90K – €120K' } }] },
  },
  greenhouse: {
    anthropic: { jobs: [{ id: 4461450999, title: 'Account Executive, Startups (EMEA)', location: { name: 'London, UK | Remote-Friendly (EMEA)' }, absolute_url: 'https://job-boards.greenhouse.io/anthropic/jobs/4461450999', updated_at: minsAgo(5), first_published: minsAgo(45), company_name: 'Anthropic', content: '&lt;p&gt;Sell Claude to startups across EMEA. ' + AE_DESC.replace(/&/g, '&amp;amp;') + '&lt;/p&gt;' }] },
  },
  weworkremotely: `<?xml version="1.0"?><rss><channel>
<item><title>Celonis: Account Executive - DACH</title><region>Anywhere in the World</region><country>Germany</country><type>Full-Time</type><description>&lt;p&gt;Sell&lt;/p&gt;</description><pubDate>${new Date(Date.now() - 3600e3).toUTCString()}</pubDate><guid>https://weworkremotely.com/remote-jobs/celonis-ae</guid><link>https://weworkremotely.com/remote-jobs/celonis-ae</link></item>
<item><title>Acme Logistics: Account Manager</title><region>USA Only</region><country>US</country><type>Full-Time</type><description>&lt;p&gt;US only account manager role, must reside in the US.&lt;/p&gt;</description><pubDate>${new Date(Date.now() - 2 * 3600e3).toUTCString()}</pubDate><guid>https://weworkremotely.com/remote-jobs/acme-am</guid><link>https://weworkremotely.com/remote-jobs/acme-am</link></item>
</channel></rss>`,
  remotive: { 'job-count': 1, jobs: [{ id: 991, url: 'https://remotive.com/remote-jobs/sales/ae-991', title: 'Account Executive', company_name: 'DataFlowCo', category: 'Sales / Business', job_type: 'full_time', publication_date: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19), candidate_required_location: 'Europe', salary: '', description: '<p>Data integration SaaS, EU remote, English.</p>' }] },
  remoteok: [{ legal: 'notice' }, { id: '77', epoch: Math.floor(Date.now() / 1000) - 7200, company: 'DataFlowCo', position: 'Account Executive', location: 'Europe', url: 'https://remoteok.com/remote-jobs/77', apply_url: 'https://remoteok.com/l/77', description: 'dup of remotive (same company+title)' }],
  jobicy: { jobs: [] },
  himalayas: { jobs: [] },
};
const HC_MCP = (id) => 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ jobs: [
  { id: 'hc1', title: 'Partnerships Manager', company: 'CafeCo', location: 'Remote, Europe', url: 'https://hiring.cafe/job/hc1', postedAt: new Date(Date.now() - 50 * 60000).toISOString(), description: 'Partner channel role, EU remote, English.' }] }) }] } }) + '\n\n';
let TG_UPDATES = [];

function mockScore(user) {
  const t = (user.match(/Title: (.*)/) || [])[1] || '';
  const c = (user.match(/Company: (.*)/) || [])[1] || '';
  const good = /n8n|Anthropic|CafeCo|Supabase/.test(c);
  return {
    location_eligible: /Acme/.test(c) ? 'no' : 'yes', location_reason: /Acme/.test(c) ? 'US residents only' : 'Remote EMEA with EOR',
    english_only: 'yes', comp_meets_floor: good ? 'yes' : 'unknown', comp_note: '',
    role_family: 'new_business_ae', seniority_fit: 'fit', score: good ? 86 : (/DataFlow/.test(c) ? 74 : 40),
    why: /Backend/.test(t) ? ['Go + event-driven checkout rewrite maps directly to their platform APIs'] : ['Full-cycle mid-market AE in a technical product — matches their sales-led experience', 'Annual-contract negotiation & technical discovery are core to the role'],
    gaps: ['Asks for MEDDPICC — used in pieces, not formally trained'], red_flags: [],
    keywords: ['full-cycle', 'mid-market', 'discovery', 'annual contracts', 'MEDDPICC', 'Salesforce', 'technical buyers', 'EMEA'],
    hiring_contact: good ? '' : '', _title: t,
  };
}
function mockTailor(user) {
  const c = (user.match(/Company: (.*)/) || [])[1] || 'Company';
  const fromReq = (user.match(/<base_resume>\n([\s\S]*?)\n<\/base_resume>/) || [])[1];
  let resume = (fromReq ? fromReq.replace(/<!--[\s\S]*?-->/g, '').trim() : baseResume)
    ;
  if (/Anthropic/.test(c)) resume = resume.replace(/\b\d+%/, '95%'); // planted lie → guard must catch it
  return {
    resume_md: resume, hiring_team: `${c} Hiring Team`,
    why_company: `I've sold a data product to the same technical buyers ${c} serves, and the motion you describe — discovery-led, annual contracts, Solutions Engineers in the room — is the one I rebuilt at Coupler.io this year.`,
    location_line: "I'm set up to work remotely and comfortable across EMEA and US hours.", variant: 'new_business_ae',
    role_summary: `Mid-market new-business AE for ${c} in EMEA: full cycle from discovery to annual contract, paired with SEs.`,
    changes: ['Headline mirrors "Mid-Market Account Executive"', 'Summary leads with technical discovery'],
    verify: ['"MEDDPICC" is requested — your resume does not claim it; be ready to explain how you qualify'],
    intro_call_prep: ['Walk me through a deal you closed end to end → your largest multi-year contract'],
    team_search: `${c} head of sales EMEA`,
    outreach_note: `Hi — I just applied for the Mid-Market AE role at ${c}. I've closed technical SaaS deals this year and would love 15 minutes to hear how the team sells.`,
  };
}

function readBody(req) { return new Promise((res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => res(Buffer.concat(ch))); }); }
function parseMultipart(buf, ctype) {
  const boundary = '--' + (ctype.match(/boundary=([^;]+)/) || [])[1];
  const parts = [];
  let s = buf.toString('latin1').split(boundary).slice(1, -1);
  for (const p of s) {
    const idx = p.indexOf('\r\n\r\n');
    const head = p.slice(0, idx); const body = p.slice(idx + 4, p.length - 2);
    parts.push({ name: (head.match(/name="([^"]+)"/) || [])[1], filename: (head.match(/filename="([^"]+)"/) || [])[1], type: (head.match(/Content-Type: (.*)/i) || [])[1], body: Buffer.from(body, 'latin1') });
  }
  return parts;
}

http.createServer(async (req, res) => {
  const body = await readBody(req);
  const u = new URL(req.url, 'http://x');
  const send = (code, obj, headers) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, headers || {})); res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
  try {
    if (u.pathname.startsWith('/src/')) {
      const [, , source, slug] = u.pathname.split('/');
      const s = decodeURIComponent(slug);
      log('sources', { source, slug: s, method: req.method, bodyLen: body.length, ctype: req.headers['content-type'] || '', body: body.length ? body.toString().slice(0, 200) : '' });
      if (source === 'hiringcafe_mcp') { const j = JSON.parse(body.toString()); return send(200, HC_MCP(j.id), { 'content-type': 'text/event-stream' }); }
      const d = SRC[source];
      if (d === undefined) return send(404, { error: 'unknown source' });
      if (typeof d === 'string') return send(200, d, { 'content-type': 'application/rss+xml' });
      if (['ashby', 'greenhouse'].includes(source)) return d[s] ? send(200, d[s]) : send(404, { error: 'Not Found' });
      return send(200, d);
    }
    if (u.pathname === '/v1/messages') {
      const j = JSON.parse(body.toString());
      if (req.headers['x-api-key'] !== 'test-key') return send(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
      const tool = j.tools[0].name; const user = j.messages[0].content;
      log('anthropic', { tool, company: (user.match(/Company: (.*)/) || [])[1], model: j.model, chars: user.length, hasInventory: /<experience_inventory>/.test(user) });
      const input = tool === 'job_fit' ? mockScore(user) : tool === 'classify' ? { jr_id: (user.match(/(JR-[A-Z0-9]{6})/) || [])[1] || 'none', outcome: 'intro', summary: 'n8n invites you to a 30-minute intro call' } : mockTailor(user);
      return send(200, { id: 'msg_x', type: 'message', role: 'assistant', model: j.model, content: [{ type: 'tool_use', id: 'tu_1', name: tool, input }], stop_reason: 'tool_use' });
    }
    if (/\/bot[^/]+\/sendMessage$/.test(u.pathname)) {
      const j = JSON.parse(body.toString());
      log('telegram_messages', j);
      for (const row of (j.reply_markup && j.reply_markup.inline_keyboard) || []) for (const b of row) {
        if (b.callback_data && Buffer.byteLength(b.callback_data) > 64) return send(400, { ok: false, description: 'Bad Request: BUTTON_DATA_INVALID' });
        if (b.copy_text && b.copy_text.text.length > 256) return send(400, { ok: false, description: 'Bad Request: copy_text too long' });
        if (!b.url && !b.callback_data && !b.copy_text) return send(400, { ok: false, description: 'Bad Request: button without action' });
      }
      if (j.parse_mode === 'HTML') { // sanity: only Telegram-supported tags, balanced
        const bad = (j.text.match(/<\/?([a-z]+)[^>]*>/g) || []).filter((t) => !/^<\/?(b|i|u|s|a|code|pre)\b/.test(t));
        if (bad.length) return send(400, { ok: false, description: "Bad Request: can't parse entities " + bad.join(',') });
      }
      return send(200, { ok: true, result: { message_id: 1 } });
    }
    if (u.pathname === '/_ctl/updates') { TG_UPDATES = TG_UPDATES.concat(JSON.parse(body.toString())); return send(200, { ok: true }); }
    if (/\/bot[^/]+\/getUpdates$/.test(u.pathname)) {
      const off = Number(u.searchParams.get('offset') || 0);
      const res = TG_UPDATES.filter((x) => x.update_id >= off);
      log('telegram_getupdates', { offset: off, n: res.length });
      return send(200, { ok: true, result: res });
    }
    if (/\/bot[^/]+\/(answerCallbackQuery|editMessageReplyMarkup)$/.test(u.pathname)) {
      log('telegram_calls', { method: u.pathname.split('/').pop(), body: JSON.parse(body.toString()) });
      return send(200, { ok: true, result: true });
    }
    if (/\/bot[^/]+\/sendMediaGroup$/.test(u.pathname)) {
      const parts = parseMultipart(body, req.headers['content-type']);
      const media = JSON.parse((parts.find((p) => p.name === 'media') || { body: Buffer.from('[]') }).body.toString());
      const files = parts.filter((p) => p.filename).map((p) => ({ field: p.name, filename: p.filename, bytes: p.body.length, magic: p.body.slice(0, 2).toString() }));
      log('telegram_albums', { media, files, chat: (parts.find((p) => p.name === 'chat_id') || {}).body + '' });
      const missing = media.filter((m) => !files.some((f) => 'attach://' + f.field === m.media));
      if (missing.length) return send(400, { ok: false, description: 'Bad Request: wrong file identifier' });
      return send(200, { ok: true, result: [{ message_id: 3 }, { message_id: 4 }] });
    }
    if (/\/bot[^/]+\/sendDocument$/.test(u.pathname)) {
      const parts = parseMultipart(body, req.headers['content-type']);
      const doc = parts.find((p) => p.name === 'document');
      log('telegram_documents', { fields: parts.filter((p) => !p.filename).map((p) => [p.name, p.body.toString().slice(0, 80)]), filename: doc && doc.filename, type: doc && doc.type, bytes: doc && doc.body.length, isPdf: doc && doc.body.slice(0, 4).toString() === '%PDF' });
      return send(200, { ok: true, result: { message_id: 2 } });
    }
    if (u.pathname === '/forms/chromium/convert/html') {
      const parts = parseMultipart(body, req.headers['content-type']);
      const f = parts.find((p) => p.name === 'files');
      const name = req.headers['gotenberg-output-filename'] || 'result';
      log('gotenberg', { filename: f && f.filename, fields: parts.filter((p) => !p.filename).map((p) => p.name), out: name });
      if (!f || f.filename !== 'index.html') return send(400, { error: 'index.html required' });
      const dir = fs.mkdtempSync('/tmp/gb-');
      fs.writeFileSync(dir + '/index.html', f.body);
      execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${dir}/out.pdf`, `file://${dir}/index.html`], { stdio: 'ignore', timeout: 60000 });
      fs.copyFileSync(dir + '/index.html', path.join(logDir, name + '.html'));
      fs.copyFileSync(dir + '/out.pdf', path.join(logDir, name + '.pdf'));
      return send(200, fs.readFileSync(dir + '/out.pdf'), { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}.pdf"` });
    }
    send(404, { error: 'no route ' + u.pathname });
  } catch (e) { send(500, { error: String(e.stack) }); }
}).listen(port, () => console.log('mock on', port));
