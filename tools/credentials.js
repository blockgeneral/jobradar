// Prints n8n credentials (SMTP + IMAP) built from environment variables, for `n8n import:credentials`.
// Values are encrypted by n8n on import. Blank values are fine when email isn't used.
const e = process.env;
const port = (v, d) => Number(v || d);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));
const smtpPort = port(e.SMTP_PORT, 465);
console.log(JSON.stringify([
  { id: 'JobRadarSmtp0001', name: 'JobRadar SMTP', type: 'smtp', data: {
    user: e.SMTP_USER || '', password: e.SMTP_PASS || '', host: e.SMTP_HOST || 'smtp.gmail.com', port: smtpPort,
    secure: bool(e.SMTP_SECURE, smtpPort === 465), disableStartTls: bool(e.SMTP_DISABLE_STARTTLS, false), hostName: '' } },
  { id: 'JobRadarImap0001', name: 'JobRadar IMAP', type: 'imap', data: {
    user: e.IMAP_USER || e.SMTP_USER || '', password: e.IMAP_PASS || e.SMTP_PASS || '', host: e.IMAP_HOST || 'imap.gmail.com',
    port: port(e.IMAP_PORT, 993), secure: bool(e.IMAP_SECURE, true), allowUnauthorizedCerts: false } },
]));
