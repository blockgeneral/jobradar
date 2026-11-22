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
  for (const c of claimCheck(truth, tailoredResume + '\n' + (rules.coverSlotsText || ''))) issues.push('Upgraded claim: ' + c);
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

// Ownership claims: "worked the partner channel" must not become "built the partner channel".
// A strong verb in the output passes only if the source uses the same verb on (one of) the same words,
// and a hedged source claim ("helped lead") must stay hedged.
// Word lists live in a function: n8n loads these helpers after a node's own code, so top-level consts aren't ready in time.
function claimRules() {
  const stems = { built: 'build', build: 'build', builds: 'build', building: 'build', launched: 'launch', launch: 'launch', founded: 'found', created: 'create',
  established: 'establish', led: 'lead', leading: 'lead', owned: 'own', spearheaded: 'spearhead', pioneered: 'pioneer', architected: 'architect',
  headed: 'head', scaled: 'scale', grew: 'grow', designed: 'design', invented: 'invent', drove: 'drive',
  lead: 'lead', own: 'own', create: 'create', launches: 'launch', creates: 'create', leads: 'lead', owns: 'own', establish: 'establish', design: 'design', scale: 'scale', grow: 'grow' };
  const stop = new Set('the a an and or of to for with from in on at by our my their its his her this that these those into across up out new first'.split(' '));
  const subject = /^(i|we|ive|weve|have|has|had|and|also|then|personally|successfully|helped|help|helping|supported|assisted|co|jointly|contributed|part)$/;
  const intent = /^(to|would|will|id|wed|ill|like|want|wants|love|plan|hope|can|could|should|might|may)$/;
  return { stems, stop, subject, intent };
}
function claimPairs(text) {
  const { stems: CLAIM_STEMS, stop: CLAIM_STOP, subject: CLAIM_SUBJECT, intent: CLAIM_INTENT } = claimRules();
  const pairs = [];
  // a verb only owns the words in its own clause: "worked the partner channel: built outreach lists, ran partner discussions"
  for (const clause of stripHtmlComments(String(text || '')).toLowerCase().split(/[,;:.!?()\n\u2013\u2014|•]+|\s-\s|\band\s+(?=[a-z]+ed\b)/)) {
    const words = clause.replace(/[^a-z0-9'\- ]+/g, ' ').split(/\s+/).filter((w) => /[a-z0-9]/.test(w));
    for (let i = 0; i < words.length; i++) {
      const stem = CLAIM_STEMS[words[i]];
      if (!stem) continue;
      // only claims about the candidate: a bullet/clause that starts with the verb, or "I/we (have) <verb>", "and <verb>".
      // Skips intentions ("I'd like to grow"), descriptions of others ("a product built for…") and modals.
      const prev = (words[i - 1] || '').replace(/'/g, '');
      if (i > 0 && !CLAIM_SUBJECT.test(prev)) continue;
      if (words.slice(0, i).some((w) => CLAIM_INTENT.test(w.replace(/'/g, '')))) continue; // intentions: "I'd like to own ... and grow them"
      const hedged = /^(helped|help|helping|supported|assisted|co|jointly|contributed|part)$/.test(words[i - 1] || '') || /^(helped|help|part|contributed)$/.test(words[i - 2] || '');
      const objs = [];
      for (let j = i + 1; j < words.length && objs.length < 3; j++) { if (CLAIM_STEMS[words[j]]) break; if (!CLAIM_STOP.has(words[j]) && words[j].length > 2) objs.push(words[j]); }
      pairs.push({ stem, verb: words[i], objs, hedged, phrase: words.slice(Math.max(0, i - (hedged ? 1 : 0)), i + 5).join(' ') });
    }
  }
  return pairs;
}
function claimCheck(sourceText, outputText) {
  const src = claimPairs(sourceText);
  const issues = [];
  const seen = new Set();
  for (const o of claimPairs(outputText)) {
    if (!o.objs.length) continue;
    const match = src.filter((sp) => sp.stem === o.stem && sp.objs.some((w) => o.objs.includes(w)));
    let problem = null;
    if (!match.length) problem = `"${o.phrase}…" — not backed by your CV (it never says you ${o.verb} this)`;
    else if (!o.hedged && match.every((sp) => sp.hedged)) problem = `"${o.phrase}…" — your CV says you helped with this, not that you did it alone`;
    if (problem && !seen.has(o.phrase)) { seen.add(o.phrase); issues.push(problem); }
  }
  return issues;
}

// What tailoring changed in the resume, line by line: reworded (before → after), moved, added, removed.
// Lines are compared without markdown styling; the order check uses the longest common subsequence.
function resumeDiff(baseMd, tailoredMd) {
  const clean = (md) => stripHtmlComments(String(md || '')).split('\n').map((l) => l.trim()).filter((l) => l && !/^-{3,}$/.test(l));
  const norm = (l) => l.replace(/^[-*•]\s+/, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const words = (l) => new Set(norm(l).match(/[a-z0-9$€%.+]+/g) || []);
  const sim = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.max(A.size, B.size)); };
  const base = clean(baseMd), tail = clean(tailoredMd);
  const sectionOf = (lines) => { let sec = ''; return lines.map((l) => { if (/^#\s/.test(l)) sec = ''; else if (/^#{2,3}\s/.test(l)) sec = l.replace(/^#+\s*/, ''); return sec; }); }; // '' = name/headline area
  const bSec = sectionOf(base), tSec = sectionOf(tail);
  const bN = base.map(norm), tN = tail.map(norm);
  // LCS over identical lines → anything identical but outside it was moved
  const m = bN.length, n = tN.length, dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = bN[i] === tN[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const inLcsB = new Set(), inLcsT = new Set();
  for (let i = 0, j = 0; i < m && j < n;) { if (bN[i] === tN[j]) { inLcsB.add(i); inLcsT.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const items = [];
  const usedB = new Set(inLcsB);
  // moved: identical text, different position
  for (let j = 0; j < n; j++) {
    if (inLcsT.has(j)) continue;
    const i = bN.findIndex((x, k) => x === tN[j] && !usedB.has(k));
    if (i >= 0) { usedB.add(i); inLcsT.add(j); if (!/^#/.test(tail[j])) items.push({ type: 'moved', section: tSec[j], after: tail[j] }); }
  }
  // reworded: a new line paired with the most similar leftover original; otherwise added
  for (let j = 0; j < n; j++) {
    if (inLcsT.has(j)) continue;
    let best = -1, score = 0;
    for (let i = 0; i < m; i++) if (!usedB.has(i)) { const sc = sim(base[i], tail[j]); if (sc > score) { score = sc; best = i; } }
    if (best >= 0 && score >= 0.35) { usedB.add(best); items.push({ type: 'reworded', section: tSec[j], before: base[best], after: tail[j] }); }
    else items.push({ type: 'added', section: tSec[j], after: tail[j] });
  }
  for (let i = 0; i < m; i++) if (!usedB.has(i)) items.push({ type: 'removed', section: bSec[i], before: base[i] });
  const count = (t) => items.filter((x) => x.type === t).length;
  const counts = { reworded: count('reworded'), added: count('added'), removed: count('removed'), moved: count('moved') };
  const changedLines = counts.reworded + counts.added + counts.removed;
  const isSummary = (x) => /summary|profile|about/i.test(x.section || '') || /^\*\*.*\*\*$/.test(x.after || x.before || '') || (!x.section);
  const sumChanged = items.some((x) => x.type !== 'moved' && isSummary(x));
  const parts = [];
  if (sumChanged) parts.push('summary/headline rewritten');
  const other = items.filter((x) => !isSummary(x));
  const rw = other.filter((x) => x.type === 'reworded').length, ad = other.filter((x) => x.type === 'added').length, rm = other.filter((x) => x.type === 'removed').length, mv = other.filter((x) => x.type === 'moved').length;
  if (rw) parts.push(`${rw} line${rw > 1 ? 's' : ''} reworded`);
  if (ad) parts.push(`${ad} added`);
  if (rm) parts.push(`${rm} removed`);
  if (mv) parts.push(`${mv} moved`);
  return { items, counts, unchanged: !changedLines && !counts.moved, pct: Math.round((100 * changedLines) / Math.max(1, m)), summary: parts.length ? parts.join(' · ') : 'unchanged' };
}

// "What changed" review document (markdown, rendered like the resume)
function changesDoc(diff, company, slots) {
  const L = [`# What changed — ${company}`, '', `Your base resume vs. the version tailored for ${company}: ${diff.summary}. Everything not listed here is word for word your base resume.`, ''];
  const by = (t) => diff.items.filter((x) => x.type === t);
  const strip = (l) => l.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '');
  const sentences = (t) => strip(t).split(/(?<=[.!?])\s+(?=[A-Z(])/).map((x) => x.trim()).filter(Boolean);
  if (by('reworded').length) {
    L.push('## Reworded');
    for (const x of by('reworded')) {
      if (x.before.length > 160 && x.after.length > 160) { // long paragraph: show only the sentences that differ
        const b = sentences(x.before), a = sentences(x.after);
        const gone = b.filter((y) => !a.includes(y)), fresh = a.filter((y) => !b.includes(y));
        L.push(`- **In "${strip(x.before).slice(0, 40)}…":**`);
        for (const g of gone) L.push(`  - **Was:** ${g}`);
        for (const f of fresh) L.push(`  - **Now:** ${f}`);
        L.push('');
      } else L.push(`- **Before:** ${strip(x.before)}`, `- **After:** ${strip(x.after)}`, '');
    }
  }
  if (by('added').length) { L.push('## Added'); for (const x of by('added')) L.push(`- ${x.after.replace(/^[-*•]\s+/, '')}`); L.push(''); }
  if (by('removed').length) { L.push('## Removed (still in your base resume)'); for (const x of by('removed')) L.push(`- ${x.before.replace(/^[-*•]\s+/, '')}`); L.push(''); }
  if (by('moved').length) {
    L.push('## Reordered (same words, new position)');
    for (const x of by('moved')) L.push(`- ${strip(x.after).replace(/\*\*/g, '').split(/\s+/).slice(0, 9).join(' ')}…`);
    L.push('');
  }
  if (slots && (slots.WHY_COMPANY || slots.LOCATION_LINE)) {
    L.push('## Cover letter — the only new text', 'Your letter is unchanged except for these slots:', '');
    if (slots.HIRING_TEAM) L.push(`- **Greeting:** Dear ${slots.HIRING_TEAM},`);
    if (slots.WHY_COMPANY) L.push(`- **Why this company:** ${slots.WHY_COMPANY}`);
    if (slots.LOCATION_LINE) L.push(`- **Location line:** ${slots.LOCATION_LINE}`);
  }
  return L.join('\n').trim() + '\n';
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
