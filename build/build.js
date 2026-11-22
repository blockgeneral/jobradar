// Builds every n8n workflow in workflows/ from src/. Run: node build/build.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const lib = (n) => fs.readFileSync(path.join(root, 'src/lib', n + '.js'), 'utf8');

function parts(file) {
  const out = {};
  for (const c of fs.readFileSync(path.join(root, 'src/wf', file), 'utf8').split(/^\/\/@node\s+/m).slice(1)) {
    const name = c.split('\n')[0].trim();
    out[name] = c.split('\n').slice(1).join('\n').trim() + '\n';
  }
  return out;
}
const R = parts('radar.js');
const O = parts('others.js');
const ALL_LIBS = ['util', 'sources', 'prompts', 'guard', 'notify'];

const DIR = "($env.JOBRADAR_DIR || '/home/node/jobradar')";
const TG = "($env.TELEGRAM_API_BASE || 'https://api.telegram.org') + '/bot' + $env.TELEGRAM_BOT_TOKEN";
const RENDERER = "($env.RENDERER_URL || 'http://renderer:3100')";
const ANTHROPIC = "($env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')";
const TABLE = { __rl: true, mode: 'name', value: 'jobradar_jobs' };
const WATCH = { __rl: true, mode: 'name', value: 'jobradar_watch' };
const WATCH_COLS = [['name', 'string'], ['dream', 'boolean'], ['added_at', 'string'], ['source', 'string']];
const COLS = [['jr_id', 'string'], ['uid', 'string'], ['alt_key', 'string'], ['company', 'string'], ['title', 'string'], ['location', 'string'], ['source', 'string'],
  ['url', 'string'], ['apply_url', 'string'], ['score', 'number'], ['skills_fit', 'number'], ['values_fit', 'number'], ['values_note', 'string'], ['dream', 'boolean'], ['role_family', 'string'], ['salary', 'string'], ['posted_at', 'string'],
  ['notified_at', 'string'], ['minutes_to_alert', 'number'], ['status', 'string'], ['applied_at', 'string'], ['outcome', 'string'], ['outcome_at', 'string'],
  ['folder', 'string'], ['channel', 'string']];


function workflow(id, name, build) {
  let n = 0;
  const nodes = [], connections = {};
  const add = (nm, type, typeVersion, position, parameters, extra) => { nodes.push(Object.assign({ id: `${id}-${String(++n).padStart(4, '0')}`, name: nm, type, typeVersion, position, parameters }, extra || {})); return nm; };
  const api = {
    code: (nm, pos, body, libs, notes) => add(nm, 'n8n-nodes-base.code', 2, pos,
      { jsCode: body.trim() + '\n\n// ───── helpers (generated from src/lib — edit there and rebuild) ─────\n' + (libs || ALL_LIBS).map(lib).join('\n') },
      notes ? { notes, notesInFlow: true } : {}),
    http: (nm, pos, params, extra) => add(nm, 'n8n-nodes-base.httpRequest', 4.2, pos, params, extra),
    node: add,
    link: (a, ...bs) => { connections[a] = connections[a] || { main: [[]] }; for (const b of bs) connections[a].main[0].push({ node: b, type: 'main', index: 0 }); },
    linkOut: (a, outIdx, b) => { connections[a] = connections[a] || { main: [] }; while (connections[a].main.length <= outIdx) connections[a].main.push([]); connections[a].main[outIdx].push({ node: b, type: 'main', index: 0 }); },
    sticky: (pos, w, h, content, color) => add('Note ' + (n + 1), 'n8n-nodes-base.stickyNote', 1, pos, { content, width: w, height: h, color: color || 7 }),
  };
  build(api);
  return { id, name, nodes, connections, pinData: {}, active: false,
    settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
    meta: { templateCredsSetupCompleted: true } };
}

