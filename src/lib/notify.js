// ---- notify.js : what notifications look like (Telegram card, email, digest, reports) ----
// Output "envelopes" consumed by the JobRadar · Send workflow:
//   { kind: 'tg_text',  tg: {...sendMessage params} }
//   { kind: 'tg_album', media: [...], binaryProps: [...], silent }
//   { kind: 'email',    subject, html, text, attach: 'prop1,prop2' }

function shortLoc(job) {
  const l = String(job.location || '').split(/[\/|;]/)[0].trim();
  const w = job.workplaceType || (job.remote ? 'Remote' : '');
  const s = l.length > 38 ? l.slice(0, 36) + '…' : l;
  return [s, w && !new RegExp(w, 'i').test(s) ? w : ''].filter(Boolean).join(' · ') || 'Location n/a';
}
function liSearch(q) { return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q) + '&origin=GLOBAL_SEARCH_HEADER'; }

function inQuietHours(qh, tz, now) {
  if (!qh || !qh.from || !qh.to) return false;
  let hm;
  try { hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || 'UTC' }).format(new Date(now || Date.now())); }
  catch (e) { hm = new Date(now || Date.now()).toISOString().slice(11, 16); }
  const { from, to } = qh;
  return from <= to ? (hm >= from && hm < to) : (hm >= from || hm < to);
}

// one-line, human checks (max n) — guardrail issues first, then the AI's own "verify" list
function topChecks(c, n) {
  return [].concat(c.warnings || [], c.issues || [], (c.review && c.review.verify) || []).filter(Boolean).slice(0, n);
}

// Who to reach out to: the named person when the posting gives one (their profile if linked, else a search for
// that exact name), and a generic LinkedIn search for whichever side (recruiter / hiring team) is still unknown.
function contactLinks(job, fit, review) {
  const f = fit || {};
  const desc = String(job.description || '');
  const urlInText = (desc.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/i) || [])[0] || '';
  const url = /linkedin\.com\/in\//i.test(f.contact_url || '') ? f.contact_url : urlInText;
  const name = String(f.contact_name || '').trim();
  const out = [];
  if (name || url) {
    const first = name ? name.split(/\s+/).slice(0, 2).join(' ') : 'Contact';
    const role = f.contact_role === 'recruiter' ? 'recruiter' : f.contact_role === 'hiring_manager' ? 'hiring manager' : '';
    out.push({ text: `👤 ${first}${role ? ' (' + role + ')' : ''}`.slice(0, 40), url: url || liSearch(`${name} ${job.company}`) });
  }
  if (f.contact_role !== 'recruiter') out.push({ text: '🔎 Recruiters', url: liSearch(`${job.company} recruiter`) });
  if (f.contact_role !== 'hiring_manager') out.push({ text: '🔎 Hiring team', url: liSearch((review && review.team_search) || `${job.company} hiring manager`) });
  return out;
}

