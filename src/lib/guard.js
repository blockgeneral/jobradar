// ---- guard.js : deterministic checks on what the AI wrote ----
// The AI may only reorder / reword. These checks catch the usual failure modes:
// invented numbers, forbidden claims, dropped sections, changed contact details.

function numberTokens(text) {
  const t = stripHtmlComments(text);
  const re = /[$€£]?\d[\d,.]*\s?(?:%|[kKmM]\b|x\b|\+)?/g;
  const out = new Map(); // lowercased token -> as written
  let m;
  while ((m = re.exec(t))) {
    const tok = m[0].replace(/\s+/g, '').replace(/[.,]+$/, '');
    if (!tok || /^\d$/.test(tok)) continue; // single digits are noise
    out.set(tok.toLowerCase(), tok);
  }
  return out;
}

function checkTailoring(baseResume, tailoredResume, coverLetter, rules) {
  const issues = [];
  const truth = baseResume + '\n' + (rules.inventory || '');
  const baseNums = numberTokens(truth);
  const baseNorm = stripHtmlComments(truth).toLowerCase();
  for (const [n, shown] of numberTokens(tailoredResume)) {
    const bare = n.replace(/[$€£,+]/g, '');
    if (!baseNums.has(n) && !baseNorm.includes(bare)) issues.push(`New number "${shown}" isn't in your resume or inventory`);
  }
  // cover letter: base rule is "no numbers" — only the AI-written slots can introduce them
  for (const [, n] of numberTokens(rules.coverSlotsText || '')) issues.push(`Cover letter: AI added a number ("${n}")`);
  for (const r of rules.forbidden || []) {
    let re; try { re = new RegExp(r.pattern, 'i'); } catch (e) { continue; }
    if (re.test(tailoredResume) || re.test(coverLetter)) issues.push(r.message);
  }
  // sections and contact line must survive
  const heads = (stripHtmlComments(baseResume).match(/^##\s+.+$/gm) || []).map((h) => h.trim());
  for (const h of heads) if (!tailoredResume.includes(h)) issues.push(`Section missing: ${h.replace(/^##\s+/, '')}`);
  const contact = (stripHtmlComments(baseResume).match(/^.*@.*$/m) || [''])[0].trim();
  if (contact && !tailoredResume.includes(contact)) issues.push('Contact details changed — check them');
  if (/\{\{[A-Z_]+\}\}/.test(coverLetter)) issues.push('Cover letter has an unfilled {{slot}}');
  return issues;
}

function keywordCoverage(keywords, text) {
  const t = String(text || '').toLowerCase();
  const covered = [], missing = [];
  for (const k of keywords || []) {
    const kk = String(k).toLowerCase().trim();
    if (!kk) continue;
    // match any significant word stem of multi-word keywords
    const words = kk.split(/[\s/]+/).filter((w) => w.length > 2);
    const hit = t.includes(kk) || (words.length > 1 && words.every((w) => t.includes(w.slice(0, Math.max(4, w.length - 2)))));
    (hit ? covered : missing).push(k);
  }
  return { covered, missing, pct: (covered.length + missing.length) ? Math.round(100 * covered.length / (covered.length + missing.length)) : null };
}
