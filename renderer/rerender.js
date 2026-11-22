// Rebuild a job's files after you edited resume.md / cover_letter.md in output/<job>/.
//   ./jobradar rerender <job-folder>
const fs = require('fs');
const path = require('path');
const { render, save, safe } = require('./server');

(async () => {
  const OUT = process.env.OUTPUT_DIR || '/data/output';
  const folder = safe(path.basename(String(process.argv[2] || '').replace(/\/+$/, '')));
  const dir = path.join(OUT, folder);
  if (!process.argv[2] || !fs.existsSync(dir)) {
    console.error('usage: ./jobradar rerender <job-folder>\nRecent jobs:');
    if (fs.existsSync(OUT)) fs.readdirSync(OUT).filter((d) => !d.startsWith('.')).sort().slice(-10).forEach((d) => console.error('  ' + d));
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  const formats = meta.formats || ['docx'];
  for (const [kind, src, base] of [['resume', 'resume.md', meta.docs.resumeBase], ['letter', 'cover_letter.md', meta.docs.coverBase]]) {
    const md = fs.readFileSync(path.join(dir, src), 'utf8');
    for (const format of formats) {
      const buf = await render({ kind, format, markdown: md, title: `${base}` });
      console.log('✔', save(folder, `${base}.${format}`, buf));
    }
  }
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