const sendCall = (a, nm, pos) => a.node(nm, 'n8n-nodes-base.executeWorkflow', 1.2, pos, {
  source: 'database', workflowId: { __rl: true, mode: 'id', value: 'JobRadarSend0001' }, mode: 'once',
  workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [] }, options: { waitForSubWorkflow: true },
}, { onError: 'continueRegularOutput' });
const anthropic = (a, nm, pos, field, timeout, notes) => a.http(nm, pos, {
  method: 'POST', url: `={{ ${ANTHROPIC} + '/v1/messages' }}`,
  sendHeaders: true, headerParameters: { parameters: [{ name: 'x-api-key', value: '={{ $env.ANTHROPIC_API_KEY }}' }, { name: 'anthropic-version', value: '2023-06-01' }] },
  sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: `={{ JSON.stringify($json.${field}) }}`,
  options: { timeout, batching: { batch: { batchSize: 3, batchInterval: 1500 } } },
}, { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, notes, notesInFlow: true });
const tableUpdate = (a, nm, pos) => a.node(nm, 'n8n-nodes-base.dataTable', 1.1, pos, {
  resource: 'row', operation: 'update', dataTableId: TABLE, matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'jr_id', condition: 'eq', keyValue: '={{ $json.jr_id }}' }] },
  columns: { mappingMode: 'autoMapInputData', value: null }, options: {},
}, { onError: 'continueRegularOutput' });
const tableGetAll = (a, nm, pos, table) => a.node(nm, 'n8n-nodes-base.dataTable', 1.1, pos, {
  resource: 'row', operation: 'get', dataTableId: table || TABLE, returnAll: true,
}, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
const hook = (a, nm, pos, path) => a.node(nm, 'n8n-nodes-base.webhook', 2, pos, { httpMethod: 'POST', path, responseMode: 'lastNode', responseData: 'noData', options: {} },
  { webhookId: 'a1b2c3d4-0000-4000-8000-' + Buffer.from(path).toString('hex').padEnd(12, '0').slice(0, 12), notes: 'Local only: ./jobradar uses this', notesInFlow: true });
const ensureTable = (a, nm, pos, table, cols) => a.node(nm, 'n8n-nodes-base.dataTable', 1.1, pos, {
  resource: 'table', operation: 'create', tableName: table || 'jobradar_jobs',
  columns: { column: (cols || COLS).map(([name, type]) => ({ name, type })) }, options: { createIfNotExists: true } }, { executeOnce: true, onError: 'continueRegularOutput' });
const tableInsert = (a, nm, pos, table) => a.node(nm, 'n8n-nodes-base.dataTable', 1.1, pos, { resource: 'row', operation: 'insert', dataTableId: table, columns: { mappingMode: 'autoMapInputData', value: null }, options: {} }, { onError: 'continueRegularOutput' });
const readFiles = (a, nm, pos, glob) => a.node(nm, 'n8n-nodes-base.readWriteFile', 1.1, pos, { operation: 'read', fileSelector: `={{ ${DIR} + '${glob}' }}`, options: {} });

// ───────────────────────── Install ─────────────────────────
// ───────────────────────── Send (shared) ─────────────────────────
const send = workflow('JobRadarSend0001', 'JobRadar · 9 Send (used by the others)', (a) => {
  a.node('📨 From other workflows', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], { inputSource: 'passthrough' });
  a.code('🧭 Route', [220, 0], O.send_route, ['util']);
  a.node('🔀 By kind', 'n8n-nodes-base.switch', 3.2, [440, 0], { mode: 'expression', numberOutputs: 4,
    output: "={{ ({ tg_text: 0, tg_album: 1, email: 2, tg_album3: 3 })[$json.kind] ?? 0 }}", options: {} });
  a.http('💬 Telegram message', [700, -180], { method: 'POST', url: `={{ ${TG} + '/sendMessage' }}`, sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify(Object.assign({ chat_id: $env.TELEGRAM_CHAT_ID }, $json.tg)) }}',
    options: { timeout: 30000, batching: { batch: { batchSize: 1, batchInterval: 400 } } } }, { onError: 'continueRegularOutput' });
  a.http('📎 Telegram files (album)', [700, 0], { method: 'POST', url: `={{ ${TG} + '/sendMediaGroup' }}`, sendBody: true, contentType: 'multipart-form-data',
    bodyParameters: { parameters: [
      { parameterType: 'formData', name: 'chat_id', value: '={{ $env.TELEGRAM_CHAT_ID }}' },
      { parameterType: 'formData', name: 'media', value: '={{ JSON.stringify($json.media) }}' },
      { parameterType: 'formData', name: 'disable_notification', value: '={{ $json.silent ? "true" : "false" }}' },
      { parameterType: 'formBinaryData', name: 'doc1', inputDataFieldName: 'doc1' },
      { parameterType: 'formBinaryData', name: 'doc2', inputDataFieldName: 'doc2' },
    ] }, options: { timeout: 60000, batching: { batch: { batchSize: 1, batchInterval: 600 } } } }, { onError: 'continueRegularOutput' });
  // same, with the "What changed" review as a third file (n8n needs a fixed list of binary fields per node)
  a.http('📎 Telegram files (album + changes)', [700, 360], { method: 'POST', url: `={{ ${TG} + '/sendMediaGroup' }}`, sendBody: true, contentType: 'multipart-form-data',
    bodyParameters: { parameters: [
      { parameterType: 'formData', name: 'chat_id', value: '={{ $env.TELEGRAM_CHAT_ID }}' },
      { parameterType: 'formData', name: 'media', value: '={{ JSON.stringify($json.media) }}' },
      { parameterType: 'formData', name: 'disable_notification', value: '={{ $json.silent ? "true" : "false" }}' },
      { parameterType: 'formBinaryData', name: 'doc1', inputDataFieldName: 'doc1' },
      { parameterType: 'formBinaryData', name: 'doc2', inputDataFieldName: 'doc2' },
      { parameterType: 'formBinaryData', name: 'doc3', inputDataFieldName: 'doc3' },
    ] }, options: { timeout: 60000, batching: { batch: { batchSize: 1, batchInterval: 600 } } } }, { onError: 'continueRegularOutput' });
  a.node('✉️ Email', 'n8n-nodes-base.emailSend', 2.1, [700, 180], {
    fromEmail: "={{ $env.SMTP_FROM || ('JobRadar <' + $env.SMTP_USER + '>') }}", toEmail: '={{ $json.to || $env.NOTIFY_EMAIL_TO || $env.SMTP_USER }}',
    subject: '={{ $json.subject }}', emailFormat: 'both', text: '={{ $json.text || "" }}', html: '={{ $json.html }}',
    options: { appendAttribution: false, fileAttachments: '={{ $json.attach || "" }}' },
  }, { credentials: { smtp: { id: 'JobRadarSmtp0001', name: 'JobRadar SMTP' } }, onError: 'continueRegularOutput' });
  a.link('📨 From other workflows', '🧭 Route');
  a.link('🧭 Route', '🔀 By kind');
  a.linkOut('🔀 By kind', 0, '💬 Telegram message');
  a.linkOut('🔀 By kind', 1, '📎 Telegram files (album)');
  a.linkOut('🔀 By kind', 2, '✉️ Email');
  a.linkOut('🔀 By kind', 3, '📎 Telegram files (album + changes)');
});

