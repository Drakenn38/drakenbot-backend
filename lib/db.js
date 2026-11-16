/**
 * lib/db.js — Wrapper do Vercel KV (Redis) pra guardar licencas.
 *
 * Estrutura no KV:
 *   key:{CHAVE}        -> objeto da licenca completo
 *   email:{email}      -> chave (index reverso pra buscar por email)
 *   sale:{sale_id}     -> chave (index pra evitar duplicacao)
 *
 * 1 sale_id = 1 licenca = 1 key.
 */

import { kv } from '@vercel/kv';

// Cria/atualiza uma licenca
export async function saveLicense(key, data) {
  await kv.set(`key:${key}`, data);

  // Index reverso: email -> key
  if (data.email) {
    await kv.set(`email:${data.email.toLowerCase()}`, key);
  }

  // Index reverso: sale_id -> key (pra webhooks futuros do mesmo sale)
  if (data.sale_id) {
    await kv.set(`sale:${data.sale_id}`, key);
  }
}

// Busca licenca pela key
export async function getLicense(key) {
  return await kv.get(`key:${key}`);
}

// Busca licenca pelo email
export async function getLicenseByEmail(email) {
  const key = await kv.get(`email:${email.toLowerCase()}`);
  if (!key) return null;
  const data = await kv.get(`key:${key}`);
  return data ? { key, ...data } : null;
}

// Busca licenca pelo sale_id (usado pelos webhooks de eventos posteriores)
export async function getLicenseBySaleId(saleId) {
  const key = await kv.get(`sale:${saleId}`);
  if (!key) return null;
  const data = await kv.get(`key:${key}`);
  return data ? { key, ...data } : null;
}

// Revoga uma licenca (mantem no banco pra historico mas marca inativa)
export async function revokeLicense(key, reason = 'unknown') {
  const data = await kv.get(`key:${key}`);
  if (!data) return false;
  data.active = false;
  data.revoked_at = new Date().toISOString();
  data.revoked_reason = reason;
  await kv.set(`key:${key}`, data);
  return true;
}

// Deleta licenca por completo (raro — use revoke em vez)
export async function deleteLicense(key) {
  const data = await kv.get(`key:${key}`);
  if (data) {
    if (data.email) await kv.del(`email:${data.email.toLowerCase()}`);
    if (data.sale_id) await kv.del(`sale:${data.sale_id}`);
  }
  await kv.del(`key:${key}`);
}

// Lista TODAS as licencas ativas (pro endpoint /keys.txt)
export async function listAllLicenses() {
  const keys = await kv.keys('key:*');
  const licenses = [];
  for (const k of keys) {
    const data = await kv.get(k);
    if (data && data.active !== false) {
      licenses.push({
        key: k.replace('key:', ''),
        ...data,
      });
    }
  }
  return licenses;
}

// Lista TUDO (inclusive revogadas) — pro painel admin
export async function listAllLicensesFull() {
  const keys = await kv.keys('key:*');
  const licenses = [];
  for (const k of keys) {
    const data = await kv.get(k);
    if (data) {
      licenses.push({
        key: k.replace('key:', ''),
        ...data,
      });
    }
  }
  // Ordena por data de criacao (mais recente primeiro)
  licenses.sort((a, b) => {
    const da = new Date(a.created_at || 0).getTime();
    const db = new Date(b.created_at || 0).getTime();
    return db - da;
  });
  return licenses;
}

// Estende validade de uma licenca (usado em SUBSCRIPTION_RENEWED)
export async function extendLicense(key, extraDays) {
  const data = await kv.get(`key:${key}`);
  if (!data) return false;

  const currentExpiry = new Date(data.expires_at);
  const now = new Date();
  // Se ja expirou, comeca a contar de hoje
  const base = currentExpiry > now ? currentExpiry : now;
  base.setDate(base.getDate() + extraDays);

  data.expires_at = base.toISOString();
  data.active = true;  // reativa se estava expirada
  data.last_renewed = new Date().toISOString();

  await kv.set(`key:${key}`, data);
  return true;
}
