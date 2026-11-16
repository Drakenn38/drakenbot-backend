/**
 * api/admin.js
 *
 * Endpoint privado pra voce administrar as licencas.
 * Protegido por senha via query string: ?admin_key=XXX
 *
 * Configure ADMIN_PASSWORD nas env vars do Vercel.
 *
 * Endpoints:
 *   GET  /api/admin?admin_key=XXX                       → lista tudo (JSON)
 *   GET  /api/admin?admin_key=XXX&format=html           → painel HTML bonito
 *   POST /api/admin?admin_key=XXX&action=revoke&key=Y   → revoga uma licenca
 *   POST /api/admin?admin_key=XXX&action=extend&key=Y&days=30 → estende
 *   POST /api/admin?admin_key=XXX&action=create&email=x&name=y&days=30 → cria manual
 *   POST /api/admin?admin_key=XXX&action=reset_machine&key=Y → libera o PC
 */

import {
  listAllLicensesFull,
  getLicense,
  saveLicense,
  revokeLicense,
  extendLicense,
} from '../lib/db.js';
import { generateKey } from '../lib/keygen.js';
import { sendActivationEmail } from '../lib/mailer.js';

function checkAuth(req) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return { ok: false, error: 'ADMIN_PASSWORD nao configurado no Vercel' };
  const provided = req.query.admin_key || req.headers['x-admin-key'] || '';
  if (provided !== password) return { ok: false, error: 'Senha incorreta' };
  return { ok: true };
}