// ───────────────────────── Radar ─────────────────────────
const radar = workflow('JobRadarMain0001', 'JobRadar · 1 Radar (every 15 min)', (a) => {
  a.sticky([-60, -460], 760, 300, '## JobRadar — be one of the first applicants\n**Find** new roles minutes after they go live (company job boards + remote boards) → **screen** them against your search profile with Claude → **tailor** your resume and cover letter from your own files → **check** the AI didn\'t invent anything → **notify** you with the files and an Apply button.\n\nA human always submits. You edit `settings.json` and `candidate/`, not this workflow.', 4);
  a.node('⏰ Every 15 minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } });
  a.node('▶️ Run now', 'n8n-nodes-base.manualTrigger', 1, [0, 200], {});
  hook(a, '🔗 Run from CLI', [0, 400], 'jobradar-run');
  readFiles(a, '📂 Read settings + candidate', [240, 100], '/{settings.json,candidate/*.md}');
  a.code('⚙️ Plan run', [480, 100], R.plan_run, ['util', 'sources', 'notify'], 'Which job boards to check (or where to find LinkedIn alert jobs)');
  a.http('🌐 Fetch job sources', [720, 100], {
    method: '={{ $json.method || "GET" }}', url: '={{ $json.url }}',
    sendHeaders: true, headerParameters: { parameters: [
      { name: 'User-Agent', value: 'JobRadar/1.0 (open-source personal job search assistant)' },
      { name: 'Accept', value: '={{ $json.source === "hiringcafe_mcp" ? "application/json, text/event-stream" : "application/json, application/xml, application/rss+xml, */*" }}' } ] },
    sendBody: true, contentType: 'raw', rawContentType: '={{ $json.body ? "application/json" : "text/plain" }}', body: '={{ $json.body ? JSON.stringify($json.body) : "" }}',
    options: { timeout: 45000, batching: { batch: { batchSize: 6, batchInterval: 250 } }, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
  }, { onError: 'continueRegularOutput', notes: 'Company job boards update the minute a role is published', notesInFlow: true });
  a.code('🩺 Source health', [960, -140], R.source_health, ['util', 'sources']);
  sendCall(a, '📣 Send source alert', [1200, -140]);
  ensureTable(a, '🗃️ Tracker table ready', [960, 100]);
  tableGetAll(a, '🗃️ Already sent', [1080, 260]);
  ensureTable(a, '🗃️ Watch table ready', [1080, 420], 'jobradar_watch', WATCH_COLS);
  tableGetAll(a, '🗃️ Watch list', [1080, 580], WATCH);
  a.code('🧹 Normalize · dedupe · filter', [1200, 100], R.normalize, ['util', 'sources', 'prompts'], 'New + relevant only (no AI cost yet)');
  anthropic(a, '🤖 Screen (Claude Haiku)', [1440, 100], 'scoreRequest', 120000, 'Location, language, pay, fit 0–100');
  a.code('🎯 Gate', [1680, 100], R.gate, ['util', 'prompts'], 'Good matches only');
  a.node('🔀 Tailor now or list', 'n8n-nodes-base.switch', 3.2, [1800, 100], { mode: 'expression', numberOutputs: 3, output: "={{ ({ digest: 1, light: 2 })[$json.tier] ?? 0 }}", options: {} },
    { notes: 'Strong + dream → now; 50–74 → daily list; LinkedIn-only → title card', notesInFlow: true });
  a.code('🔎 LinkedIn title-only cards', [1920, 520], R.light_cards, ['util', 'notify']);
  sendCall(a, '📨 Send title-only cards', [2160, 520]);
  a.code('📝 Title-only rows', [1920, 700], R.light_rows, ['util']);
  tableInsert(a, '🗃️ Add title-only to tracker', [2160, 700], TABLE);
  anthropic(a, '✍️ Tailor (Claude Sonnet)', [1920, 100], 'tailorRequest', 240000, 'Resume + cover letter from your files');
  a.code('📝 Worth-a-look rows', [1920, 320], R.digest_rows, ['util']);
  tableInsert(a, '🗃️ Add to daily list', [2160, 320], TABLE);
  a.code('🛡️ Guardrails & compose', [2160, 100], R.compose, ['util', 'prompts', 'guard'], 'No invented numbers or claims');
  a.code('📑 Render requests', [2400, 0], R.render_requests, ['util']);
  a.http('🖨️ Make Word / PDF files', [2640, 0], { method: 'POST', url: `={{ ${RENDERER} + '/render' }}`, sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 90000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } } }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 });
  a.code('📦 Bundle notifications', [2880, 0], R.bundle, ALL_LIBS);
  sendCall(a, '📨 Send', [3120, 0]);
  a.code('🗂️ Editable sources', [2400, 220], R.save_sources, ['util']);
  a.http('💾 Save .md + job.json', [2640, 220], { method: 'POST', url: `={{ ${RENDERER} + '/save' }}`, sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 30000 } }, { onError: 'continueRegularOutput' });
  a.code('📝 Tracker rows', [2880, 220], R.track_rows, ['util']);
  tableInsert(a, '🗃️ Add to tracker', [3120, 220], TABLE);

  a.link('⏰ Every 15 minutes', '📂 Read settings + candidate');
  a.link('▶️ Run now', '📂 Read settings + candidate');
  a.link('🔗 Run from CLI', '📂 Read settings + candidate');
  a.link('📂 Read settings + candidate', '⚙️ Plan run');
  a.link('⚙️ Plan run', '🌐 Fetch job sources');
  a.link('🌐 Fetch job sources', '🩺 Source health', '🗃️ Tracker table ready');
  a.link('🗃️ Tracker table ready', '🗃️ Already sent');
  a.link('🩺 Source health', '📣 Send source alert');
  a.link('🗃️ Already sent', '🗃️ Watch table ready');
  a.link('🗃️ Watch table ready', '🗃️ Watch list');
  a.link('🗃️ Watch list', '🧹 Normalize · dedupe · filter');
  a.link('🧹 Normalize · dedupe · filter', '🤖 Screen (Claude Haiku)');
  a.link('🤖 Screen (Claude Haiku)', '🎯 Gate');
  a.link('🎯 Gate', '🔀 Tailor now or list');
  a.linkOut('🔀 Tailor now or list', 0, '✍️ Tailor (Claude Sonnet)');
  a.linkOut('🔀 Tailor now or list', 1, '📝 Worth-a-look rows');
  a.link('📝 Worth-a-look rows', '🗃️ Add to daily list');
  a.linkOut('🔀 Tailor now or list', 2, '🔎 LinkedIn title-only cards');
  a.linkOut('🔀 Tailor now or list', 2, '📝 Title-only rows');
  a.link('🔎 LinkedIn title-only cards', '📨 Send title-only cards');
  a.link('📝 Title-only rows', '🗃️ Add title-only to tracker');
  a.link('✍️ Tailor (Claude Sonnet)', '🛡️ Guardrails & compose');
  a.link('🛡️ Guardrails & compose', '📑 Render requests', '🗂️ Editable sources');
  a.link('📑 Render requests', '🖨️ Make Word / PDF files');
  a.link('🖨️ Make Word / PDF files', '📦 Bundle notifications');
  a.link('📦 Bundle notifications', '📨 Send');
  a.link('🗂️ Editable sources', '💾 Save .md + job.json');
  a.link('💾 Save .md + job.json', '📝 Tracker rows');
  a.link('📝 Tracker rows', '🗃️ Add to tracker');
});

