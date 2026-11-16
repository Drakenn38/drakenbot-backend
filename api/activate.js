/**
 * api/activate.js
 *
 * Endpoint chamado pelo BOT quando o cliente cola a chave e clica em "Ativar".
 *
 * POST body JSON:
 *   { "key": "XXXX-XXXX-XXXX-XXXX", "machine_id": "abc123..." }
 *
 * Retorna:
 *   200 { ok:true, name, expires_at, days_left }  → sucesso
 *   403 { ok:false, error: "..." }                → chave invalida/travada em outro PC
 *
 * Regras:
 * - Se a chave ainda nao foi ativada, trava no machine_id enviado.
 * - Se ja foi ativada NESSE PC, ok.
 * - Se ja foi ativada em OUTRO PC, rejeita.
 * - Se estiver expirada ou revogada, rejeita.
 */

import { getLicense, saveLicense } from '../lib/db.js';

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
    return res.status(403).json({ ok: false, error: 'Chave nao encontrada' });
  }

  if (license.active === false) {
    return res.status(403).json({
      ok: false,
      error: `Licenca revogada (${license.revoked_reason || 'motivo nao especificado'})`
    });
  }

  const now = new Date();
  const expiry = new Date(license.expires_at);
  if (expiry < now) {
    return res.status(403).json({ ok: false, error: 'Licenca expirada' });
  }

  // Machine binding
  if (license.machine_id && license.machine_id !== machine_id) {
    return res.status(403).json({
      ok: false,
      error: 'Esta chave ja foi ativada em outro computador. '
           + 'Cada licenca e vinculada a UM unico PC. '
           + 'Entre em contato com o suporte se voce trocou de maquina.'
    });
  }

  // Trava no PC (primeira ativacao) ou reafirma (mesma maquina)
  if (!license.machine_id) {
    license.machine_id = machine_id;
    license.activated_at = now.toISOString();
    await saveLicense(cleanKey, license);
    console.log(`[activate] Chave ${cleanKey} ativada em ${machine_id}`);
  }

  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  return res.status(200).json({
    ok: true,
    name: license.name || '',
    email: license.email || '',
    expires_at: license.expires_at,
    days_left: daysLeft,
    plan_name: license.plan_name || null,
  });
}