function renderHTML(licenses) {
  const now = Date.now();

  const rows = licenses.map(l => {
    const expiry = new Date(l.expires_at);
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    let status, statusColor;
    if (l.active === false) {
      status = `Revogada (${l.revoked_reason || '?'})`;
      statusColor = '#ef4444';
    } else if (daysLeft < 0) {
      status = 'Expirada';
      statusColor = '#f59e0b';
    } else if (daysLeft < 7) {
      status = `${daysLeft}d restantes`;
      statusColor = '#f59e0b';
    } else {
      status = `${daysLeft}d restantes`;
      statusColor = '#10b981';
    }

    const activated = l.activated_at
      ? `<span style="color:#10b981;">✓ ${new Date(l.activated_at).toLocaleDateString('pt-BR')}</span>`
      : '<span style="color:#6b7280;">Pendente</span>';

    return `
      <tr>
        <td style="padding:8px;font-family:monospace;font-size:12px;color:#a855f7;">${l.key}</td>
        <td style="padding:8px;font-size:13px;">${l.name || '-'}<br><span style="color:#6b7280;font-size:11px;">${l.email || ''}</span></td>
        <td style="padding:8px;font-size:12px;color:#94a3b8;">${l.plan_name || l.type || '-'}</td>
        <td style="padding:8px;font-size:12px;">${new Date(l.created_at).toLocaleDateString('pt-BR')}</td>
        <td style="padding:8px;font-size:12px;">${new Date(l.expires_at).toLocaleDateString('pt-BR')}</td>
        <td style="padding:8px;font-size:12px;color:${statusColor};font-weight:600;">${status}</td>
        <td style="padding:8px;font-size:12px;">${activated}</td>
        <td style="padding:8px;font-size:11px;">
          <button onclick="doAction('extend','${l.key}')" style="background:#3b82f6;color:white;border:0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">+30d</button>
          <button onclick="doAction('reset_machine','${l.key}')" style="background:#8b5cf6;color:white;border:0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Reset PC</button>
          ${l.active !== false
            ? `<button onclick="doAction('revoke','${l.key}')" style="background:#ef4444;color:white;border:0;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Revogar</button>`
            : ''}
        </td>
      </tr>`;
  }).join('');

  const active = licenses.filter(l => l.active !== false && new Date(l.expires_at) > now).length;
  const expired = licenses.filter(l => new Date(l.expires_at) < now).length;
  const revoked = licenses.filter(l => l.active === false).length;
  const total = licenses.length;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>DraKEN Bot Admin</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#0f1218; color:#e2e8f0; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif; padding:24px; }
  h1 { color:#a855f7; margin:0 0 24px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px; }
  .stat { background:#1a1f2e; border:1px solid #2d3748; padding:16px; border-radius:8px; }
  .stat-label { color:#6b7280; font-size:12px; text-transform:uppercase; letter-spacing:1px; }
  .stat-value { font-size:28px; font-weight:700; margin-top:4px; }
  table { width:100%; border-collapse:collapse; background:#1a1f2e; border-radius:8px; overflow:hidden; }
  th { text-align:left; padding:12px 8px; background:#2d3748; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; }
  td { border-top:1px solid #2d3748; }
  tr:hover td { background:#232937; }
  .form-create { background:#1a1f2e; padding:16px; border-radius:8px; margin-bottom:24px; border:1px solid #2d3748; }
  .form-create input { background:#0f1218; border:1px solid #2d3748; color:#fff; padding:8px 12px; border-radius:4px; margin-right:8px; font-size:13px; }
  .form-create button { background:#a855f7; color:white; border:0; padding:8px 16px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; }
</style>
</head>
<body>
  <h1>🐉 DraKEN Bot — Painel Admin</h1>

  <div class="stats">
    <div class="stat"><div class="stat-label">Total</div><div class="stat-value" style="color:#e2e8f0;">${total}</div></div>
    <div class="stat"><div class="stat-label">Ativas</div><div class="stat-value" style="color:#10b981;">${active}</div></div>
    <div class="stat"><div class="stat-label">Expiradas</div><div class="stat-value" style="color:#f59e0b;">${expired}</div></div>
    <div class="stat"><div class="stat-label">Revogadas</div><div class="stat-value" style="color:#ef4444;">${revoked}</div></div>
  </div>

  <div class="form-create">
    <strong style="color:#a855f7;">Criar licença manual:</strong><br><br>
    <input id="c-email" type="email" placeholder="email do cliente" style="width:250px;">
    <input id="c-name" type="text" placeholder="nome do cliente" style="width:200px;">
    <input id="c-days" type="number" value="30" placeholder="dias" style="width:80px;">
    <button onclick="createManual()">Criar + Enviar Email</button>
  </div>

  <table>
    <thead>
      <tr>
        <th>Chave</th>
        <th>Cliente</th>
        <th>Plano</th>
        <th>Criada</th>
        <th>Expira</th>
        <th>Status</th>
        <th>Ativação</th>
        <th>Ações</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

<script>
  const adminKey = new URLSearchParams(location.search).get('admin_key');

  async function doAction(action, key, extra = {}) {
    if (!confirm('Confirma a ação "' + action + '" para a chave ' + key + '?')) return;
    const params = new URLSearchParams({ admin_key: adminKey, action, key, ...extra });
    if (action === 'extend') params.set('days', prompt('Quantos dias adicionar?', '30') || '30');
    const r = await fetch('?' + params.toString(), { method: 'POST' });
    const j = await r.json();
    alert(j.ok ? 'OK: ' + (j.message || 'Sucesso') : 'Erro: ' + (j.error || 'desconhecido'));
    if (j.ok) location.reload();
  }

  async function createManual() {
    const email = document.getElementById('c-email').value.trim();
    const name = document.getElementById('c-name').value.trim();
    const days = document.getElementById('c-days').value || '30';
    if (!email) return alert('Digite o email');
    const params = new URLSearchParams({ admin_key: adminKey, action: 'create', email, name, days });
    const r = await fetch('?' + params.toString(), { method: 'POST' });
    const j = await r.json();
    alert(j.ok ? 'OK! Chave: ' + j.key : 'Erro: ' + (j.error || '?'));
    if (j.ok) location.reload();
  }
</script>
</body>
</html>`;
}

export default async function handler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  // POST → ações (revoke, extend, create, reset_machine)
  if (req.method === 'POST') {
    const { action, key, days, email, name } = req.query;

    try {
      if (action === 'revoke') {
        const ok = await revokeLicense(key, 'admin');
        return res.status(200).json({ ok, message: 'Licença revogada' });
      }

      if (action === 'extend') {
        const d = parseInt(days, 10) || 30;
        const ok = await extendLicense(key, d);
        return res.status(200).json({ ok, message: `Estendida por ${d} dias` });
      }

      if (action === 'reset_machine') {
        const lic = await getLicense(key);
        if (!lic) return res.status(404).json({ ok: false, error: 'Chave não encontrada' });
        lic.machine_id = null;
        lic.activated_at = null;
        await saveLicense(key, lic);
        return res.status(200).json({ ok: true, message: 'PC liberado. Cliente pode ativar em outro computador.' });
      }

      if (action === 'create') {
        if (!email) return res.status(400).json({ ok: false, error: 'email é obrigatório' });
        const d = parseInt(days, 10) || 30;
        const newKey = generateKey();
        const now = new Date();
        const expires = new Date(now);
        expires.setDate(expires.getDate() + d);

        const data = {
          email,
          name: name || '',
          document: '',
          phone: '',
          sale_id: `manual-${Date.now()}`,
          plan_name: 'Manual',
          type: 'MANUAL',
          created_at: now.toISOString(),
          expires_at: expires.toISOString(),
          active: true,
          machine_id: null,
          activated_at: null,
        };
        await saveLicense(newKey, data);

        try {
          await sendActivationEmail({ to: email, name, key: newKey, expiresAt: expires.toISOString() });
        } catch (e) {
          console.error('Email manual falhou:', e.message);
        }

        return res.status(200).json({ ok: true, key: newKey, message: 'Criada + email enviado' });
      }

      return res.status(400).json({ ok: false, error: 'Ação inválida' });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // GET → lista licenças
  try {
    const missing = ['KV_REST_API_URL', 'KV_REST_API_TOKEN']
      .filter(name => !process.env[name]?.trim());
    if (missing.length) {
      console.error('[api/admin] Variaveis do Redis ausentes:', missing.join(', '));
      return res.status(503).json({ error: 'Redis nao configurado. Consulte os logs da Vercel.' });
    }

    let licenses;
    try {
      licenses = await listAllLicensesFull();
    } catch (error) {
      const code = error.cause?.code ?? error.code;
      console.error('[api/admin] Falha ao consultar o Redis', {
        cause: typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : undefined,
        fetchFailed: error.message === 'fetch failed',
      });
      return res.status(503).json({ error: 'Falha ao consultar o Redis. Consulte os logs da Vercel.' });
    }

    if (req.query.format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderHTML(licenses));
    }

    return res.status(200).json({ total: licenses.length, licenses });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
