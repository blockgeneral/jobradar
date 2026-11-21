// Minimal SMTP sink for tests: accepts AUTH PLAIN/LOGIN, stores each message as JSON lines.
const net = require('net'); const fs = require('fs');
const port = Number(process.argv[2] || 2526); const out = process.argv[3] || '/tmp/smtp.jsonl';
net.createServer((sock) => {
  let data = false, buf = '', msg = '', auth = 0;
  const w = (l) => sock.write(l + '\r\n');
  w('220 sink ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString('latin1');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; fs.appendFileSync(out, JSON.stringify({ raw: msg }) + '\n'); msg = ''; w('250 OK queued'); }
        else msg += (line.startsWith('..') ? line.slice(1) : line) + '\n';
        continue;
      }
      if (auth === 1) { auth = 2; w('334 UGFzc3dvcmQ6'); continue; }
      if (auth === 2) { auth = 0; w('235 Authentication successful'); continue; }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { w('250-sink'); w('250-AUTH PLAIN LOGIN'); w('250 8BITMIME'); }
      else if (cmd === 'HELO') w('250 sink');
      else if (cmd === 'AUTH') { if (/LOGIN/i.test(line)) { auth = 1; w('334 VXNlcm5hbWU6'); } else w('235 Authentication successful'); }
      else if (cmd === 'MAIL' || cmd === 'RCPT' || cmd === 'RSET' || cmd === 'NOOP') w('250 OK');
      else if (cmd === 'DATA') { data = true; w('354 go'); }
      else if (cmd === 'QUIT') { w('221 bye'); sock.end(); }
      else w('250 OK');
    }
  });
}).listen(port, () => console.log('smtp sink on', port));
