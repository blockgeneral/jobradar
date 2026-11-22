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
