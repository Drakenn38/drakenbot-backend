/**
 * api/validate.js
 *
 * Chamado pelo BOT toda vez que abre, pra re-confirmar a licenca.
 * (Substitui o keys.txt no fluxo novo — mais seguro pq o bot manda o machine_id)
 *
 * POST body:
 *   { "key": "XXXX-XXXX-XXXX-XXXX", "machine_id": "abc..." }
 *
 * Retorna:
 *   200 { ok:true, days_left, expires_at, name }
 *   403 { ok:false, error: "..." }
 */

import { getLicense } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { key, machine_id } = req.body || {};

  if (!key || !machine_id) {
    return res.status(400).json({ ok: false, error: 'key e machine_id sao obrigatorios' });
  }

  const cleanKey = String(key).trim().toUpperCase();
  const license = await getLicense(cleanKey);

  if (!license) {
    return res.status(403).json({ ok: false, error: 'Chave nao encontrada. Ative uma nova key.' });
  }

  if (license.active === false) {
    return res.status(403).json({ ok: false, error: 'Licenca revogada. Contate o suporte.' });
  }

  const now = new Date();
  const expiry = new Date(license.expires_at);
  if (expiry < now) {
    return res.status(403).json({ ok: false, error: 'Licenca expirada. Renove sua assinatura.' });
  }

  if (license.machine_id && license.machine_id !== machine_id) {
    return res.status(403).json({
      ok: false,
      error: 'Esta licenca esta ativada em outro PC. Contate o suporte para transferir.'
    });
  }

  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  return res.status(200).json({
    ok: true,
    name: license.name || '',
    days_left: daysLeft,
    expires_at: license.expires_at,
    plan_name: license.plan_name || null,
  });
}