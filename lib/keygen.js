/**
 * lib/keygen.js — Gera chaves de ativacao aleatorias.
 * Formato: XXXX-XXXX-XXXX-XXXX (4 blocos de 4 letras/numeros)
 * Usa caracteres sem ambiguidade visual (sem O/0 e I/1).
 */

import { randomBytes } from 'crypto';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/I/1

export function generateKey() {
  const blocks = [];
  for (let b = 0; b < 4; b++) {
    let block = '';
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) {
      block += CHARS[bytes[i] % CHARS.length];
    }
    blocks.push(block);
  }
  return blocks.join('-'); // ex: X7K2-M9P4-QRT8-B5CF
}