// ───────────────────────── Actions (Telegram buttons) ─────────────────────────
const actions = workflow('JobRadarActn0001', 'JobRadar · 2 Telegram buttons (every minute)', (a) => {
  a.node('⏰ Every minute', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
  a.node('▶️ Run now', 'n8n-nodes-base.manualTrigger', 1, [0, 200], {});
  hook(a, '🔗 Run from CLI', [0, 400], 'jobradar-buttons');
  a.code('📥 Poll Telegram', [220, 0], O.actions_poll, ['util']);
  a.http('🛰 Get button presses', [440, 0], { url: `={{ ${TG} + '/getUpdates?timeout=0&allowed_updates=%5B%22callback_query%22%5D&offset=' + $json.offset }}`,
    options: { timeout: 30000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } } }, { onError: 'continueRegularOutput' });
  a.code('🧠 Parse presses', [660, 0], O.actions_parse, ['util']);
  a.code('📝 Rows to update', [880, -100], O.actions_rows, ['util']);
  tableUpdate(a, '🗃️ Update tracker', [1100, -100]);
  a.code('🔁 Replies to Telegram', [880, 100], O.actions_calls, ['util']);
  a.code('👀 Companies to watch', [880, 300], O.watch_rows, ['util']);
  tableInsert(a, '🗃️ Add to watch list', [1100, 300], WATCH);
  a.http('✅ Confirm in Telegram', [1100, 100], { method: 'POST', url: `={{ ${TG} + '/' + $json.method }}`, sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 20000 } }, { onError: 'continueRegularOutput' });
  a.link('⏰ Every minute', '📥 Poll Telegram');
  a.link('▶️ Run now', '📥 Poll Telegram');
  a.link('🔗 Run from CLI', '📥 Poll Telegram');
  a.link('📥 Poll Telegram', '🛰 Get button presses');
  a.link('🛰 Get button presses', '🧠 Parse presses');
  a.link('🧠 Parse presses', '📝 Rows to update', '🔁 Replies to Telegram', '👀 Companies to watch');
  a.link('👀 Companies to watch', '🗃️ Add to watch list');
  a.link('📝 Rows to update', '🗃️ Update tracker');
  a.link('🔁 Replies to Telegram', '✅ Confirm in Telegram');
});

