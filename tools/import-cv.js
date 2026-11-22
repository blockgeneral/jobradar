// Turns an existing CV (PDF, LinkedIn "Save to PDF", .md or .txt) into JobRadar's candidate files + an honest review.
// Runs inside the n8n container (Node + your .env). Used by ./jobradar setup and ./jobradar import-cv.
//   node import-cv.js <cv file> "<target roles>" "<where you can work>" "<minimum pay>" [--write <project dir>]
// Without --write: prints one JSON object { review_md, files, settings }.
// With --write: saves candidate/*.md (existing files are kept as *.bak), merges title filters into settings.json, prints the review.
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const wi = argv.indexOf('--write');
const writeDir = wi >= 0 ? argv.splice(wi, 2)[1] : null;
const ci = argv.indexOf('--cover');
const coverFile = ci >= 0 ? argv.splice(ci, 2)[1] : null;
const [file, targets = '', location = '', pay = '', values = ''] = argv;
const env = process.env;
if (!file || !fs.existsSync(file)) { console.error('CV file not found: ' + file); process.exit(2); }
const ext = path.extname(file).toLowerCase();
if (!['.pdf', '.md', '.txt'].includes(ext)) { console.error('Please export your CV as PDF (Word: File → Save as PDF; LinkedIn: your profile → More → Save to PDF).'); process.exit(2); }
const coverExt = coverFile ? path.extname(coverFile).toLowerCase() : null;
if (coverFile && (!fs.existsSync(coverFile) || !['.pdf', '.md', '.txt'].includes(coverExt))) { console.error('Cover letter must be a PDF, .md or .txt file (Word: File → Save as PDF): ' + coverFile); process.exit(2); }

