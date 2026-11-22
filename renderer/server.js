// JobRadar renderer service. Internal only (not exposed outside the Docker network except on localhost).
//   POST /render  {folder, fileBase, kind: resume|letter, format: docx|pdf, markdown, title} → file bytes (+ saved to output/<folder>/)
//   POST /save    {folder, files: {name: text}}                                             → {saved: [...]}
//   POST /chat    {sessionId, message}                                                      → {output}  (the n8n chat page)
//   POST /status  {run, part, ...}                                                           → radar run stats for the chat
//   GET  /health
const http = require('http');
const fs = require('fs');
const path = require('path');
const { toHtml, toDocx } = require('./render');
const chat = require('./chat');

const PORT = Number(process.env.PORT || 3100);
const OUT = process.env.OUTPUT_DIR || '/data/output';
const GOTENBERG = process.env.GOTENBERG_URL || 'http://gotenberg:3000';
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 120) || 'untitled';

async function htmlToPdf(html) {
  const fd = new FormData();
  fd.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  fd.append('preferCssPageSize', 'true');
  fd.append('printBackground', 'true');
  const r = await fetch(`${GOTENBERG}/forms/chromium/convert/html`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Gotenberg ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function render({ kind, format, markdown, title }) {
  if (format === 'docx') return toDocx(markdown, kind, title);
  if (format === 'pdf') return htmlToPdf(toHtml(markdown, kind, title));
  throw new Error('format must be docx or pdf');
}

function save(folder, name, data) {
  const dir = path.join(OUT, safe(folder));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, safe(name));
  fs.writeFileSync(p, data);
  return p;
}

function body(req) { return new Promise((res, rej) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c).toString('utf8'))); req.on('error', rej); }); }

const server = http.createServer(async (req, res) => {
  const fail = (code, msg) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: msg })); };
  try {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    if (req.method !== 'POST') return fail(404, 'not found');
    const j = JSON.parse(await body(req) || '{}');
    if (req.url === '/render') {
      const buf = await render(j);
      const fileName = `${safe(j.fileBase || 'document')}.${j.format}`;
      if (j.folder) save(j.folder, fileName, buf);
      res.writeHead(200, { 'content-type': MIME[j.format], 'content-disposition': `attachment; filename="${fileName}"`, 'content-length': buf.length });
      return res.end(buf);
    }
    if (req.url === '/chat') {
      const r = await chat.handleChat(j.sessionId, j.message || j.chatInput);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    if (req.url === '/status') {
      const dir = path.join(OUT, '.jobradar');
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'status.jsonl');
      fs.appendFileSync(p, JSON.stringify(Object.assign({ at: new Date().toISOString() }, j)) + '\n');
      const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
      if (lines.length > 3000) fs.writeFileSync(p, lines.slice(-2000).join('\n') + '\n'); // ~2 weeks of runs
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.url === '/save') {
      const saved = Object.entries(j.files || {}).map(([n, t]) => save(j.folder, n, typeof t === 'string' ? t : JSON.stringify(t, null, 2)));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ saved }));
    }
    fail(404, 'not found');
  } catch (e) { fail(500, e.message); }
});

if (require.main === module) server.listen(PORT, () => console.log(`renderer on :${PORT}, output → ${OUT}`));
module.exports = { render, save, safe, MIME };