// ───────────────────────── Email buttons (IMAP) ─────────────────────────
const IMAP = { imap: { id: 'JobRadarImap0001', name: 'JobRadar IMAP' } };
const inbox = workflow('JobRadarMail0001', 'JobRadar · 3 Email buttons (email users)', (a) => {
  a.node('📨 JobRadar label', 'n8n-nodes-base.emailReadImap', 2.1, [0, 0], {
    mailbox: '={{ $env.IMAP_FOLDER || "JobRadar" }}', postProcessAction: 'read', format: 'simple',
    options: { customEmailConfig: '["UNSEEN", ["SUBJECT", "JR-CMD"]]' } }, { credentials: IMAP });
  a.code('🧠 Parse commands', [240, 0], O.inbox_parse, ['util']);
  a.code('📝 Status changes', [480, -100], O.inbox_rows, ['util']);
  tableUpdate(a, '🗃️ Update tracker', [720, -100]);
  a.code('👀 Companies to watch', [480, 100], O.inbox_watch, ['util']);
  tableInsert(a, '🗃️ Add to watch list', [720, 100], WATCH);
  a.link('📨 JobRadar label', '🧠 Parse commands');
  a.link('🧠 Parse commands', '📝 Status changes', '👀 Companies to watch');
  a.link('📝 Status changes', '🗃️ Update tracker');
  a.link('👀 Companies to watch', '🗃️ Add to watch list');
});

