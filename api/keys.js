/**
 * api/keys.js
 *
 * Endpoint publico consultado pelo BOT (mesmo formato do keys.txt antigo).
 *
 * URL: https://SEU_PROJETO.vercel.app/keys.txt
 *      (roteado via vercel.json ou acessando /api/keys direto)
 *
 * Retorna texto no formato:
 *   XXXX-XXXX-XXXX-XXXX|DD-MM-AAAA|Nome do Cliente
 *   YYYY-YYYY-YYYY-YYYY|DD-MM-AAAA|Outro Cliente
 *   ...
 *
 * Assim o bot atual (que espera esse formato) continua funcionando sem mudanca.
 */

import { listAllLicenses } from '../lib/db.js';

// Formata Date -> "DD-MM-YYYY"
function formatDate(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export default async function handler(req, res) {
  try {
    const licenses = await listAllLicenses();

    // Filtra: soh as validas (nao expiradas + nao revogadas)
    const now = new Date();
    const valid = licenses.filter(l => {
      if (l.active === false) return false;
      const expiry = new Date(l.expires_at);
      return expiry > now;
    });

    const lines = valid.map(l => {
      const date = formatDate(l.expires_at);
      const name = (l.name || '').replace(/[\r\n|]/g, ' ').trim();
      return `${l.key}|${date}|${name}`;
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(200).send(lines.join('\n') + '\n');
  } catch (err) {
    console.error('[api/keys]', err);
    return res.status(500).send('# erro interno\n');
  }
}