// ---- sources.js : where jobs come from + normalisation to one schema ----
// Every fetch item: { source, company, slug, dream, url, method, body }
// Every normalised job: { uid, altKey, source, company, title, location, remote,
//   workplaceType, postedAt, url, applyUrl, salary, description, dream, sourceLabel }

function atsUrls() { return {
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`,
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  lever_eu: (s) => `https://api.eu.lever.co/v0/postings/${s}?mode=json`,
  workable: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
  recruitee: (s) => `https://${s}.recruitee.com/api/offers/`,
  personio: (s) => `https://${s}.jobs.personio.de/xml?language=en`,
  smartrecruiters: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
  pinpoint: (s) => `https://${s}.pinpointhq.com/postings.json`,
}; }

// "https://jobs.ashbyhq.com/n8n" → { ats: 'ashby', slug: 'n8n' }. Paste career-page links; no need to know what an ATS is.
function detectAts(url) {
  const u = String(url || '').trim();
  const pats = [
    [/jobs\.ashbyhq\.com\/([^/?#]+)/i, 'ashby'],
    [/(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i, 'greenhouse'],
    [/jobs\.eu\.lever\.co\/([^/?#]+)/i, 'lever_eu'],
    [/jobs\.lever\.co\/([^/?#]+)/i, 'lever'],
    [/apply\.workable\.com\/([^/?#]+)/i, 'workable'],
    [/([a-z0-9-]+)\.recruitee\.com/i, 'recruitee'],
    [/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i, 'personio'],
    [/(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/i, 'smartrecruiters'],
    [/([a-z0-9-]+)\.pinpointhq\.com/i, 'pinpoint'],
  ];
  for (const [re, ats] of pats) { const m = u.match(re); if (m && m[1] && !/^(embed|jobs|api)$/i.test(m[1])) return { ats, slug: m[1] }; }
  return null;
}

function normName(s) { return String(s || '').toLowerCase().replace(/\b(inc|ltd|llc|gmbh|corp|co|technologies|hq)\b/g, '').replace(/[^a-z0-9]+/g, ''); }

// every company you name: polled directly when its job board is supported, and recognised by name on every other source
function watchList(settings, extra) {
  const map = {};
  for (const entry of settings.companies || []) {
    const e = typeof entry === 'string' ? { url: entry } : entry;
    if (e.enabled === false) continue;
    const det = e.url ? detectAts(e.url) : null;
    const name = e.name || (det && det.slug);
    if (name) map[normName(name)] = { name, dream: !!e.dream };
    for (const alias of e.aliases || []) map[normName(alias)] = { name, dream: !!e.dream };
  }
  for (const w of extra || []) if (w && w.name) map[normName(w.name)] = map[normName(w.name)] || { name: w.name, dream: w.dream !== false };
  return map;
}

function companiesFromSettings(settings) {
  const out = [], invalid = [];
  for (const entry of settings.companies || []) {
    const e = typeof entry === 'string' ? { url: entry } : Object.assign({}, entry);
    if (e.enabled === false) continue;
    if (!e.url && !e.ats && e.name) continue; // watch-by-name only
    const det = e.ats && e.slug ? { ats: e.ats, slug: e.slug } : detectAts(e.url);
    if (!det) { invalid.push(e.url || JSON.stringify(e)); continue; }
    const name = e.name || (/\d/.test(det.slug) || det.slug.length <= 3 ? det.slug : det.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
    out.push({ name, ats: det.ats, slug: det.slug, dream: !!e.dream });
  }
  return { companies: out, invalid };
}

function buildRequests(settings, env, now, mockBase) {
  const reqs = [];
  const { companies } = companiesFromSettings(settings);
  for (const c of companies) {
    reqs.push({ source: c.ats, company: c.name, slug: c.slug, dream: c.dream, url: atsUrls()[c.ats](c.slug), method: 'GET' });
  }
  const b = settings.boards || {};
  const queries = settings.boardQueries || ['account executive'];
  // board categories: true = sales defaults, or give the board's own category/tag (see README)
  const cat = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  if (b.weworkremotely !== false)
    reqs.push({ source: 'weworkremotely', url: `https://weworkremotely.com/categories/${cat(b.weworkremotely, 'remote-sales-and-marketing-jobs')}.rss`, method: 'GET' });
  if (b.remotive !== false)
    reqs.push({ source: 'remotive', url: `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(cat(b.remotive, 'sales-business'))}&limit=150`, method: 'GET' });
  if (b.remoteok !== false)
    reqs.push({ source: 'remoteok', url: `https://remoteok.com/api?tag=${encodeURIComponent(cat(b.remoteok, 'sales'))}`, method: 'GET' });
  if (b.jobicy !== false)
    reqs.push({ source: 'jobicy', url: 'https://jobicy.com/api/v2/remote-jobs?count=100', method: 'GET' });
  if (b.himalayas !== false)
    for (const q of queries)
      reqs.push({ source: 'himalayas', slug: q, url: `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent`, method: 'GET' });

  // Hiring Cafe — no official API. Two options: the community MCP server (free, unofficial) or an Apify task (paid).
  const hc = settings.hiringCafe || {};
  const every = Math.max(15, hc.everyMinutes || 60);
  const minuteOfDay = Math.floor(((now || Date.now()) / 60000) % 1440);
  if (hc.enabled && minuteOfDay % every < 15) {
    if ((hc.via || 'mcp') === 'mcp') {
      (hc.queries || queries).forEach((q, i) => reqs.push({
        source: 'hiringcafe_mcp', slug: q, method: 'POST', url: hc.mcpUrl || 'https://hiringcafe-mcp.vercel.app/api/mcp',
        body: { jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'search_jobs', arguments: Object.assign({ query: q }, hc.location ? { location: hc.location } : {}) } },
      }));
    } else if (hc.via === 'apify' && env.APIFY_TOKEN && hc.apifyTaskId) {
      reqs.push({ source: 'hiringcafe', method: 'GET',
        url: `https://api.apify.com/v2/actor-tasks/${hc.apifyTaskId}/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}&timeout=240&format=json&clean=true` });
    }
  }
  if (mockBase) for (const r of reqs) r.url = mockBase + '/src/' + r.source + '/' + encodeURIComponent(r.slug || r.source);
  return reqs;
}

function parseBody(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s); } catch (e) { return null; } }
  if (/^(event|data):/m.test(s) && /^data:\s*\{/m.test(s)) { // MCP streamable-HTTP answered as server-sent events
    const datas = s.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    for (const d of datas.reverse()) { try { return JSON.parse(d); } catch (e) {} }
  }
  return s; // XML / text
}

function rssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  const tag = (block, t) => {
    const mm = block.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>'));
    if (!mm) return '';
    return mm[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
  };
  while ((m = re.exec(xml))) {
    const b = m[1];
    items.push({ title: tag(b, 'title'), region: tag(b, 'region'), country: tag(b, 'country'), type: tag(b, 'type'),
      description: tag(b, 'description'), pubDate: tag(b, 'pubDate'), guid: tag(b, 'guid'), link: tag(b, 'link') });
  }
  return items;
}

function mk(job) {
  const company = (job.company || '').trim();
  const title = (job.title || '').trim();
  return Object.assign({
    location: '', remote: null, workplaceType: null, postedAt: null, url: '', applyUrl: '',
    salary: null, description: '', dream: false,
  }, job, {
    company, title,
    altKey: (company + '|' + title).toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim(),
    description: truncate(job.description || '', 12000),
  });
}

function normalize(req, raw) {
  const data = parseBody(raw);
  const out = [];
  const s = req.source;
  if (s === 'ashby' && data && data.jobs) {
    for (const j of data.jobs) {
      if (j.isListed === false) continue;
      const comp = j.compensation || {};
      out.push(mk({ uid: `ashby:${req.slug}:${j.id}`, source: s, sourceLabel: 'Ashby (direct)', company: req.company, dream: req.dream,
        title: j.title, location: [j.location].concat((j.secondaryLocations || []).map((x) => x.location)).filter(Boolean).join(' / '),
        remote: j.isRemote === true ? true : null, workplaceType: j.workplaceType || null, postedAt: toIso(j.publishedAt),
        url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl, salary: comp.compensationTierSummary || comp.scrapeableCompensationSalarySummary || null,
        description: j.descriptionPlain || htmlToText(j.descriptionHtml) }));
    }
  } else if (s === 'greenhouse' && data && data.jobs) {
    for (const j of data.jobs) {
      out.push(mk({ uid: `greenhouse:${req.slug}:${j.id}`, source: s, sourceLabel: 'Greenhouse (direct)', company: req.company || j.company_name, dream: req.dream,
        title: j.title, location: (j.location && j.location.name) || '', postedAt: toIso(j.first_published || j.updated_at),
        url: j.absolute_url, applyUrl: j.absolute_url, description: htmlToText(j.content) }));
    }
  } else if ((s === 'lever' || s === 'lever_eu') && Array.isArray(data)) {
    for (const j of data) {
      const cat = j.categories || {};
      out.push(mk({ uid: `lever:${req.slug}:${j.id}`, source: s, sourceLabel: 'Lever (direct)', company: req.company, dream: req.dream,
        title: j.text, location: (cat.allLocations || [cat.location]).filter(Boolean).join(' / '),
        remote: j.workplaceType === 'remote' ? true : null, workplaceType: j.workplaceType || null, postedAt: toIso(j.createdAt),
        url: j.hostedUrl, applyUrl: j.applyUrl || j.hostedUrl,
        salary: j.salaryRange ? `${j.salaryRange.currency || ''} ${j.salaryRange.min}-${j.salaryRange.max} ${j.salaryRange.interval || ''}`.trim() : null,
        description: [j.descriptionPlain, (j.lists || []).map((l) => l.text + '\n' + htmlToText(l.content)).join('\n'), j.additionalPlain].filter(Boolean).join('\n\n') }));
    }
  } else if (s === 'workable' && data && data.jobs) {
    for (const j of data.jobs) {
      const loc = (j.locations && j.locations[0]) || {};
      out.push(mk({ uid: `workable:${req.slug}:${j.shortcode || j.code || j.id}`, source: s, sourceLabel: 'Workable (direct)', company: req.company || data.name, dream: req.dream,
        title: j.title, location: [j.city || loc.city, j.country || loc.country].filter(Boolean).join(', '),
        remote: j.telecommuting === true ? true : null, postedAt: toIso(j.published_on || j.created_at),
        url: j.url || j.shortlink, applyUrl: j.application_url || j.url, description: htmlToText(j.description) }));
    }
  } else if (s === 'weworkremotely' && typeof data === 'string') {
    for (const it of rssItems(data)) {
      const idx = it.title.indexOf(':');
      out.push(mk({ uid: `wwr:${it.guid || it.link}`, source: s, sourceLabel: 'We Work Remotely',
        company: idx > 0 ? it.title.slice(0, idx) : '', title: idx > 0 ? it.title.slice(idx + 1) : it.title,
        location: [it.region, it.country].filter(Boolean).join(' · '), remote: true, postedAt: toIso(it.pubDate),
        url: it.link, applyUrl: it.link, description: htmlToText(it.description) }));
    }
  } else if (s === 'remotive' && data && data.jobs) {
    for (const j of data.jobs) {
      out.push(mk({ uid: `remotive:${j.id}`, source: s, sourceLabel: 'Remotive', company: j.company_name, title: j.title,
        location: j.candidate_required_location || '', remote: true, postedAt: toIso(j.publication_date),
        url: j.url, applyUrl: j.url, salary: j.salary || null, description: htmlToText(j.description) }));
    }
  } else if (s === 'remoteok' && Array.isArray(data)) {
    for (const j of data) {
      if (!j || !j.id || !j.position) continue; // first element is a legal notice
      out.push(mk({ uid: `remoteok:${j.id}`, source: s, sourceLabel: 'RemoteOK', company: j.company, title: j.position,
        location: j.location || '', remote: true, postedAt: toIso(j.epoch || j.date),
        url: j.url, applyUrl: j.apply_url || j.url,
        salary: j.salary_min ? `USD ${j.salary_min}-${j.salary_max}` : null, description: htmlToText(j.description) }));
    }
  } else if (s === 'jobicy' && data && data.jobs) {
    for (const j of data.jobs) {
      out.push(mk({ uid: `jobicy:${j.id}`, source: s, sourceLabel: 'Jobicy', company: j.companyName, title: decodeEntities(j.jobTitle),
        location: j.jobGeo || '', remote: true, postedAt: toIso(j.pubDate), url: j.url, applyUrl: j.url,
        salary: j.annualSalaryMin ? `${j.salaryCurrency || ''} ${j.annualSalaryMin}-${j.annualSalaryMax}`.trim() : null,
        description: htmlToText(j.jobDescription || j.jobExcerpt) }));
    }
  } else if (s === 'himalayas' && data && data.jobs) {
    for (const j of data.jobs) {
      out.push(mk({ uid: `himalayas:${j.guid || j.applicationLink}`, source: s, sourceLabel: 'Himalayas', company: j.companyName, title: j.title,
        location: (j.locationRestrictions || []).join(', ') || 'Worldwide', remote: true, postedAt: toIso(j.pubDate),
        url: j.guid || j.applicationLink, applyUrl: j.applicationLink,
        salary: j.minSalary ? `${j.currency || ''} ${j.minSalary}-${j.maxSalary} ${j.salaryPeriod || ''}`.trim() : null,
        description: htmlToText(j.description || j.excerpt) }));
    }
  } else if (s === 'recruitee' && data && data.offers) {
    for (const j of data.offers) {
      out.push(mk({ uid: `recruitee:${req.slug}:${j.id}`, source: s, sourceLabel: 'Recruitee (direct)', company: req.company || j.company_name, dream: req.dream,
        title: j.title, location: [j.location, j.country].filter(Boolean).join(', '), remote: j.remote === true ? true : null,
        postedAt: toIso(j.published_at || j.created_at), url: j.careers_url, applyUrl: j.careers_apply_url || j.careers_url,
        description: htmlToText([j.description, j.requirements].filter(Boolean).join('\n')) }));
    }
  } else if (s === 'personio' && typeof data === 'string') {
    const re = /<position>([\s\S]*?)<\/position>/g; let m;
    const tg = (b, t) => { const x = b.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return x ? x[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : ''; };
    while ((m = re.exec(data))) {
      const b = m[1]; const id = tg(b, 'id');
      out.push(mk({ uid: `personio:${req.slug}:${id}`, source: s, sourceLabel: 'Personio (direct)', company: req.company || tg(b, 'subcompany'), dream: req.dream,
        title: tg(b, 'name'), location: tg(b, 'office'), postedAt: toIso(tg(b, 'createdAt')),
        url: `https://${req.slug}.jobs.personio.de/job/${id}`, applyUrl: `https://${req.slug}.jobs.personio.de/job/${id}#apply`,
        description: htmlToText((b.match(/<value>([\s\S]*?)<\/value>/g) || []).join('\n')) }));
    }
  } else if (s === 'smartrecruiters' && data && data.content) {
    for (const j of data.content) {
      const loc = j.location || {};
      out.push(mk({ uid: `smartrecruiters:${req.slug}:${j.id}`, source: s, sourceLabel: 'SmartRecruiters (direct)', company: req.company || (j.company && j.company.name), dream: req.dream,
        title: j.name, location: [loc.city, loc.country].filter(Boolean).join(', '), remote: loc.remote === true ? true : null,
        postedAt: toIso(j.releasedDate), url: `https://jobs.smartrecruiters.com/${req.slug}/${j.id}`, applyUrl: `https://jobs.smartrecruiters.com/${req.slug}/${j.id}`,
        description: [j.function && j.function.label, j.experienceLevel && j.experienceLevel.label].filter(Boolean).join(' · ') }));
    }
  } else if (s === 'pinpoint' && data && Array.isArray(data.data)) {
    for (const j of data.data) {
      const loc = j.location || {};
      const pay = j.compensation_visible && j.compensation_minimum ? `${j.compensation_currency || ''} ${j.compensation_minimum}-${j.compensation_maximum} ${j.compensation_frequency || ''}`.trim() : null;
      out.push(mk({ uid: `pinpoint:${req.slug}:${j.id}`, source: s, sourceLabel: 'Pinpoint (direct)', company: req.company, dream: req.dream,
        title: j.title, location: [loc.city, loc.name].filter(Boolean).join(', '), remote: j.workplace_type === 'remote' ? true : null, workplaceType: j.workplace_type_text || j.workplace_type || null,
        postedAt: null, url: j.url, applyUrl: j.url, salary: pay,
        description: htmlToText([j.description, j.key_responsibilities, j.skills_knowledge_expertise, j.benefits].filter(Boolean).join('\n')) }));
    }
  } else if (s === 'hiringcafe_mcp' && data && (data.result || data.error)) {
    // tolerant: structuredContent, or JSON inside a text content block
    const r = data.result || {};
    let list = r.structuredContent && (r.structuredContent.jobs || r.structuredContent.results || r.structuredContent);
    if (!Array.isArray(list)) {
      for (const c of r.content || []) { if (c.type === 'text') { try { const p = JSON.parse(c.text); list = Array.isArray(p) ? p : (p.jobs || p.results); if (Array.isArray(list)) break; } catch (e) {} } }
    }
    for (const j of Array.isArray(list) ? list : []) {
      const url = j.url || j.applyUrl || j.apply_url || j.link;
      if (!url) continue;
      out.push(mk({ uid: `hiringcafe:${j.id || url}`, source: 'hiringcafe', sourceLabel: 'Hiring Cafe', company: j.company || j.companyName || j.company_name || '',
        title: j.title || j.jobTitle || '', location: j.location || [].concat(j.locations || []).join(', '), remote: /remote/i.test(String(j.workplaceType || j.location || '')) ? true : null,
        postedAt: toIso(j.postedAt || j.posted_at || j.datePosted || j.date_posted || null), url, applyUrl: j.applyUrl || j.apply_url || url,
        salary: j.salary || j.compensation || null, description: htmlToText(j.description || j.snippet || j.summary || '') }));
    }
  } else if (s === 'hiringcafe' && Array.isArray(data)) {
    for (const j of data) {
      if (j.isExpired) continue;
      const loc = [].concat(j.workplaceCities || [], j.workplaceStates || [], j.workplaceCountries || []).join(', ');
      out.push(mk({ uid: `hiringcafe:${j.id || j.objectID || j.applyUrl}`, source: s, sourceLabel: 'Hiring Cafe', company: j.companyName, title: j.title,
        location: loc, remote: j.workplaceType === 'Remote' ? true : null, workplaceType: j.workplaceType || null,
        postedAt: null, firstSeenAt: toIso(j.scrapedAt), url: j.applyUrl, applyUrl: j.applyUrl,
        salary: j.salaryMin ? `${j.salaryCurrency || ''} ${j.salaryMin}-${j.salaryMax} ${j.salaryFrequency || ''}`.trim() : null,
        description: htmlToText(j.description) }));
    }
  }
  return out;
}

// ---- cheap rule-based filter (before spending any tokens) ----
function compileRe(list) {
  if (!list || !list.length) return null;
  return new RegExp(list.join('|'), 'i');
}

function preFilter(job, targets, now) {
  const f = targets.filters || {};
  // dream companies: every role that isn't excluded gets screened (the AI judges fit), unless you turn that off
  const inc = job.dream && f.dreamAnyTitle !== false ? null : compileRe([].concat(f.titleInclude || [], job.dream ? (f.titleIncludeDream || []) : []));
  const exc = compileRe(job.dream ? (f.titleExcludeDream || f.titleExclude) : f.titleExclude);
  const lang = compileRe(f.languageExclude);
  if (inc && !inc.test(job.title)) return 'title-not-relevant';
  if (exc && exc.test(job.title)) return 'title-excluded';
  if (lang && (lang.test(job.title) || lang.test(job.description.slice(0, 4000)))) return 'language-requirement';
  const locExc = compileRe(f.locationExclude);
  if (locExc && locExc.test(job.location) && !(f.locationAllow && compileRe(f.locationAllow).test(job.location))) return 'location-excluded';
  const fresh = f.freshHours || 72;
  const age = hoursSince(job.postedAt, now);
  if (age !== null && age > fresh) return 'too-old';
  return null;
}