// Shared request/response helpers (same code the n8n workflows use).
const P = new Function(['util', 'guard', 'prompts'].map((n) => fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', n + '.js'), 'utf8')).join('\n') + '; return { structuredRequest, toolInput, claimCheck, numberTokens, stripHtmlComments };')({});

const TOOL = {
  name: 'candidate_files',
  description: 'Review of the CV plus JobRadar starting files built strictly from it.',
  input_schema: {
    type: 'object',
    properties: {
      review_md: { type: 'string', description: 'A short, direct review in markdown (max ~350 words) written to the candidate: 1) what already works, 2) the 5 most important fixes, each with why it matters and a concrete rewrite or instruction, 3) ATS risks (columns, tables, graphics, headers/footers, unusual headings, missing dates), 4) positioning for the target roles: what a recruiter will conclude in 10 seconds and what it should conclude instead, 5) the 5 questions whose answers would most improve the CV (these go to the interview). Honest, no flattery, no generic advice.' },
      experience_inventory_md: { type: 'string', description: 'Every fact in the CV, grouped by role newest first, as bullets with context and numbers exactly as written in the CV. Start with the comment line "<!-- EXPERIENCE INVENTORY — imported from CV; the interview adds more. Only facts the candidate wrote or confirmed. -->". End with a section "# Positioning by role type" containing, for each target role type (2–4), "## <role type>" then "- Lead with: …", "- Best proof: …", "- Play down: …" — built only from CV facts. Then "# Never claim" with "- (fill in during the interview)".' },
      resume_md: { type: 'string', description: 'An improved resume built ONLY from CV facts, in exactly this markdown structure: an HTML comment with tailoring rules; "# Full Name"; a headline line; a contact line (location | phone | email | linkedin/portfolio, exactly as in the CV, omit what is missing); "## Summary" (3–4 concrete sentences) followed by one bold line of 3–5 proof points; "## Experience" with "### Title | Company", an italic "*Location, Mon YYYY – Mon YYYY*" line and verb-first bullets (results over duties); then any other sections the CV has (e.g. "## Education and Languages"). Never invent numbers, tools, titles, dates or claims; when a bullet lacks a result, keep it factual rather than inventing one.' },
      cover_letter_md: { type: 'string', description: coverFile
        ? 'The candidate\'s OWN cover letter (the second document), kept word for word. Change nothing except: the salutation becomes "Dear {{HIRING_TEAM}},"; the sentence(s) about one specific company become a paragraph "{{WHY_COMPANY}}" (add that paragraph before the closing if there is none); the sentence about location/availability becomes "{{LOCATION_LINE}}" (add it if missing). Start with an HTML comment explaining the slots, and end with an HTML comment listing 2 LOCATION_LINE options in double quotes written in the letter\'s own voice (remote role / office role). Do not fix, improve, shorten or reorder anything else.'
        : 'A DRAFT base cover letter for the candidate to replace with their own words: plain first-person voice, built on 2–3 concrete stories from the CV (anecdotes over numbers), with exactly three slots: {{HIRING_TEAM}} in the salutation, {{WHY_COMPANY}} as its own paragraph, {{LOCATION_LINE}} as its own paragraph. Start with an HTML comment that says it is a draft written from the CV and explains the slots; end with an HTML comment listing 2 LOCATION_LINE options in double quotes (remote role / office role).' },
      cv_text: { type: 'string', description: 'The full text of the CV, transcribed word for word (used to check the other fields against it). No commentary.' },
      search_profile_md: { type: 'string', description: 'A search profile under 300 words with sections "# Who I am", "# Hard requirements (a \\"no\\" on any of these = reject)" (Location, Language, Pay), "# Roles I want (best first)", "# Seniority", "# What I value in a company (most important first; mark deal-breakers)", "# Red flags". Use the target roles / location / pay / values the candidate gave; where something is unknown write "TODO: …" so they fill it in.' },
      title_include: { type: 'array', items: { type: 'string' }, description: '6–14 lowercase regex fragments matching job titles the candidate should see.' },
      title_exclude: { type: 'array', items: { type: 'string' }, description: '6–14 lowercase regex fragments for titles to drop (too junior/senior, wrong function).' },
      board_queries: { type: 'array', items: { type: 'string' }, description: '2–4 short job-search phrases for their target roles.' },
      wwr_category: { type: 'string', enum: ['remote-sales-and-marketing-jobs', 'remote-back-end-programming-jobs', 'remote-front-end-programming-jobs', 'remote-full-stack-programming-jobs', 'remote-devops-sysadmin-jobs', 'remote-design-jobs', 'remote-product-jobs', 'remote-customer-support-jobs', 'remote-management-and-finance-jobs', 'all-other-remote-jobs'], description: 'We Work Remotely category that best fits the target roles.' },
      remotive_category: { type: 'string', enum: ['sales-business', 'software-dev', 'customer-support', 'design', 'marketing', 'product', 'project-management', 'data', 'devops', 'finance', 'hr', 'qa', 'writing', 'all-others'], description: 'Remotive category that best fits.' },
      remoteok_tag: { type: 'string', description: 'One RemoteOK tag, lowercase, e.g. sales, backend, design, marketing, customer support.' },
      language_exclude: { type: 'array', items: { type: 'string' }, description: 'Lowercase phrases meaning a language the candidate does NOT speak is required, e.g. "fluent (in )?german". Empty if unknown.' },
    },
    required: ['cv_text', 'review_md', 'experience_inventory_md', 'resume_md', 'cover_letter_md', 'search_profile_md', 'title_include', 'title_exclude', 'board_queries', 'wwr_category', 'remotive_category', 'remoteok_tag'],
  },
};

(async () => {
  const content = [];
  if (ext === '.pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(file).toString('base64') } });
  else content.push({ type: 'text', text: '<cv>\n' + fs.readFileSync(file, 'utf8') + '\n</cv>' });
  let coverText = null;
  if (coverFile) {
    if (coverExt === '.pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(coverFile).toString('base64') } });
    else { coverText = fs.readFileSync(coverFile, 'utf8'); content.push({ type: 'text', text: '<my_cover_letter>\n' + coverText + '\n</my_cover_letter>' }); }
  }
  content.push({ type: 'text', text: `This is my current CV. I'm setting up JobRadar.\nTarget roles: ${targets || '(not given — infer from the CV and mark as TODO)'}\nWhere I can work: ${location || '(not given — TODO)'}\nMinimum pay: ${pay || '(not given — TODO)'}\nWhat I value in a company: ${values || '(not given — TODO)'}\n\n${coverFile ? 'The second document is the cover letter I already use: keep it word for word apart from the three slots.\n' : ''}Review it honestly and build my starting files. Use only facts from the CV, and keep my own verbs: if the CV says I worked on, helped with, supported or was part of something, never upgrade that to built, led, launched, founded or owned.` });
  const r = await fetch((env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(P.structuredRequest(TOOL, {
      model: env.TAILORING_MODEL || 'claude-sonnet-5-5', max_tokens: 32000,
      system: 'You are a senior tech recruiter and resume writer. You are direct and specific. You never invent facts: every number, title, date, tool and claim must come from the CV, and you never make a claim bigger than the CV makes it (helped lead stays helped lead; worked the channel never becomes built the channel).',
      messages: [{ role: 'user', content }],
    })),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`Claude error ${r.status}: ${JSON.stringify(body.error || body).slice(0, 300)}`); process.exit(1); }
  const o = P.toolInput(body);
  if (!o) { console.error(`Claude returned no files (stop_reason: ${body.stop_reason || 'unknown'}).`); process.exit(1); }
  // Check the AI's work against the CV itself: new numbers and upgraded claims are flagged, never silently kept.
  const cvText = ext === '.pdf' ? (o.cv_text || '') : fs.readFileSync(file, 'utf8');
  const truth = cvText + '\n' + (coverText || '');
  const flags = [];
  const truthNums = P.numberTokens(truth), truthLow = truth.toLowerCase();
  const outputs = { 'resume_base.md': o.resume_md, 'experience_inventory.md': o.experience_inventory_md, 'cover_letter_base.md': o.cover_letter_md };
  if (cvText.trim().length > 80) {
    for (const [name, text] of Object.entries(outputs)) {
      for (const c of P.claimCheck(truth, text)) flags.push(`${name}: ${c}`);
      for (const [n, shown] of P.numberTokens(text)) if (!truthNums.has(n) && !truthLow.includes(n.replace(/[$€£,+]/g, ''))) flags.push(`${name}: number "${shown}" isn't in your CV`);
    }
  }
  if (coverText) { // their own letter should come back nearly untouched
    const words = (t) => P.stripHtmlComments(t).replace(/\{\{[A-Z_]+\}\}/g, ' ').toLowerCase().match(/[a-z']+/g) || [];
    const mine = new Set(words(coverText)); const back = words(o.cover_letter_md);
    const kept = back.filter((w) => mine.has(w)).length / Math.max(1, back.length);
    if (kept < 0.9) flags.push(`cover_letter_base.md: about ${Math.round((1 - kept) * 100)}% of the words aren't yours — compare it with your original before using it`);
  }
  const uniq = [...new Set(flags)].slice(0, 12);
  if (uniq.length) o.review_md = o.review_md.trim() + '\n\n**⚠️ Check these lines — they go beyond what your CV says:**\n' + uniq.map((f) => '- ' + f).join('\n') + '\n(Fix them in candidate/, or tell the interview the real story.)';
  const result = {
    flags: uniq,
    review_md: o.review_md,
    files: {
      'experience_inventory.md': o.experience_inventory_md.trim() + '\n',
      'resume_base.md': o.resume_md.trim() + '\n',
      'cover_letter_base.md': o.cover_letter_md.trim() + '\n',
      'search_profile.md': o.search_profile_md.trim() + '\n',
      'cv_review.md': '# CV review\n\n' + o.review_md.trim() + '\n',
    },
    settings: { titleInclude: o.title_include, titleExclude: o.title_exclude, boardQueries: o.board_queries, languageExclude: o.language_exclude || [],
      boards: { weworkremotely: o.wwr_category, remotive: o.remotive_category, remoteok: o.remoteok_tag } },
  };
  if (!writeDir) return process.stdout.write(JSON.stringify(result));
  const cdir = path.join(writeDir, 'candidate');
  fs.mkdirSync(cdir, { recursive: true });
  for (const [name, text] of Object.entries(result.files)) {
    const p = path.join(cdir, name);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') !== text && name !== 'cv_review.md') fs.copyFileSync(p, p + '.bak');
    fs.writeFileSync(p, text);
  }
  const sp = path.join(writeDir, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(fs.existsSync(sp) ? sp : path.join(writeDir, 'settings.example.json'), 'utf8'));
  settings.filters = Object.assign({}, settings.filters, { titleInclude: result.settings.titleInclude, titleExclude: result.settings.titleExclude });
  if (result.settings.languageExclude.length) settings.filters.languageExclude = result.settings.languageExclude;
  settings.boards = Object.assign({}, settings.boards);
  for (const [k, v] of Object.entries(result.settings.boards)) if (settings.boards[k] !== false && v) settings.boards[k] = v;
  settings.boardQueries = result.settings.boardQueries;
  if (settings.hiringCafe) settings.hiringCafe.queries = result.settings.boardQueries.slice(0, 3);
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
  process.stdout.write(result.review_md.trim() + '\n');
})().catch((e) => { console.error(e.message); process.exit(1); });
