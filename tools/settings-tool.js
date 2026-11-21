// Small helper for ./jobradar (runs inside the n8n container, which has Node).
//   node settings-tool.js add-companies <url> [<url>…]   < settings.json  > settings.json.new
//   node settings-tool.js list-companies                  < settings.json
const fs = require('fs'); const path = require('path');
const lib = ['util', 'sources'].map((n) => fs.readFileSync(path.join(__dirname, '../src/lib', n + '.js'), 'utf8')).join('\n');
const { detectAts, companiesFromSettings, watchList, normName } = new Function(lib + '; return { detectAts, companiesFromSettings, watchList, normName };')();
const [cmd, ...args] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(0, 'utf8'));
if (cmd === 'add-companies') {
  settings.companies = settings.companies || [];
  const have = new Set(companiesFromSettings(settings).companies.map((c) => c.ats + ':' + c.slug.toLowerCase()));
  for (const raw of args) {
    const url = raw.trim(); if (!url) continue;
    const dream = /\*$/.test(url);
    const clean = url.replace(/\*$/, '').trim();
    const d = detectAts(clean);
    if (!d && !/[/.]/.test(clean)) { // a plain company name → watch it by name on every job board
      if (watchList(settings)[normName(clean)]) { process.stderr.write(`  · ${clean} already watched\n`); continue; }
      settings.companies.push(dream ? { name: clean, dream: true } : { name: clean });
      process.stderr.write(`  ✔ ${clean} (watched by name on all job boards)${dream ? ' ⭐' : ''}\n`); continue;
    }
    if (!d) { process.stderr.write(`  ✖ ${url} — not a supported job board (Ashby, Greenhouse, Lever, Workable, Recruitee, Personio, SmartRecruiters, Pinpoint). Type just the company name instead to watch it on all job boards.\n`); continue; }
    if (have.has(d.ats + ':' + d.slug.toLowerCase())) { process.stderr.write(`  · ${d.slug} already watched\n`); continue; }
    settings.companies.push(dream ? { url: clean, dream: true } : clean);
    have.add(d.ats + ':' + d.slug.toLowerCase());
    process.stderr.write(`  ✔ ${d.slug} (${d.ats})${dream ? ' ⭐' : ''}\n`);
  }
  process.stdout.write(JSON.stringify(settings, null, 2) + '\n');
} else if (cmd === 'list-companies') {
  const { companies, invalid } = companiesFromSettings(settings);
  for (const c of companies) console.log(`  ${c.dream ? '⭐' : '·'} ${c.name} (${c.ats}/${c.slug})`);
  for (const e of settings.companies || []) if (e && !e.url && e.name && e.enabled !== false) console.log(`  ${e.dream ? '⭐' : '·'} ${e.name} (by name, all job boards)`);
  for (const u of invalid) console.log(`  ✖ ${u} (not recognised)`);
} else { console.error('unknown command'); process.exit(1); }
