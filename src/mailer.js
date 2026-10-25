// Envia os pedidos dos formulários por email (SMTP). Devolve false se não estiver configurado ou falhar.
const config = require('./config');

let transport = null;

async function send({ subject, text, replyTo }) {
  const { host, port, user, pass, to } = config.mail;
  if (!host || !user || !pass) {
    console.log(`[mail] SMTP não configurado; pedido não enviado por email: ${subject}`);
    return false;
  }
  try {
    if (!transport) {
      const nodemailer = require('nodemailer');
      transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    }
    await transport.sendMail({ from: `"Site ${config.stand.name}" <${user}>`, to, replyTo, subject, text });
    return true;
  } catch (err) {
    console.error(`[mail] falhou: ${err.message}`);
    return false;
  }
}

module.exports = { send };