const replies = workflow('JobRadarRepl0001', 'JobRadar · 4 Reply detection (optional)', (a) => {
  a.node('📨 New inbox mail', 'n8n-nodes-base.emailReadImap', 2.1, [0, 0], {
    mailbox: 'INBOX', postProcessAction: 'nothing', format: 'simple', options: { customEmailConfig: '["UNSEEN"]', trackLastMessageId: true } }, { credentials: IMAP });
  tableGetAll(a, '🗃️ Applications', [220, 0]);
  a.code('🔍 Plausible replies', [440, 0], O.replies_prefilter, ['util', 'prompts'], 'Only mail mentioning a company you applied to');
  anthropic(a, '🤖 Classify (Claude Haiku)', [660, 0], 'request', 60000);
  a.code('🏷️ Verdicts', [880, 0], O.replies_apply, ['util', 'prompts']);
  a.code('📝 Rows', [1100, -100], O.replies_rows, ['util']);
  tableUpdate(a, '🗃️ Update tracker', [1320, -100]);
  a.code('🔔 Heads-up', [1100, 100], O.replies_notes, ['util']);
  sendCall(a, '📨 Send', [1320, 100]);
  a.link('📨 New inbox mail', '🗃️ Applications');
  a.link('🗃️ Applications', '🔍 Plausible replies');
  a.link('🔍 Plausible replies', '🤖 Classify (Claude Haiku)');
  a.link('🤖 Classify (Claude Haiku)', '🏷️ Verdicts');
  a.link('🏷️ Verdicts', '📝 Rows', '🔔 Heads-up');
  a.link('📝 Rows', '🗃️ Update tracker');
  a.link('🔔 Heads-up', '📨 Send');
});

