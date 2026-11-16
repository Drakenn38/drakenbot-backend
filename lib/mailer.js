/**
 * lib/mailer.js — Envia email pro cliente com a chave de ativacao.
 *
 * Usa SMTP (Gmail, SendGrid, Mailgun, etc).
 * Configure as vars de ambiente no Vercel:
 *   SMTP_HOST     = smtp.gmail.com
 *   SMTP_PORT     = 465
 *   SMTP_USER     = seuemail@gmail.com
 *   SMTP_PASS     = senha de app (nao a senha real do Gmail)
 *   SMTP_FROM     = "DraKEN Bot <seuemail@gmail.com>"
 *   DOWNLOAD_URL  = https://link-do-download-do-instalador.com
 */

import nodemailer from 'nodemailer';

let cached = null;
function getTransport() {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: parseInt(process.env.SMTP_PORT || '465', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return cached;
}

export async function sendActivationEmail({ to, name, key, expiresAt, planName }) {
  const transporter = getTransport();
  const downloadUrl = process.env.DOWNLOAD_URL || '#';
  const supportContact = process.env.SUPPORT_CONTACT || 'Ruan Barral';

  const firstName = (name || 'Cliente').split(' ')[0];
  const expiryDate = new Date(expiresAt).toLocaleDateString('pt-BR');

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>DraKEN Bot — Acesso Liberado</title>
</head>
<body style="margin:0;padding:0;background:#0f1218;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">

    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#a855f7;font-size:32px;margin:0;letter-spacing:2px;">🐉 DRAKEN BOT</h1>
      <p style="color:#6b7280;font-size:14px;margin:8px 0 0;">Acesso Liberado</p>
    </div>

    <div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:12px;padding:32px;">
      <h2 style="color:#fff;font-size:24px;margin:0 0 16px;">Olá, ${firstName}! 🎉</h2>

      <p style="color:#cbd5e0;font-size:15px;line-height:1.6;">
        Sua compra foi aprovada e seu acesso ao <strong>DraKEN Bot</strong> está liberado!
        ${planName ? `<br><span style="color:#a855f7;">Plano: ${planName}</span>` : ''}
      </p>

      <div style="background:#0f1218;border:1px solid #a855f7;border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
        <p style="color:#6b7280;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">
          Sua Chave de Ativação
        </p>
        <p style="color:#a855f7;font-size:22px;font-family:'Courier New',monospace;font-weight:bold;margin:0;letter-spacing:2px;">
          ${key}
        </p>
        <p style="color:#6b7280;font-size:13px;margin:12px 0 0;">
          Válida até: <strong style="color:#e2e8f0;">${expiryDate}</strong>
        </p>
      </div>

      <div style="background:#0f1218;border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="color:#fff;font-size:16px;margin:0 0 12px;">📥 Como instalar:</h3>
        <ol style="color:#cbd5e0;font-size:14px;line-height:1.8;padding-left:20px;margin:0;">
          <li>Baixe o instalador no link abaixo</li>
          <li>Execute o arquivo <code style="background:#2d3748;padding:2px 6px;border-radius:4px;">DraKENBot_Setup.exe</code></li>
          <li>Se aparecer aviso do Windows, clique em <em>"Mais informações"</em> → <em>"Executar assim mesmo"</em></li>
          <li>Após instalar, abra o bot pelo atalho na área de trabalho</li>
          <li>Cole sua chave acima e clique em <strong>"Ativar"</strong></li>
        </ol>
      </div>

      <div style="text-align:center;margin:32px 0;">
        <a href="${downloadUrl}"
           style="display:inline-block;background:#a855f7;color:white;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
          📥 BAIXAR O BOT
        </a>
      </div>

      <div style="border-top:1px solid #2d3748;padding-top:24px;margin-top:32px;">
        <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
          ⚠️ <strong>Importante:</strong> Sua licença fica travada ao PC onde você ativar.
          Se precisar trocar de computador, entre em contato conosco.
        </p>
      </div>

    </div>

    <div style="text-align:center;margin-top:24px;color:#6b7280;font-size:13px;">
      <p style="margin:4px 0;">Precisa de ajuda? Fale conosco:</p>
      <p style="margin:4px 0;color:#a855f7;">${supportContact}</p>
      <p style="margin:16px 0 0;font-size:11px;color:#4a5568;">© ${new Date().getFullYear()} DraKEN Bot — Todos os direitos reservados</p>
    </div>

  </div>
</body>
</html>`;

  const text = `
DraKEN Bot — Acesso Liberado

Olá, ${firstName}!

Sua compra foi aprovada e seu acesso ao DraKEN Bot está liberado!
${planName ? `Plano: ${planName}\n` : ''}

═══════════════════════════════════════
SUA CHAVE DE ATIVAÇÃO
${key}
Válida até: ${expiryDate}
═══════════════════════════════════════

COMO INSTALAR:
1. Baixe o instalador: ${downloadUrl}
2. Execute o arquivo DraKENBot_Setup.exe
3. Se aparecer aviso do Windows, clique em "Mais informações" → "Executar assim mesmo"
4. Abra o bot pelo atalho da área de trabalho
5. Cole sua chave acima e clique em "Ativar"

IMPORTANTE: Sua licença fica travada ao PC onde você ativar.
Se precisar trocar de computador, entre em contato conosco.

Precisa de ajuda? ${supportContact}
`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: '🐉 DraKEN Bot — Seu acesso está pronto!',
    text,
    html,
  });
}

export async function sendRenewalEmail({ to, name, key, expiresAt }) {
  const transporter = getTransport();
  const firstName = (name || 'Cliente').split(' ')[0];
  const expiryDate = new Date(expiresAt).toLocaleDateString('pt-BR');

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: '✅ DraKEN Bot — Assinatura Renovada',
    html: `
      <div style="font-family:Arial;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#a855f7;">🎉 Assinatura renovada, ${firstName}!</h2>
        <p>Seu acesso ao DraKEN Bot foi renovado automaticamente.</p>
        <p><strong>Chave:</strong> ${key}<br>
           <strong>Válida até:</strong> ${expiryDate}</p>
        <p>Continue usando normalmente. Nenhuma ação é necessária.</p>
      </div>
    `,
  });
}