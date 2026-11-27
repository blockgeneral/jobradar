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
    const extra = Array.isArray(e.relocateTo) && e.relocateTo.length ? { relocateTo: e.relocateTo } : {};
    if (name) map[normName(name)] = Object.assign({ name, dream: !!e.dream }, extra);
    for (const alias of e.aliases || []) map[normName(alias)] = Object.assign({ name, dream: !!e.dream }, extra);
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
    out.push({ name, ats: det.ats, slug: det.slug, dream: !!e.dream, relocateTo: Array.isArray(e.relocateTo) ? e.relocateTo : null });
  }
  return { companies: out, invalid };
}

// How often (minutes) the slower boards are checked. Fast company boards and the classic remote feeds: every run.
function boardEvery(settings) {
  return Object.assign({ openabroad: 60, trulyremotework: 30, workable_search: 60, jobgether: 60, getro: 180 }, (settings && settings.boardEvery) || {});
}
// Where Workable's cross-company search looks: a country (on-site, hybrid and remote there) and/or a region, remote only.
function workableLocations(settings) {
  const w = settings && settings.workableSearch;
  const list = Array.isArray(w) ? w : [{ location: 'Europe', remoteOnly: true }];
  return list.map((x) => (typeof x === 'string' ? { location: x } : x)).filter((x) => x && x.location);
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

  // Boards that change less often are checked less often: one 15-minute run in every N minutes (boardEvery overrides).
  const minuteOfDay = Math.floor(((now || Date.now()) / 60000) % 1440);
  const due = (name) => { const e = Math.max(15, Number(boardEvery(settings)[name]) || 15); return minuteOfDay % e < 15; };
  // Open Abroad: remote roles that hire across borders, each tagged with who can apply (feed of one kind of work)
  if (b.openabroad !== false && due('openabroad'))
    reqs.push({ source: 'openabroad', url: `https://openabroad.org/work/${encodeURIComponent(cat(b.openabroad, 'sales'))}/feed.json`, method: 'GET' });
  // TrulyRemoteWork: curated worldwide-remote roles (their documented JSON Feed)
  if (b.trulyremotework !== false && due('trulyremotework'))
    reqs.push({ source: 'trulyremotework', url: `https://trulyremotework.com/feed.json?category=${encodeURIComponent(cat(b.trulyremotework, 'sales'))}`, method: 'GET' });
  // Workable's cross-company search (every Workable career page): full descriptions, one request per query × place
  if (b.workable_search !== false && due('workable_search'))
    for (const w of workableLocations(settings))
      for (const q of queries)
        reqs.push({ source: 'workable_search', slug: q + '@' + w.location + (w.remoteOnly ? '/remote' : ''),
          url: `https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(q)}&location=${encodeURIComponent(w.location)}${w.remoteOnly ? '&workplace=remote' : ''}`, method: 'GET' });

  // Hiring Cafe — no official API. Two options: the community MCP server (free, unofficial) or an Apify task (paid).
  const hc = settings.hiringCafe || {};
  const every = Math.max(15, hc.everyMinutes || 60);
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

// A single job link pasted in the chat: use the company's job-board feed when we know the board (the page itself
// is often built by JavaScript), otherwise read the page.
function manualRequests(url, mockBase) {
  const det = detectAts(url);
  const r = det && atsUrls()[det.ats]
    ? { source: det.ats, company: '', slug: det.slug, dream: false, url: atsUrls()[det.ats](det.slug), method: 'GET', manualUrl: url }
    : { source: 'manual', slug: url, url, method: 'GET', manualUrl: url };
  if (mockBase) r.url = mockBase + '/src/' + r.source + '/' + encodeURIComponent(r.slug || r.source);
  return [r];
}

// From a whole board, keep the one posting the link points at (matched on the posting id / path)
function pickManual(jobs, url) {
  const clean = (u) => String(u || '').toLowerCase().replace(/[?#].*$/, '').replace(/\/(apply|application)\/?$/, '').replace(/\/+$/, '');
  const target = clean(url);
  const id = (target.match(/([a-z0-9-]{6,})$/) || [])[1] || '';
  return jobs.find((j) => clean(j.url) === target || clean(j.applyUrl) === target)
    || (id ? jobs.find((j) => clean(j.url).endsWith(id) || clean(j.applyUrl).endsWith(id) || String(j.uid).endsWith(':' + id)) : null)
    || null;
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
  } else if (s === 'openabroad' && data && Array.isArray(data.items)) {
    // JSON Feed. First paragraph = "Company · Kind of work · Who can apply · Pay"; a quote of the employer's own
    // words on who can apply follows when they have one. The role page links to the employer's posting.
    for (const it of data.items) {
      const html = String(it.content_html || '');
      const head = htmlToText((html.match(/<p>([\s\S]*?)<\/p>/) || [, it.summary || ''])[1]).split(' · ').map((x) => x.trim());
      const company = (it.authors && it.authors[0] && it.authors[0].name) || head[0] || '';
      const title = String(it.title || '').replace(new RegExp('\\s*·\\s*' + company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim();
      const url = String(it.url || it.id || '').replace(/[?&]utm_source=feed$/, '');
      const body = htmlToText(html.replace(/<p><a [^>]*>Read the role[\s\S]*$/i, ''));
      out.push(mk({ uid: `openabroad:${it.id || url}`, source: s, sourceLabel: 'Open Abroad', company, title,
        location: head[2] || '', remote: true, postedAt: toIso(it.date_published), url, applyUrl: url, salary: head[3] || null,
        description: body + '\n\n(Open Abroad lists remote roles that hire across borders; "who can apply" above is its reading of the employer\'s posting.)' }));
    }
  } else if (s === 'trulyremotework' && data && Array.isArray(data.items)) {
    for (const it of data.items) {
      const t = it._trw || {};
      const company = (it.authors && it.authors[0] && it.authors[0].name) || '';
      const title = String(it.title || '').replace(new RegExp('\\s+at\\s+' + company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim();
      out.push(mk({ uid: `trulyremotework:${it.id || it.url}`, source: s, sourceLabel: 'TrulyRemoteWork', company, title,
        location: t.location || 'Worldwide', remote: true, postedAt: toIso(it.date_published), url: it.url, applyUrl: it.url,
        salary: t.salary || null, description: (it.content_text || it.summary || '') + '\n\n(TrulyRemoteWork lists roles it judges open worldwide; check the posting itself.)' }));
    }
  } else if (s === 'workable_search' && data && Array.isArray(data.jobs)) {
    for (const j of data.jobs) {
      if (j.state && j.state !== 'published') continue;
      const loc = j.location || {}; const co = j.company || {};
      out.push(mk({ uid: `workable_search:${j.id}`, source: s, sourceLabel: 'Workable job search', company: co.title || '', title: j.title,
        location: [loc.city, loc.subregion, loc.countryName].filter((x, i, a) => x && a.indexOf(x) === i).join(', '),
        remote: j.workplace === 'remote' ? true : null, workplaceType: j.workplace || null, postedAt: toIso(j.created),
        url: j.url, applyUrl: j.url, description: htmlToText([j.description, j.requirementsSection, j.benefitsSection].filter(Boolean).join('\n')) }));
    }
  } else if (s === 'getro_detail' && typeof data === 'string') {
    // a VC portfolio board's job page: the posting sits in the page's own __NEXT_DATA__ (Getro's API is off-limits by robots.txt)
    const m = data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    let j = null; try { j = JSON.parse(m[1]).props.pageProps.initialState.jobs.currentJob; } catch (e) { j = null; }
    if (j && j.id && j.title && (j.status || 'active') === 'active' && !j.closedAt && !j.deactivatedAt) {
      const org = j.organization || {};
      const locs = (j.locations || []).map((l) => (l && (l.name || l.description)) || l).filter(Boolean);
      const mode = String(j.workMode || '').toLowerCase();
      const cents = (v) => (typeof v === 'number' ? Math.round(v / 100) : null);
      const lo = cents(j.compensationAmountMinCents), hi = cents(j.compensationAmountMaxCents);
      const apply = (j.applicationMethod === 'url' && j.applicationPath) || j.url || req.url;
      out.push(mk({ uid: `getro:${j.id}`, source: 'getro', sourceLabel: 'VC portfolio board (' + String(req.url || '').replace(/^https?:\/\/([^/]+).*/, '$1') + ')',
        company: org.name || req.company, title: j.title, location: locs.join(' / '),
        remote: /remote/.test(mode) || locs.some((l) => /^\s*(remote|anywhere|worldwide)\b/i.test(l)) ? true : null, workplaceType: mode || null,
        postedAt: toIso(j.postedAt), url: req.url, applyUrl: apply,
        salary: lo || hi ? `${j.compensationCurrency || ''} ${[lo, hi].filter(Boolean).join('-')} ${j.compensationPeriod || ''}`.trim() : null,
        description: htmlToText(j.description || ''), detailFor: req.detailFor }));
    }
  } else if (s === 'manual' && typeof raw === 'string' && /<html|<body|<title/i.test(raw)) {
    const meta = (prop) => { const m = raw.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']+)', 'i')) || raw.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + prop, 'i')); return m ? htmlToText(m[1]).trim() : ''; };
    const title = meta('og:title') || htmlToText((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]).trim();
    const host = (String(req.manualUrl || req.url).match(/^https?:\/\/(?:www\.)?([^/]+)/i) || [, ''])[1];
    const body = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ');
    out.push(mk({ uid: 'manual:' + (req.manualUrl || req.url), source: 'manual', sourceLabel: 'Link you sent', company: meta('og:site_name') || host.split('.').slice(-2, -1)[0] || host,
      title: title || 'Job posting', location: '', remote: null, postedAt: new Date().toISOString(), url: req.manualUrl || req.url, applyUrl: req.manualUrl || req.url,
      salary: null, description: htmlToText(body).slice(0, 15000) }));
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

// ---- LinkedIn job alerts (emails) → leads. We never fetch LinkedIn pages; we only read the alert email. ----
// A lead: { id, title, company, location, url }. Reads the plain-text part and the HTML part; whichever finds more wins.
function liNoise(l) {
  return /^(view job|apply|easy apply|promoted|actively (recruiting|hiring)|this company is actively hiring|be an early applicant|new|\d+ (school )?alumn|\d+ connections?|.*\bconnections? work here|your job alert|see all jobs|manage (job )?alerts|unsubscribe|this email was intended|learn why|help|©|linkedin|jobs? (similar|you may|based on)|top job picks|fast growing|in your network|.*\bapplicants?$|.*\bcompany alumni$|recently posted|\$|€|£)/i.test(l);
}
function parseLinkedInAlert(textPlain, textHtml) {
  const idOf = (u) => (String(u).match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^\/?#]*?-)?(\d{6,})/i) || [])[1];
  const named = { middot: '·', bull: '•', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', euro: '€', pound: '£' };
  const clean = (s) => decodeEntities(String(s || '').replace(/&([a-z]+);/g, (m, n) => named[n] || m)).replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const toLead = (id, lines) => {
    const ls = lines.map(clean).filter((l) => l && !liNoise(l) && !/^https?:\/\//i.test(l) && !/^[-=_*·•]{3,}$/.test(l));
    if (!ls.length) return null;
    let [title, company, location] = ls;
    // HTML cards put "Acme · Vienna, Austria (Remote)" on one line (the next line is a badge or footer)
    if (company && / [·•] /.test(company)) { const p = company.split(/ [·•] /); company = p[0]; location = p.slice(1).join(' · '); }
    if (!title || !company) return null;
    return { id, title: title.slice(0, 160), company: company.slice(0, 120), location: String(location || '').slice(0, 160), url: `https://www.linkedin.com/jobs/view/${id}/` };
  };
  const fromText = (t) => {
    const out = []; const seen = new Set();
    const lines = String(t || '').split(/\r?\n/);
    let block = [];
    for (const raw of lines) {
      const id = idOf(raw);
      if (id) {
        if (!seen.has(id)) { const before = block.filter((l) => clean(l) && !/^view job:?$/i.test(clean(l.replace(/https?:\/\/\S+/g, '')))); const lead = toLead(id, before.filter((l) => !liNoise(clean(l))).slice(0, 3)); if (lead) { out.push(lead); seen.add(id); } }
        block = [];
      } else if (/^\s*[-=_]{5,}\s*$/.test(raw)) block = [];
      else block.push(raw.replace(/https?:\/\/\S+/g, ''));
    }
    return out;
  };
  const fromHtml = (h) => {
    if (!h) return [];
    // mark each job link, then read the card as lines: the link's own text is the title, the next lines company/location
    let s = String(h).replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => { const id = idOf(decodeEntities(href)); return id ? `\n@@JOB ${id}@@\n${inner}\n@@END@@\n` : inner; });
    s = s.replace(/<\s*(br|\/p|\/div|\/td|\/tr|\/li|\/h\d|\/table)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
    const lines = s.split('\n').map(clean).filter(Boolean);
    const out = []; const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^@@JOB (\d+)@@$/);
      if (!m || seen.has(m[1])) continue;
      const inner = []; let j = i + 1;
      while (j < lines.length && lines[j] !== '@@END@@') inner.push(lines[j++]);
      const title = inner.filter((l) => !liNoise(l)).join(' ').trim();
      if (!title) continue; // logo / image link — the text link for the same job comes next
      const after = [];
      for (let k = j + 1; k < lines.length && after.length < 4; k++) { if (/^@@(JOB|END)/.test(lines[k])) { if (/^@@JOB/.test(lines[k]) && !lines[k].includes(m[1])) break; continue; } after.push(lines[k]); }
      const lead = toLead(m[1], [title].concat(after));
      if (lead) { out.push(lead); seen.add(m[1]); }
    }
    return out;
  };
  // the HTML card says Remote / Hybrid / On-site in the location, so it wins unless it found fewer jobs
  const a = fromText(textPlain), b = fromHtml(textHtml);
  return b.length && b.length >= a.length ? b : a;
}

// A LinkedIn lead as a job of its own: title/company/location only (used when its posting isn't on a public job board)
// Leads come from LinkedIn alert emails (via "linkedin", the default) or the lead feeds (Jobgether, VC portfolio
// boards). A lead's key is "<via>:<id>"; LinkedIn keys stay "linkedin:<id>" as before.
function leadVia(lead) { return (lead && lead.via) || 'linkedin'; }
function leadKey(lead) { return leadVia(lead) + ':' + lead.id; }
function leadLabel(via) { return ({ linkedin: 'LinkedIn alert', jobgether: 'Jobgether', getro: 'VC portfolio board' })[via] || via; }
function lightSources() { return ['linkedin', 'jobgether', 'getro']; }

function lightJob(lead) {
  const via = leadVia(lead);
  const tail = ' Judge location_eligible from it against the candidate\'s location rules exactly as for a full posting (a city or country the candidate can\'t work in = "no"). Answer "unclear" for language and pay unless obvious, and do not mark the role down for missing detail.)';
  const description = via === 'linkedin'
    ? '(Only the title, company and location are known: this came from a LinkedIn job alert and the full posting is not available. LinkedIn\'s location is reliable: "City, Country (Remote)" means remote within that country or region, "(Hybrid)"/"(On-site)" means that city.' + tail
    : `(Only what the ${leadLabel(via)} listing says is known; the full posting is not available.${lead.details ? ' Listing: ' + lead.details : ''} Its location field lists where applicants can be.` + tail;
  return mk({ uid: leadKey(lead), source: via, sourceLabel: leadLabel(via), company: lead.company, title: lead.title,
    location: lead.location || '', remote: /remote/i.test(lead.location || '') ? true : null, postedAt: toIso(lead.postedAt || null), url: lead.url, applyUrl: lead.url,
    salary: lead.salary || null, description, light: true, leadId: lead.id, leadKey: leadKey(lead) });
}

// ---- Lead feeds (workflow 8): listings that name company + title but not the full posting. The radar then looks for
// the posting on the company's own job board (or, for VC portfolio boards, reads the board's job page).
function leadFeedRequests(settings, now, mockBase, all) {
  const b = settings.boards || {};
  const minuteOfDay = Math.floor(((now || Date.now()) / 60000) % 1440);
  const every = boardEvery(settings);
  const due = (name) => { if (all) return true; const e = Math.max(60, Number(every[name]) || 60); return minuteOfDay % e < 60; };
  const reqs = [];
  if (b.jobgether !== false && due('jobgether')) {
    const locs = [].concat(settings.jobgetherLocations || ['europe']);
    for (const q of settings.boardQueries && settings.boardQueries.length ? settings.boardQueries : ['account executive'])
      for (const loc of locs)
        reqs.push({ source: 'jobgether', slug: q + '@' + loc, url: `https://jobgether.com/astroapi/ai/jobs.json?keyword=${encodeURIComponent(q)}&locations=${encodeURIComponent(loc)}&limit=25&page=1&sort=date` });
  }
  if (b.getro !== false && due('getro'))
    for (const host of [].concat(settings.vcBoards || getroBoards())) reqs.push({ source: 'getro', slug: host, url: `https://${host}/sitemap.xml` });
  if (mockBase) for (const r of reqs) r.url = mockBase + '/src/' + r.source + '/' + encodeURIComponent(r.slug);
  return reqs;
}
// European VC portfolio job boards on Getro (list from jobradar-eu, MIT). Their sitemaps are public and allowed by
// robots.txt. Techstars and Accel are left out: US-heavy, and their sitemaps are split into indexes.
function getroBoards() {
  return ['jobs.pointnine.com', 'careers.atomico.com', 'careers.creandum.com', 'careers.speedinvest.com', 'jobs.earlybird.com',
    'jobs.mmc.vc', 'jobs.openocean.vc', 'jobs.firstminute.capital', 'jobs.byfounders.vc'];
}
function titleFromSlug(s) {
  const small = new Set(['and', 'of', 'the', 'for', 'in', 'to', 'at', 'with', 'or']);
  return String(s || '').split('-').filter(Boolean).map((w, i) => {
    if (/^(ae|sdr|bdr|am|csm|emea|dach|uk|us|eu|usa|smb|saas|ai|gtm|b2b|vp|ii|iii|uki|apac|latam|nordics)$/i.test(w)) return w.toUpperCase();
    return i && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
// Jobgether's agents API → leads. Rows carry company, title, where applicants can be, remote type, salary — no description.
function jobgetherLeads(raw) {
  const d = parseBody(raw);
  const out = [];
  for (const j of (d && d.jobs) || []) {
    if (!j || !j.id || !j.title || !j.company) continue;
    const details = [['Work', j.remote], ['Where applicants can be', j.location], ['Experience', j.experience], ['Contract', j.contractType], ['Job functions', (j.jobFunctions || []).join(', ')], ['Salary', j.salaryRange]]
      .filter(([, v]) => v).map(([k, v]) => `${k}: ${htmlToText(String(v))}.`).join(' ');
    out.push({ via: 'jobgether', id: String(j.id), title: htmlToText(j.title), company: j.company, location: [j.remote, j.location].filter(Boolean).join(' · '),
      url: j.url, postedAt: j.postedAt || null, salary: j.salaryRange || null, details });
  }
  return out;
}
// A Getro board's sitemap → leads (job id, title and company from the URL; lastmod when given). The radar reads each
// lead's job page for the full posting.
function getroLeads(raw, host) {
  const xml = String(raw || '');
  const out = [];
  const re = /<url>([\s\S]*?)<\/url>/g; let m;
  while ((m = re.exec(xml))) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1];
    const mod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1];
    const p = loc && loc.match(/^https?:\/\/[^/]+\/companies\/([^/]+)\/jobs\/(\d+)-([^/?#]+)$/);
    if (!p) continue;
    out.push({ via: 'getro', id: p[2], title: titleFromSlug(p[3]), company: titleFromSlug(p[1].replace(/-\d+$/, '')), location: '',
      url: loc, detailUrl: loc, lastmod: mod ? toIso(mod) : null, board: host });
  }
  return out;
}

// Same posting? Titles compared loosely (punctuation, word order, "Sr." vs "Senior").
function titleKey(t) {
  return String(t || '').toLowerCase().replace(/\bsr\b\.?/g, 'senior').replace(/\bjr\b\.?/g, 'junior').replace(/\bmgr\b/g, 'manager').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function matchLead(lead, jobs) {
  const want = titleKey(lead.title); const wantFull = String(lead.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const toks = (s) => new Set(s.split(' ').filter((w) => w.length > 1));
  const W = toks(want);
  let best = null, bestScore = 0;
  for (const j of jobs) {
    const have = titleKey(j.title); const haveFull = String(j.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    let sc = 0;
    if (haveFull === wantFull) sc = 3; else if (have === want) sc = 2.5;
    else { const H = toks(have); const inter = [...W].filter((w) => H.has(w)).length; const jac = inter / (new Set([...W, ...H]).size || 1); if (jac >= 0.75) sc = 1 + jac; }
    if (sc > bestScore) { best = j; bestScore = sc; }
  }
  return best;
}

// Which job boards to read for a batch of leads: the company's own board when you watch it, a board found earlier,
// or a guess at its public Ashby / Greenhouse / Lever board (no login, no LinkedIn). Returns { reqs, light } —
// light = leads with nowhere to look (they become title-only jobs straight away).
function leadRequests(leads, settings, boards, now, mockBase) {
  const { companies } = companiesFromSettings(settings);
  const reqs = []; const light = []; const have = new Set();
  const add = (r) => { const k = r.source + ':' + r.slug; if (have.has(k)) return; have.add(k); reqs.push(r); };
  let guessed = 0;
  for (const l of leads) {
    const n = normName(l.company);
    const own = companies.find((c) => normName(c.name) === n);
    const b = (boards || {})[n];
    // the listing has a job page of its own we may read (VC portfolio boards): that page is the posting
    if (l.detailUrl) { reqs.push({ source: leadVia(l) + '_detail', company: l.company, slug: l.id, url: l.detailUrl, method: 'GET', lead: true, detailFor: l.id }); continue; }
    if (own) add({ source: own.ats, company: own.name, slug: own.slug, dream: own.dream, url: atsUrls()[own.ats](own.slug), method: 'GET', lead: true });
    else if (b && b.ats && now - b.at < 30 * 864e5) add({ source: b.ats, company: l.company, slug: b.slug, url: atsUrls()[b.ats](b.slug), method: 'GET', lead: true });
    else if (b && b.none && now - b.at < 7 * 864e5) light.push(l);
    else if (guessed < 8) {
      guessed++;
      const slugs = [...new Set([n, slugify(String(l.company).replace(/\b(inc|ltd|llc|gmbh|corp)\b\.?/gi, ''), 60).toLowerCase()])].filter((s) => s && s.length > 1);
      for (const s of slugs) for (const ats of ['ashby', 'greenhouse', 'lever']) add({ source: ats, company: l.company, slug: s, url: atsUrls()[ats](s), method: 'GET', lead: true, guess: n });
    } else light.push(l);
  }
  if (mockBase) for (const r of reqs) r.url = mockBase + '/src/' + r.source + '/' + encodeURIComponent(r.slug || r.source);
  return { reqs, light };
}