// ───────────────────────── Reports ─────────────────────────
const reports = workflow('JobRadarRprt0001', 'JobRadar · 5 Reports & digest (hourly check)', (a) => {
  a.node('⏰ Every hour', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 2 }] } });
  a.node('▶️ Run now', 'n8n-nodes-base.manualTrigger', 1, [0, 200], {});
  hook(a, '🔗 Run from CLI', [0, 400], 'jobradar-report');
  readFiles(a, '📂 Read settings', [220, 100], '/settings.json');
  a.code("⏰ What's due", [440, 100], O.reports_due, ['util']);
  ensureTable(a, '🗃️ Tracker table ready', [660, 100]);
  tableGetAll(a, '🗃️ Tracker', [880, 260]);
  tableGetAll(a, '🗃️ Watch list', [880, 420], WATCH);
  a.code('📊 Build report', [880, 100], O.reports_build, ALL_LIBS);
  a.code('✉️ Messages', [1100, 0], O.reports_msgs, ['util']);
  sendCall(a, '📨 Send', [1320, 0]);
  a.code('📝 Digest rows', [1100, 200], O.reports_rows, ['util']);
  tableUpdate(a, '🗃️ Mark sent', [1320, 200]);
  a.link('⏰ Every hour', '📂 Read settings');
  a.link('▶️ Run now', '📂 Read settings');
  a.link('🔗 Run from CLI', '📂 Read settings');
  a.link('📂 Read settings', "⏰ What's due");
  a.link("⏰ What's due", '🗃️ Tracker table ready');
  a.link('🗃️ Tracker table ready', '🗃️ Tracker');
  a.link('🗃️ Tracker', '🗃️ Watch list');
  a.link('🗃️ Watch list', '📊 Build report');
  a.link('📊 Build report', '✉️ Messages', '📝 Digest rows');
  a.link('✉️ Messages', '📨 Send');
  a.link('📝 Digest rows', '🗃️ Mark sent');
});

// ───────────────────────── Chat ─────────────────────────
// Talk to JobRadar in plain language: http://localhost:5678/webhook/<id>/chat  (./jobradar chat opens it).
// Only someone signed in to this n8n can use it. The helper service does the work (renderer/chat.js);
// edits are staged and saved only after you say yes.
const CHAT_HOOK = 'b7c1a5e0-0c4a-4e1d-9a6b-6a6f62726164';
const chatWf = workflow('JobRadarChat0001', 'JobRadar · 6 Chat (talk to JobRadar)', (a) => {
  a.node('💬 Chat with JobRadar', '@n8n/n8n-nodes-langchain.chatTrigger', 1.5, [0, 0], {
    public: true, mode: 'hostedChat', authentication: 'n8nUserAuth',
    initialMessages: "Hi! I'm your JobRadar assistant.\nTell me what you'd like to change, in your own words — for example:\n• \"watch Supabase as a dream company\"\n• \"only ping me for scores above 70\"\n• \"why was it quiet today?\"\n• paste a job link and I'll check it now\n• \"interview me\" to strengthen your profile\nI always show you the change and ask before saving.",
    options: { title: 'JobRadar', subtitle: 'Change anything in plain language. Nothing is saved until you say yes.', inputPlaceholder: 'Tell me what to change, or paste a job link…', responseMode: 'lastNode', showWelcomeScreen: false },
  }, { webhookId: CHAT_HOOK });
  a.http('🧠 Ask the helper', [260, 0], { method: 'POST', url: "={{ ($env.RENDERER_URL || 'http://renderer:3100') + '/chat' }}", sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ sessionId: $json.sessionId, message: $json.chatInput }) }}', options: { timeout: 300000 } }, { onError: 'continueRegularOutput' });
  a.code('💬 Reply', [520, 0], O.chat_reply, ['util']);
  a.link('💬 Chat with JobRadar', '🧠 Ask the helper');
  a.link('🧠 Ask the helper', '💬 Reply');
});

