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