function telegramCard(c, prefs) {
  const p = prefs || {};
  const { job, fit, review } = c;
  const detailed = p.style === 'detailed';
  const score = fit.score === null || fit.score === undefined ? '—' : fit.score;
  const lines = [
    `🎯 <b>${escHtml(job.title)}</b>`,
    `🏢 <b>${escHtml(job.company)}</b>${job.dream ? ' ⭐' : ''} · 📍 ${escHtml(shortLoc(job))}`,
    `📊 <b>${score}</b>/100${fit.skills_fit != null ? ` (skills ${fit.skills_fit} · values ${fit.values_fit})` : ''}${job.salary ? ' · 💶 ' + escHtml(String(job.salary).slice(0, 40)) : ''} · 🕒 ${job.postedAt ? humanAge(job.postedAt) : 'just found'}`,
  ];
  if (fit.why && fit.why[0]) lines.push(`✨ ${escHtml(String(fit.why[0]).slice(0, 160))}`);
  if ((fit.values_match || [])[0]) lines.push(`💚 ${escHtml(fit.values_match.slice(0, detailed ? 3 : 1).join(' · ').slice(0, 200))}`);
  if (c.changes) lines.push(c.changes.unchanged ? '✏️ Resume unchanged — your base version' : `✏️ Resume: ${escHtml(c.changes.summary)} — see “What changed”`);
  const checks = topChecks(c, detailed ? 5 : 3);
  if (checks.length) lines.push('', '⚠️ <b>Check before sending</b>', ...checks.map((x) => '• ' + escHtml(String(x).slice(0, 180))));
  if (detailed) {
    if ((fit.gaps || []).length) lines.push('', '<b>Gaps</b>', ...fit.gaps.slice(0, 3).map((x) => '• ' + escHtml(x)));
    const kw = c.keywordCoverage;
    if (kw && kw.pct !== null) lines.push('', `<b>ATS keywords</b> ${kw.covered.length}/${kw.covered.length + kw.missing.length}${kw.missing.length ? ' · missing: ' + escHtml(kw.missing.slice(0, 5).join(', ')) : ''}`);
    if (review && (review.changes || []).length) lines.push('', '<b>What changed</b>', ...review.changes.slice(0, 3).map((x) => '• ' + escHtml(x)));
  }
  let text = lines.join('\n');
  if (text.length > 3900) text = text.slice(0, 3890) + '…';

  const b = Object.assign({ linkedinSearch: true, copyOutreachNote: true, statusButtons: true }, p.buttons || {});
  const kb = [[{ text: '🚀 Apply', url: job.applyUrl || job.url }]];
  if (job.url && job.url !== job.applyUrl) kb[0].push({ text: '📄 Job post', url: job.url });
  if (b.linkedinSearch) {
    const links = contactLinks(job, fit, review);
    if (links[0] && links[0].text.startsWith('👤')) { kb.push([links[0]]); links.shift(); }
    if (links.length) kb.push(links);
  }
  if (b.copyOutreachNote && review && review.outreach_note) kb.push([{ text: '📋 Copy LinkedIn note', copy_text: { text: String(review.outreach_note).slice(0, 256) } }]);
  if (b.statusButtons) kb.push([{ text: '✅ Applied', callback_data: 'ap:' + c.jrId }, { text: '⏭ Skip', callback_data: 'sk:' + c.jrId }]);
  return { parse_mode: 'HTML', text, disable_web_page_preview: true, reply_markup: { inline_keyboard: kb } };
}

function mailto(to, cmd, jrId, label) {
  return `mailto:${to}?subject=${encodeURIComponent(`JobRadar ${cmd} ${jrId} JR-CMD`)}&body=${encodeURIComponent(`Just hit send — this updates your JobRadar tracker (${label}).`)}`;
}

function btn(href, label, primary) { return `<a href="${escHtml(href)}" style="display:inline-block;margin:0 6px 8px 0;padding:9px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;${primary ? 'background:#1f3a5f;color:#ffffff' : 'background:#eef2f7;color:#1f3a5f'}">${escHtml(label)}</a>`; }

