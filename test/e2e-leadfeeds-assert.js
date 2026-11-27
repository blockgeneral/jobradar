// Checks the lead-feed run at the end of test/e2e.sh (what workflow 8 hands to the radar).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const T = process.argv[2];
const ok = (m) => console.log('  ✔ ' + m);
const msgs = fs.readFileSync(path.join(T, 'mock/telegram_messages.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const kb = (m) => (m.reply_markup && m.reply_markup.inline_keyboard || []).flat();
const albums = fs.readFileSync(path.join(T, 'mock/telegram_albums.jsonl'), 'utf8');
const vc = msgs.filter((m) => /PortfolioCo/.test(m.text || ''));
assert(vc.length === 1 && kb(vc[0]).some((b) => /Apply/.test(b.text) && /ashbyhq\.com\/portfolioco\/501\/application/.test(b.url)), 'PortfolioCo card ' + JSON.stringify(vc));
assert(/PortfolioCo/.test(albums), 'PortfolioCo files');
ok('VC portfolio board lead → posting read from the board\'s job page → full card, tailored files, Apply = the company\'s own form');
const jg = msgs.filter((m) => /\bFeedCo\b/.test(m.text || ''));
assert(jg.length === 1 && /from the title only/.test(jg[0].text) && kb(jg[0]).some((b) => b.text === '🔗 Open on Jobgether' && b.url === 'https://jobgether.com/offer/jg-1'), 'Jobgether card ' + JSON.stringify(jg));
assert(!/\bFeedCo\b/.test(albums), 'no files for the Jobgether title-only card');
ok('Jobgether lead not on a public board → title-only card linking to Jobgether, nothing tailored');
const status = fs.readFileSync(path.join(T, 'out/.jobradar/status.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert(status.some((s) => s.part === 'normalize' && s.stats && s.stats.leadFeed === 2 && s.stats.leadFeedMatched === 1), 'lead-feed stats ' + JSON.stringify(status.filter((s) => s.part === 'normalize').slice(-1)));
ok('lead-feed numbers reach the chat status');
if (process.argv[3] === 'workflow8') {
  const vc8 = msgs.filter((m) => /VCFeedCo/.test(m.text || ''));
  assert(vc8.length === 1 && kb(vc8[0]).some((b) => /Apply/.test(b.text) && b.url === 'https://vcfeedco.example/jobs/777'), 'workflow 8 VC card ' + JSON.stringify(vc8) + '\n' + fs.readFileSync(path.join(T, 'lead-exec.log'), 'utf8').slice(-1500));
  ok('workflow 8 read a VC board sitemap (title-filtered: the data-engineer job stayed out) → radar → full card');
  const jg8 = msgs.filter((m) => /SitemapCo/.test(m.text || ''));
  assert(jg8.length === 1 && !/Backend/.test(jg8[0].text), 'workflow 8 Jobgether card ' + JSON.stringify(jg8));
  ok('workflow 8 read Jobgether (the engineer role filtered out by title) → radar → one card');
  console.log('\nWORKFLOW 8 E2E PASSED'); process.exit(0);
}
console.log('\nLEAD FEEDS E2E PASSED');
