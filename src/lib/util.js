// ---- util.js : small shared helpers (inlined into n8n Code nodes) ----

function decodeEntities(s) {
  if (!s) return '';
  let out = String(s);
  // Greenhouse double-escapes (&amp;lt;) so decode twice
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&');
  }
  return out;
}

function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(String(html))
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugify(s, max) {
  const out = String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out.slice(0, max || 60);
}

function toIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v; // seconds vs ms
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString();
  }
  let s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return toIso(Number(s));
  if (/^\d{4}-\d\d-\d\d \d/.test(s)) s = s.replace(' ', 'T');
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s += 'Z'; // no timezone → assume UTC
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

function hoursSince(iso, now) {
  if (!iso) return null;
  return ((now || Date.now()) - new Date(iso).getTime()) / 36e5;
}

function humanAge(iso, now) {
  const h = hoursSince(iso, now);
  if (h === null) return 'post time unknown';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min ago';
  if (h < 48) return Math.round(h) + ' h ago';
  return Math.round(h / 24) + ' days ago';
}

function stripHtmlComments(md) {
  return String(md || '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s+/, '');
}

function extractHtmlComments(md) {
  const out = [];
  String(md || '').replace(/<!--([\s\S]*?)-->/g, (_, c) => { out.push(c.trim()); return ''; });
  return out.join('\n\n');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + ' …[truncated]' : s;
}

function jobradarDir() {
  try { return (typeof $env !== 'undefined' && $env.JOBRADAR_DIR) || '/home/node/jobradar'; } catch (e) { return '/home/node/jobradar'; }
}

function envGet(k) {
  try { return (typeof $env !== 'undefined' && $env[k]) || undefined; } catch (e) { return undefined; }
}

function channelsEnabled() {
  return String(envGet('NOTIFY_CHANNELS') || 'telegram').toLowerCase().split(/[\s,]+/).filter(Boolean);
}

function shortHash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

function fillCoverLetter(base, slots) {
  let txt = stripHtmlComments(base);
  for (const k of Object.keys(slots)) txt = txt.split('{{' + k + '}}').join(String(slots[k] || '').trim());
  return txt.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function trackerRow(job, fit, extra) {
  const num = (v) => (v === null || v === undefined || isNaN(Number(v)) ? -1 : Number(v));
  return Object.assign({
    jr_id: 'JR-' + shortHash(job.uid), uid: job.uid, alt_key: job.altKey, company: job.company, title: job.title, location: String(job.location || '').slice(0, 200),
    source: job.source, url: job.url || '', apply_url: job.applyUrl || job.url || '', score: num(fit.score), skills_fit: num(fit.skills_fit), values_fit: num(fit.values_fit),
    values_note: String((fit.values_match || []).join(' · ') || fit.company_note || '').slice(0, 300),
    dream: !!job.dream, role_family: fit.role_family || '', salary: job.salary ? String(job.salary).slice(0, 120) : '',
    posted_at: job.postedAt || '', minutes_to_alert: job.postedAt ? Math.max(0, Math.round((Date.now() - new Date(job.postedAt)) / 60000)) : -1,
    applied_at: '', outcome: '', outcome_at: '',
  }, extra || {});
}

// Companies you'd relocate for: settings.companies[].relocateTo = ["United Kingdom", "Ireland"]. Does that cover a country?
function relocateCovers(relocateTo, country) {
  if (!Array.isArray(relocateTo) || !country) return false;
  const alias = { uk: 'united kingdom|uk|england|scotland|wales|britain|great britain', us: 'united states|usa|us|u\\.s\\.', ie: 'ireland|irish' };
  const norm = (s) => String(s).toLowerCase().trim();
  const group = (s) => { const n = norm(s); for (const g of Object.values(alias)) if (new RegExp('^(' + g + ')$').test(n)) return g; return n; };
  return relocateTo.some((r) => group(r) === group(country));
}

// Postings that only hire in one country, whatever the board's location label says.
// Returns { country, evidence } or null. Conservative: needs an explicit signal, not just a US city.
function countryLock(text, profileMd) {
  const t = String(text || '');
  // The candidate's own one-line "who I am" (first line under the first heading of the search profile).
  const who = (String(profileMd || '').replace(/<!--[\s\S]*?-->/g, '').match(/^#[^\n]*\n+([^\n#]+)/m) || [, ''])[1];
  const livesIn = { US: /\b(United States|USA|U\.S\.|US-based|based in the US)\b/i, UK: /\b(United Kingdom|UK|London|England|Scotland)\b/, Canada: /\bCanada\b/i };
  const rules = [
    ['US', /(geographic(al)? pay zones?|pay zones?)[\s\S]{0,400}?(United States|U\.S\.|US locations)/i],
    ['US', /all other U\.?S\.? (locations|cities|metro)/i],
    ['US', /(must|need to|required to) (be )?(legally )?(authori[sz]ed|eligible) to work in the (United States|U\.S\.?|US)\b/i],
    ['US', /(must|need to) (reside|live|be based) in the (United States|U\.S\.?|US)\b/i],
    ['US', /\b401\(?k\)?/i],
    ['UK', /(must have|require[sd]?) (the )?(full )?right to work in the (UK|United Kingdom)/i],
    ['Canada', /(must|need to) (reside|live|be based) in Canada/i],
  ];
  for (const [country, re] of rules) {
    const m = t.match(re);
    if (m && !(livesIn[country] && livesIn[country].test(who))) return { country, evidence: '"' + m[0].replace(/\s+/g, ' ').slice(0, 80) + '"' };
  }
  return null;
}

// Tell the helper service what this run did, so the chat can answer "why so quiet?". Never fails the run.
async function postStatus(helpers, part, data) {
  try {
    if (!helpers || !helpers.httpRequest) return;
    const base = envGet('RENDERER_URL') || 'http://renderer:3100';
    await helpers.httpRequest({ method: 'POST', url: base + '/status', json: true, body: Object.assign({ part }, data), timeout: 5000 });
  } catch (e) { /* status is best-effort */ }
}
