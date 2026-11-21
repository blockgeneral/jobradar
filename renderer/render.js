// JobRadar renderer — markdown → DOCX / HTML (→ PDF via Gotenberg).
// One parser feeds both outputs, so the Word file and the PDF always match.
const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, AlignmentType, BorderStyle, LevelFormat,
} = require('docx');

// ---------- markdown → blocks ----------
function stripComments(md) { return String(md || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, ''); }

function parseInline(text) {
  // returns [{text, bold, italic, link}]
  const runs = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*\s][^*]*?)\*)|(\[([^\]]+)\]\((https?:[^)\s]+)\))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1]) {
      // bold may contain italics: keep simple
      runs.push({ text: m[2], bold: true });
    } else if (m[3]) runs.push({ text: m[4], italic: true });
    else if (m[5]) runs.push({ text: m[6], link: m[7] });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text !== '');
}

function parseBlocks(md) {
  const blocks = [];
  let para = null, list = null;
  const flush = () => { if (para) { blocks.push({ type: 'p', lines: para }); para = null; } if (list) { blocks.push({ type: 'ul', items: list }); list = null; } };
  for (const raw of stripComments(md).split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); blocks.push({ type: 'h' + m[1].length, runs: parseInline(m[2]) }); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (para) { blocks.push({ type: 'p', lines: para }); para = null; } (list = list || []).push(parseInline(m[1])); continue; }
    if (list) { blocks.push({ type: 'ul', items: list }); list = null; }
    (para = para || []).push(parseInline(line.trim()));
  }
  flush();
  return blocks;
}

// ---------- HTML (for PDF) ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const runsHtml = (runs) => runs.map((r) => {
  let t = esc(r.text);
  if (r.link) return `<a href="${esc(r.link)}">${t}</a>`;
  if (r.bold) t = `<strong>${t}</strong>`;
  if (r.italic) t = `<em>${t}</em>`;
  return t;
}).join('');

const CSS = `
@page { size: A4; margin: 14mm 15mm; }
body { font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; color: #1a1a1a; font-size: 10.2pt; line-height: 1.38; margin: 0; }
a { color: inherit; text-decoration: none; }
h1 { font-size: 21pt; margin: 0 0 2px; letter-spacing: -0.2px; }
h1 + p { margin-top: 0; color: #333; }
h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 1.1px; color: #1f3a5f; border-bottom: 1px solid #c9d3df; padding-bottom: 2px; margin: 13px 0 6px; }
h3 { font-size: 10.6pt; margin: 9px 0 0; }
h3 + p { margin: 0 0 3px; color: #555; }
p { margin: 4px 0; }
ul { margin: 2px 0 6px; padding-left: 15px; } li { margin: 1.5px 0; }
.letter p { margin: 0 0 9px; font-size: 10.6pt; line-height: 1.5; }`;

function toHtml(md, kind, title) {
  const body = parseBlocks(md).map((b) => {
    if (b.type === 'p') return `<p>${b.lines.map(runsHtml).join('<br>')}</p>`;
    if (b.type === 'ul') return `<ul>${b.items.map((i) => `<li>${runsHtml(i)}</li>`).join('')}</ul>`;
    const lvl = b.type.slice(1);
    return `<h${lvl}>${runsHtml(b.runs)}</h${lvl}>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title || '')}</title><style>${CSS}</style></head><body${kind === 'letter' ? ' class="letter"' : ''}>${kind === 'letter' ? '<div class="letter">' + body + '</div>' : body}</body></html>`;
}

// ---------- DOCX ----------
const FONT = 'Calibri';
const NAVY = '1F3A5F';
function docxRuns(runs, base) {
  return runs.map((r) => {
    const opts = Object.assign({ text: r.text, bold: r.bold || (base && base.bold), italics: r.italic || (base && base.italics), font: FONT }, base && base.size ? { size: base.size } : {}, base && base.color ? { color: base.color } : {});
    if (r.link) return new ExternalHyperlink({ link: r.link, children: [new TextRun(Object.assign({}, opts, { text: r.text }))] });
    return new TextRun(opts);
  });
}
function linesToRuns(lines, base) {
  const out = [];
  lines.forEach((l, i) => { if (i) out.push(new TextRun({ break: 1 })); out.push(...docxRuns(l, base)); });
  return out;
}

async function toDocx(md, kind, title) {
  const letter = kind === 'letter';
  const body = letter ? 22 : 20; // half-points
  const children = [];
  const blocks = parseBlocks(md);
  blocks.forEach((b, idx) => {
    const prev = blocks[idx - 1];
    if (b.type === 'h1') children.push(new Paragraph({ spacing: { after: 40 }, children: docxRuns(b.runs, { bold: true, size: 40 }) }));
    else if (b.type === 'h2') children.push(new Paragraph({ spacing: { before: 220, after: 80 }, border: { bottom: { color: 'C9D3DF', style: BorderStyle.SINGLE, size: 6, space: 2 } },
      children: docxRuns(b.runs.map((r) => Object.assign({}, r, { text: r.text.toUpperCase() })), { bold: true, size: 21, color: NAVY }) }));
    else if (b.type === 'h3' || b.type === 'h4') children.push(new Paragraph({ spacing: { before: 140, after: 0 }, keepNext: true, children: docxRuns(b.runs, { bold: true, size: 21 }) }));
    else if (b.type === 'ul') b.items.forEach((it) => children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 30 }, children: docxRuns(it, { size: body }) })));
    else if (b.type === 'p') {
      const afterH = prev && /^h[34]$/.test(prev.type);
      children.push(new Paragraph({ spacing: { after: letter ? 180 : (afterH ? 40 : 80), line: letter ? 300 : 264 },
        children: linesToRuns(b.lines, { size: body, color: afterH ? '555555' : undefined }) }));
    }
  });
  const doc = new Document({
    title: title || '',
    creator: 'JobRadar',
    styles: { default: { document: { run: { font: FONT, size: body } } } },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 794, bottom: 794, left: 850, right: 850 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { parseBlocks, toHtml, toDocx, stripComments };