function emailForJob(c, prefs, to) {
  const { job, fit, review } = c;
  const p = prefs || {};
  const b = Object.assign({ linkedinSearch: true, copyOutreachNote: true, statusButtons: true }, p.buttons || {});
  const score = fit.score === null || fit.score === undefined ? '—' : fit.score;
  const age = job.postedAt ? 'posted ' + humanAge(job.postedAt) : 'just found';
  const subject = `${score} · ${job.title} at ${job.company} · ${shortLoc(job)} · ${age}`;
  const checks = topChecks(c, 5);
  const li = (arr) => (arr || []).filter(Boolean).map((x) => `<li style="margin:2px 0">${escHtml(x)}</li>`).join('');
  const kw = c.keywordCoverage;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:620px;margin:0 auto;padding:20px">
 <div style="background:#fff;border-radius:12px;padding:20px 22px;border:1px solid #e3e8ef">
  <div style="font-size:13px;color:#5b6b7f">${escHtml(job.company)}${job.dream ? ' ⭐' : ''} · ${escHtml(shortLoc(job))} · ${escHtml(age)}</div>
  <div style="font-size:20px;font-weight:700;margin:4px 0 8px">${escHtml(job.title)}</div>
  <div style="font-size:15px;margin-bottom:10px"><b style="font-size:22px">${score}</b>/100${fit.skills_fit != null ? ` · skills ${fit.skills_fit} · values ${fit.values_fit}` : ''}${job.salary ? ' · ' + escHtml(job.salary) : ''}</div>
  ${fit.company_note ? `<div style="font-size:13px;color:#5b6b7f;margin-bottom:8px">${escHtml(fit.company_note)}</div>` : ''}
  ${fit.why && fit.why[0] ? `<div style="margin-bottom:12px">✨ ${escHtml(fit.why[0])}</div>` : ''}
  ${c.changes ? `<div style="margin-bottom:12px">✏️ ${c.changes.unchanged ? 'Resume unchanged — your base version' : 'Resume: ' + escHtml(c.changes.summary) + ' — see the “What changed” attachment'}</div>` : ''}
  ${checks.length ? `<div style="background:#fff7e6;border:1px solid #f5d38b;border-radius:8px;padding:10px 12px;margin-bottom:14px"><b>⚠️ Check before sending</b><ul style="margin:6px 0 0;padding-left:18px">${li(checks)}</ul></div>` : ''}
  <div>${btn(job.applyUrl || job.url, '🚀 Apply', true)}${job.url && job.url !== job.applyUrl ? btn(job.url, '📄 Job post') : ''}${b.linkedinSearch ? contactLinks(job, fit, review).map((l) => btn(l.url, l.text)).join('') : ''}</div>
  ${b.statusButtons ? `<div style="margin-top:4px">${btn(mailto(to, 'APPLIED', c.jrId, 'applied'), '✅ I applied')}${btn(mailto(to, 'SKIP', c.jrId, 'skipped'), '⏭ Skip')}</div>` : ''}
  <div style="font-size:12px;color:#7a8696;margin-top:6px">📎 Your tailored resume and cover letter are attached${c.changesMd ? ', plus “What changed”' : ''}.</div>
 </div>
 <div style="padding:16px 6px;font-size:14px;line-height:1.5;color:#33404f">
  ${review && review.role_summary ? `<p><b>The role.</b> ${escHtml(review.role_summary)}</p>` : ''}
  ${(fit.why || []).length > 1 ? `<p><b>Why it fits</b></p><ul>${li(fit.why)}</ul>` : ''}
  ${(fit.values_match || []).length ? `<p><b>What matches your values</b></p><ul>${li(fit.values_match)}</ul>` : ''}
  ${(fit.gaps || []).length ? `<p><b>Gaps</b></p><ul>${li(fit.gaps)}</ul>` : ''}
  ${kw && kw.pct !== null ? `<p><b>ATS keywords:</b> ${kw.covered.length}/${kw.covered.length + kw.missing.length} covered${kw.missing.length ? '. Missing (add only if true): ' + escHtml(kw.missing.join(', ')) : ''}</p>` : ''}
  ${review && (review.changes || []).length ? `<p><b>What was changed</b></p><ul>${li(review.changes)}</ul>` : ''}
  ${review && (review.intro_call_prep || []).length ? `<p><b>Intro-call prep</b></p><ul>${li(review.intro_call_prep)}</ul>` : ''}
  ${b.copyOutreachNote && review && review.outreach_note ? `<p><b>LinkedIn note</b></p><div style="background:#fff;border:1px solid #e3e8ef;border-radius:8px;padding:10px 12px">${escHtml(review.outreach_note)}</div>` : ''}
  <p style="font-size:12px;color:#7a8696">JobRadar · ${escHtml(job.sourceLabel || '')} · ${escHtml(c.jrId)}</p>
 </div>
</div></body></html>`;
  const text = `${subject}\n\nApply: ${job.applyUrl || job.url}\n${checks.length ? '\nCheck before sending:\n- ' + checks.join('\n- ') + '\n' : ''}`;
  return { subject, html, text };
}

// ---------- reports ----------
function median(arr) { const a = arr.filter((x) => typeof x === 'number' && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function pct(n, d) { return d ? Math.round((100 * n) / d) + '%' : '—'; }

function computeReport(rows, period, now, cfg) {
  const t = now || Date.now();
  const days = period === 'monthly' ? 30 : 7;
  const since = t - days * 864e5;
  const ghostDays = (cfg && cfg.ghostedAfterDays) || 21;
  const inP = (iso) => iso && new Date(iso).getTime() >= since;
  const notified = rows.filter((r) => inP(r.notified_at) && r.status !== 'digest_pending');
  const applied = rows.filter((r) => inP(r.applied_at));
  const skipped = notified.filter((r) => r.status === 'skipped');
  // outcomes are judged over everything applied in the window (they arrive later)
  const outc = (o) => applied.filter((r) => r.outcome === o).length;
  const responded = applied.filter((r) => ['reply', 'rejected', 'intro', 'offer'].includes(r.outcome)).length;
  const intro = outc('intro') + outc('offer');
  const ghosted = applied.filter((r) => !r.outcome && t - new Date(r.applied_at).getTime() > ghostDays * 864e5).length;
  const minsToAlert = median(notified.map((r) => Number(r.minutes_to_alert)).filter((x) => x >= 0));
  const hrsToApply = median(applied.map((r) => (new Date(r.applied_at) - new Date(r.notified_at)) / 36e5));
  // the premise: does applying fast get more responses?
  const allApplied = rows.filter((r) => r.applied_at);
  const fast = allApplied.filter((r) => (new Date(r.applied_at) - new Date(r.posted_at || r.notified_at)) / 36e5 <= 6);
  const slow = allApplied.filter((r) => !fast.includes(r));
  const respRate = (g) => g.filter((r) => ['reply', 'rejected', 'intro', 'offer'].includes(r.outcome)).length;
  const bySource = {};
  for (const r of notified) { const s = r.source || '?'; bySource[s] = bySource[s] || { n: 0, applied: 0 }; bySource[s].n++; if (r.applied_at) bySource[s].applied++; }
  return {
    period, days, notified: notified.length, applied: applied.length, skipped: skipped.length,
    responded, rejected: outc('rejected'), replies: outc('reply'), intro, offers: outc('offer'), ghosted,
    minsToAlert, hrsToApply, speed: { fastN: fast.length, fastResp: respRate(fast), slowN: slow.length, slowResp: respRate(slow) },
    bySource: Object.entries(bySource).sort((a, b) => b[1].n - a[1].n).slice(0, 5),
    pending: rows.filter((r) => r.status === 'applied' && !r.outcome && t - new Date(r.applied_at).getTime() > ((cfg && cfg.checkInAfterDays) || 5) * 864e5).slice(0, 8),
  };
}

function reportLines(R) {
  const L = [];
  L.push(`📬 Found and sent: ${R.notified} · applied: ${R.applied} · skipped: ${R.skipped}`);
  L.push(`💬 Responses: ${R.responded}/${R.applied} (${pct(R.responded, R.applied)}) · ❌ rejections: ${R.rejected} · 📞 intro calls: ${R.intro}${R.offers ? ' · 🎉 offers: ' + R.offers : ''}`);
  if (R.ghosted) L.push(`👻 No answer after 3 weeks: ${R.ghosted}`);
  if (R.minsToAlert !== null) L.push(`⚡ Median time from posting to your phone: ${Math.round(R.minsToAlert)} min`);
  if (R.hrsToApply !== null) L.push(`⏱ Median time from alert to applying: ${R.hrsToApply < 1 ? Math.round(R.hrsToApply * 60) + ' min' : R.hrsToApply.toFixed(1) + ' h'}`);
  const s = R.speed;
  if (s.fastN >= 5 && s.slowN >= 5) L.push(`🏁 Applied within 6 h of posting: ${pct(s.fastResp, s.fastN)} got a response (n=${s.fastN}) vs ${pct(s.slowResp, s.slowN)} later (n=${s.slowN})`);
  else L.push(`🏁 Early vs late applying: not enough data yet (${s.fastN} early, ${s.slowN} late; need 5+ each)`);
  if (R.bySource.length) L.push(`🗂 Sources: ${R.bySource.map(([k, v]) => `${k} ${v.n}${v.applied ? ' (' + v.applied + ' applied)' : ''}`).join(' · ')}`);
  if (R.applied && R.applied < 10) L.push(`ℹ️ Small numbers — treat percentages as direction, not proof.`);
  return L;
}

function telegramReport(R) {
  const title = R.period === 'monthly' ? '📈 <b>JobRadar — last 30 days</b>' : '📊 <b>JobRadar — your week</b>';
  const msgs = [{ kind: 'tg_text', tg: { parse_mode: 'HTML', disable_web_page_preview: true, text: title + '\n\n' + reportLines(R).map(escHtml).join('\n') } }];
  if (R.pending.length) {
    const kb = [];
    for (const r of R.pending) {
      kb.push([{ text: `${String(r.company).slice(0, 18)} · ${String(r.title).slice(0, 22)}`, url: r.apply_url || r.url || 'https://jobs.ashbyhq.com' }]);
      kb.push([{ text: '💬 Reply', callback_data: `o:${r.jr_id}:reply` }, { text: '❌ No', callback_data: `o:${r.jr_id}:rejected` }, { text: '📞 Call', callback_data: `o:${r.jr_id}:intro` }, { text: '👻', callback_data: `o:${r.jr_id}:none` }]);
    }
    msgs.push({ kind: 'tg_text', tg: { parse_mode: 'HTML', text: '🔁 <b>What happened with these?</b> One tap each keeps your stats honest.', reply_markup: { inline_keyboard: kb } } });
  }
  if ((R.discover || []).length) {
    const lines = R.discover.map((c) => `• <b>${escHtml(c.name)}</b> — values ${c.avg} across ${c.n} role${c.n > 1 ? 's' : ''}${c.note ? `\n  <i>${escHtml(String(c.note).slice(0, 110))}</i>` : ''}`);
    msgs.push({ kind: 'tg_text', tg: { parse_mode: 'HTML', disable_web_page_preview: true,
      text: '🧭 <b>Companies you might want to watch</b>\nThey keep matching your values but aren\'t on your list. Tap ➕ and their roles get priority.\n\n' + lines.join('\n'),
      reply_markup: { inline_keyboard: R.discover.map((c) => [{ text: '➕ ' + c.name, callback_data: ('w:' + c.name).slice(0, 60) }]) } } });
  }
  return msgs;
}

function emailReport(R, to) {
  const title = R.period === 'monthly' ? 'JobRadar — last 30 days' : 'JobRadar — your week';
  const pend = R.pending.map((r) => `<tr><td style="padding:6px 8px">${escHtml(r.company)} · ${escHtml(r.title)}</td><td style="padding:6px 0">${
    [['reply', '💬 Reply'], ['rejected', '❌ No'], ['intro', '📞 Call'], ['none', '👻 Nothing']].map(([o, l]) => `<a href="${escHtml(mailto(to, 'OUTCOME ' + o, r.jr_id, l))}" style="margin-right:8px;color:#1f3a5f">${l}</a>`).join('')}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f7fa;margin:0"><div style="max-width:620px;margin:0 auto;padding:20px"><div style="background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:20px 22px">
<h2 style="margin:0 0 12px">${escHtml(title)}</h2>${reportLines(R).map((l) => `<p style="margin:6px 0">${escHtml(l)}</p>`).join('')}
${pend ? `<h3 style="margin:18px 0 6px">What happened with these?</h3><table style="font-size:14px">${pend}</table>` : ''}
${(R.discover || []).length ? `<h3 style="margin:18px 0 6px">Companies you might want to watch</h3><p style="font-size:14px;color:#5b6b7f">They keep matching your values but aren't on your list.</p><ul style="font-size:14px">${R.discover.map((c) => `<li style="margin:6px 0"><b>${escHtml(c.name)}</b> — values ${c.avg} across ${c.n} role(s) · <a href="mailto:${escHtml(to)}?subject=${encodeURIComponent('JobRadar WATCH ' + c.name + ' JR-CMD')}" style="color:#1f3a5f">➕ Watch</a></li>`).join('')}</ul>` : ''}</div></div></body></html>`;
  return { kind: 'email', subject: `${title}: ${R.applied} applied, ${R.responded} responses, ${R.intro} intro calls`, html, text: reportLines(R).join('\n') };
}

function digestEnvelopes(rows, channels, to) {
  const out = [];
  if (!rows.length) return out;
  const top = rows.slice(0, 15);
  const line = (r) => `${r.score} · ${r.title} — ${r.company}${r.skills_fit >= 0 && r.values_fit >= 0 ? ` (skills ${r.skills_fit} · values ${r.values_fit})` : ''}`;
  if (channels.includes('telegram')) {
    const text = `🗞 <b>Worth a look</b> — ${rows.length} role${rows.length > 1 ? 's' : ''} that match at least half of your skills and values.\nNot tailored yet; tap one to open it.\n\n` +
      top.map((r) => '• ' + escHtml(line(r)) + (r.values_note ? `\n  <i>${escHtml(String(r.values_note).slice(0, 110))}</i>` : '')).join('\n');
    const kb = top.map((r) => [{ text: `${r.score} · ${String(r.company).slice(0, 18)} · ${String(r.title).slice(0, 26)}`, url: r.apply_url || r.url }]);
    out.push({ kind: 'tg_text', tg: { parse_mode: 'HTML', disable_web_page_preview: true, text: text.slice(0, 3900), reply_markup: { inline_keyboard: kb } } });
  }
  if (channels.includes('email')) {
    const items = top.map((r) => `<li style="margin:8px 0"><a href="${escHtml(r.apply_url || r.url)}"><b>${escHtml(r.title)}</b> — ${escHtml(r.company)}</a><br><span style="color:#5b6b7f;font-size:13px">${escHtml(line(r).split(' — ')[0].split(' · ')[0])}/100 · ${escHtml(r.location || '')}${r.values_note ? ' · ' + escHtml(r.values_note) : ''}</span></li>`).join('');
    out.push({ kind: 'email', subject: `JobRadar: ${rows.length} role${rows.length > 1 ? 's' : ''} worth a look`, html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:620px"><h2>Worth a look</h2><p>Roles that match at least half of your skills and values. Not tailored yet.</p><ul>${items}</ul></div>`, text: top.map((r) => `${line(r)}: ${r.apply_url || r.url}`).join('\n') });
  }
  return out;
}

// companies that keep showing up with strong values fit but aren't on your list yet
function discoverCompanies(rows, watched, since) {
  const by = {};
  for (const r of rows) {
    if (!r.company || (since && new Date(r.notified_at).getTime() < since)) continue;
    if (watched[normName(r.company)]) continue;
    if (!(Number(r.values_fit) >= 70)) continue;
    const k = normName(r.company);
    (by[k] = by[k] || { name: r.company, n: 0, sum: 0, note: r.values_note || '' }).n++;
    by[k].sum += Number(r.values_fit);
  }
  return Object.values(by).map((c) => Object.assign(c, { avg: Math.round(c.sum / c.n) })).sort((a, b) => (b.avg - a.avg) || (b.n - a.n)).slice(0, 5);
}
