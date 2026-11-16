/**
 * api/webhook-kirvano.js
 *
 * Endpoint que recebe TODOS os webhooks da Kirvano.
 * URL a configurar na Kirvano: https://SEU_PROJETO.vercel.app/api/webhook-kirvano
 *
 * Fluxo:
 *   SALE_APPROVED (assinatura) → cria licenca + manda email
 *   SUBSCRIPTION_RENEWED       → estende validade + email
 *   SALE_REFUNDED              → revoga licenca
 *   SALE_CHARGEBACK            → revoga licenca
 *   SUBSCRIPTION_CANCELED      → deixa expirar naturalmente
 *   SUBSCRIPTION_EXPIRED       → revoga licenca
 *   Outros                     → apenas loga
 */

import { generateKey } from '../lib/keygen.js';
import {
  saveLicense,
  getLicense,
  getLicenseBySaleId,
  getLicenseByEmail,
  revokeLicense,
  extendLicense,
} from '../lib/db.js';
import { sendActivationEmail, sendRenewalEmail } from '../lib/mailer.js';

// Se o produto vendido nao for o do bot, ignora.
// Deixa vazio pra aceitar TODOS os produtos da sua conta Kirvano.
const ALLOWED_PRODUCT_IDS = (process.env.KIRVANO_PRODUCT_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Token de seguranca opcional (se voce configurou na Kirvano)
const WEBHOOK_TOKEN = process.env.KIRVANO_WEBHOOK_TOKEN || '';

// Quantidade de dias por tipo de plano/assinatura
function daysForPlan(plan, type) {
  if (type === 'RECURRING' && plan) {
    const freq = (plan.charge_frequency || '').toUpperCase();
    // Damos um pouco de margem pra evitar corte antes da renovacao
    if (freq === 'MONTHLY')   return 32;
    if (freq === 'QUARTERLY') return 95;
    if (freq === 'SEMIANNUALLY' || freq === 'SEMI_ANNUALLY') return 185;
    if (freq === 'ANNUALLY' || freq === 'YEARLY') return 370;
  }
  // Compra unica (ONE_TIME) — vitalicia? Aqui damos 10 anos (3650 dias)
  // Se voce quiser vitalicio de verdade, ajuste pra 36500 (100 anos).
  return 3650;
}

export default async function handler(req, res) {
  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validacao de token (se configurado)
  if (WEBHOOK_TOKEN) {
    // A Kirvano pode mandar o token em formatos diferentes dependendo da
    // integracao (header customizado, Authorization Bearer, ou query
    // string). Checamos todas as variantes plausiveis antes de recusar.
    const authHeader = req.headers['authorization'] || '';
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const receivedToken = req.headers['x-kirvano-token']
                       || req.headers['x-webhook-token']
                       || req.headers['x-token']
                       || req.headers['token']
                       || bearerToken
                       || req.query.token
                       || '';
    if (receivedToken !== WEBHOOK_TOKEN) {
      // Loga os headers recebidos pra diagnosticar qual formato a Kirvano
      // realmente usa, caso a causa nao seja so o valor do token em si
      // (ex: caractere especial tipo "#" sendo cortado em algum ponto do
      // caminho, por ser tratado como fragmento de URL).
      console.warn(
        `[webhook-kirvano] Token invalido. Esperado (${WEBHOOK_TOKEN.length} chars), ` +
        `recebido "${receivedToken}" (${receivedToken.length} chars). ` +
        `Headers: ${JSON.stringify(req.headers)}`
      );
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  const payload = req.body || {};
  const event = payload.event;
  const saleId = payload.sale_id;

  console.log(`[webhook-kirvano] Evento: ${event} | Sale: ${saleId}`);

  // Filtro por produto (se configurado)
  if (ALLOWED_PRODUCT_IDS.length > 0 && payload.products) {
    const productIds = payload.products.map(p => p.id);
    const matches = productIds.some(id => ALLOWED_PRODUCT_IDS.includes(id));
    if (!matches) {
      console.log(`[webhook-kirvano] Produto nao autorizado, ignorando. IDs: ${productIds.join(',')}`);
      return res.status(200).json({ ok: true, ignored: 'product_not_allowed' });
    }
  }

  try {
    switch (event) {
      // ── COMPRA APROVADA ──────────────────────────────────
      case 'SALE_APPROVED': {
        // Verifica se ja processamos esse sale antes (idempotencia)
        const existing = await getLicenseBySaleId(saleId);
        if (existing && existing.active !== false) {
          console.log(`[webhook-kirvano] Sale ${saleId} ja processada, ignorando`);
          return res.status(200).json({ ok: true, ignored: 'already_processed' });
        }

        const customer = payload.customer || {};
        const plan = payload.plan;
        const type = payload.type || 'ONE_TIME';

        // Se o mesmo email ja tem uma licenca ativa, ESTENDE em vez de criar nova
        // (evita cliente ficar com 2 chaves quando compra novamente)
        const days = daysForPlan(plan, type);
        const existingByEmail = customer.email ? await getLicenseByEmail(customer.email) : null;

        if (existingByEmail && existingByEmail.active !== false) {
          await extendLicense(existingByEmail.key, days);
          const data = await getLicense(existingByEmail.key);
          console.log(`[webhook-kirvano] Estendida ${existingByEmail.key} por ${days} dias`);

          await sendRenewalEmail({
            to: customer.email,
            name: customer.name,
            key: existingByEmail.key,
            expiresAt: data.expires_at,
          });
          return res.status(200).json({ ok: true, action: 'extended', key: existingByEmail.key });
        }

        // Cria licenca nova
        const key = generateKey();
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + days);

        const licenseData = {
          email: customer.email || '',
          name: customer.name || '',
          document: customer.document || '',
          phone: customer.phone_number || '',
          sale_id: saleId,
          checkout_id: payload.checkout_id || '',
          plan_name: plan ? plan.name : null,
          plan_frequency: plan ? plan.charge_frequency : null,
          type,
          product_ids: (payload.products || []).map(p => p.id),
          product_names: (payload.products || []).map(p => p.name),
          total_price: payload.total_price || '',
          payment_method: payload.payment_method || '',
          created_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          active: true,
          machine_id: null,   // sera preenchido quando o cliente ativar
          activated_at: null,
        };

        await saveLicense(key, licenseData);
        console.log(`[webhook-kirvano] Nova licenca criada: ${key} para ${customer.email}`);

        // Manda email com a chave
        if (customer.email) {
          try {
            await sendActivationEmail({
              to: customer.email,
              name: customer.name,
              key,
              expiresAt: expiresAt.toISOString(),
              planName: plan ? plan.name : null,
            });
            console.log(`[webhook-kirvano] Email enviado para ${customer.email}`);
          } catch (mailErr) {
            console.error(`[webhook-kirvano] Falha ao enviar email: ${mailErr.message}`);
            // Nao falha o webhook — a licenca foi criada, admin pode reenviar depois
          }
        }

        return res.status(200).json({ ok: true, action: 'created', key });
      }

      // ── RENOVACAO DE ASSINATURA ──────────────────────────
      case 'SUBSCRIPTION_RENEWED': {
        const customer = payload.customer || {};
        const plan = payload.plan;

        const license = customer.email ? await getLicenseByEmail(customer.email) : null;
        if (!license) {
          console.warn(`[webhook-kirvano] Renewal sem licenca previa: ${customer.email}`);
          return res.status(200).json({ ok: true, ignored: 'no_previous_license' });
        }

        const days = daysForPlan(plan, 'RECURRING');
        await extendLicense(license.key, days);
        const updated = await getLicense(license.key);

        console.log(`[webhook-kirvano] Renovada ${license.key} por ${days} dias`);

        try {
          await sendRenewalEmail({
            to: customer.email,
            name: customer.name,
            key: license.key,
            expiresAt: updated.expires_at,
          });
        } catch (e) {
          console.error('Email renewal falhou:', e.message);
        }

        return res.status(200).json({ ok: true, action: 'renewed', key: license.key });
      }

      // ── REEMBOLSO / CHARGEBACK / EXPIRADO ────────────────
      case 'SALE_REFUNDED':
      case 'SALE_CHARGEBACK':
      case 'SUBSCRIPTION_EXPIRED': {
        const license = await getLicenseBySaleId(saleId);
        if (!license) {
          const email = payload.customer?.email;
          const byEmail = email ? await getLicenseByEmail(email) : null;
          if (!byEmail) {
            return res.status(200).json({ ok: true, ignored: 'license_not_found' });
          }
          await revokeLicense(byEmail.key, event.toLowerCase());
          console.log(`[webhook-kirvano] Revogada por email: ${byEmail.key}`);
          return res.status(200).json({ ok: true, action: 'revoked', key: byEmail.key });
        }
        await revokeLicense(license.key, event.toLowerCase());
        console.log(`[webhook-kirvano] Revogada por sale_id: ${license.key}`);
        return res.status(200).json({ ok: true, action: 'revoked', key: license.key });
      }

      // ── ASSINATURA CANCELADA ─────────────────────────────
      // Nao revogamos imediatamente — deixamos a licenca expirar naturalmente,
      // o cliente ja pagou o mes corrente.
      case 'SUBSCRIPTION_CANCELED': {
        console.log(`[webhook-kirvano] Assinatura cancelada (deixando expirar): ${payload.customer?.email}`);
        return res.status(200).json({ ok: true, action: 'noted' });
      }

      // ── OUTROS EVENTOS (ignorados) ───────────────────────
      // PIX_GENERATED, BANK_SLIP_GENERATED, PIX_EXPIRED,
      // BANK_SLIP_EXPIRED, SALE_REFUSED, CART_ABANDONED, etc.
      default:
        console.log(`[webhook-kirvano] Evento nao processado: ${event}`);
        return res.status(200).json({ ok: true, ignored: 'event_not_handled', event });
    }
  } catch (err) {
    console.error(`[webhook-kirvano] Erro:`, err);
    // Retornamos 200 mesmo assim pra Kirvano nao ficar retentando
    return res.status(200).json({ ok: false, error: err.message });
  }
}