// ───────────────────────── LinkedIn alerts (optional) ─────────────────────────
// Reads LinkedIn's job-alert emails in your own mailbox (IMAP, nothing else) the moment they arrive and hands the jobs
// to the radar. Switched on by ./jobradar linkedin. Emails are left unread and untouched.
const LI_FROM = '[["OR", ["FROM", "jobalerts-noreply@linkedin.com"], ["FROM", "jobs-listings@linkedin.com"]]]';
const linkedin = workflow('JobRadarLnkd0001', 'JobRadar · 7 LinkedIn alerts (optional)', (a) => {
  a.sticky([-60, -300], 620, 200, '## LinkedIn job alerts → JobRadar\nYour LinkedIn alert emails, read from your own inbox as they arrive. Each job goes to the radar: found on the company\'s own job board → full screening + tailored files; not found → a title-only card linking to LinkedIn. JobRadar never opens LinkedIn pages.', 4);
  a.node('📨 LinkedIn alert emails', 'n8n-nodes-base.emailReadImap', 2.1, [0, 0], {
    mailbox: '={{ $env.LINKEDIN_MAILBOX || "INBOX" }}', postProcessAction: 'nothing', format: 'simple',
    options: { customEmailConfig: LI_FROM, trackLastMessageId: true } }, { credentials: IMAP });
  a.node('🧪 Test with pinned email', 'n8n-nodes-base.manualTrigger', 1, [0, 200], {});
  a.code('💼 Jobs in the alert', [240, 0], O.linkedin_parse, ['util', 'sources']);
  a.node('🔀 Leads or alert', 'n8n-nodes-base.switch', 3.2, [460, 0], { mode: 'expression', numberOutputs: 2, output: "={{ $json.kind === 'leads' ? 0 : 1 }}", options: {} });
  a.http('📡 Hand to the radar', [700, -100], { method: 'POST', url: "={{ ($env.JOBRADAR_SELF_URL || 'http://127.0.0.1:5678') + '/webhook/jobradar-run' }}", sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ leads: $json.leads }) }}', options: { timeout: 900000 } }, { onError: 'continueRegularOutput' });
  sendCall(a, '📣 Send parser alert', [700, 100]);
  a.link('📨 LinkedIn alert emails', '💼 Jobs in the alert');
  a.link('🧪 Test with pinned email', '💼 Jobs in the alert');
  a.link('💼 Jobs in the alert', '🔀 Leads or alert');
  a.linkOut('🔀 Leads or alert', 0, '📡 Hand to the radar');
  a.linkOut('🔀 Leads or alert', 1, '📣 Send parser alert');
});

const all = { send, radar, actions, inbox, replies, reports, chat: chatWf, linkedin };
fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'workflows'))) if (f.endsWith('.json')) fs.unlinkSync(path.join(root, 'workflows', f));
let errors = 0;
for (const [k, wf] of Object.entries(all)) {
  for (const nd of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    try { new Function('$input', '$', '$env', '$getWorkflowStaticData', `return (async function(){\n${nd.parameters.jsCode}\n})`); }
    catch (e) { console.error(`✖ ${wf.name} / ${nd.name}: ${e.message}`); errors++; }
  }
  const file = `${Object.keys(all).indexOf(k)}-${k}.json`;
  fs.writeFileSync(path.join(root, 'workflows', file), JSON.stringify(wf, null, 2));
  console.log(`✔ workflows/${file} — ${wf.nodes.length} nodes`);
}
if (errors) process.exit(1);
