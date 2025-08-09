import crypto from 'crypto';
import fs from 'fs/promises';

const MAGIC = Buffer.from('ENC1'); // versão

export async function encryptToFile(key, plaintextBuffer, outPath) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([MAGIC, iv, tag, enc]);
  await fs.writeFile(outPath, payload, { mode: 0o600 });
}

export async function decryptFromFile(key, inPath) {
  const payload = await fs.readFile(inPath);
  if (payload.length < 4 + 12 + 16) throw new Error('arquivo inválido');
  const magic = payload.subarray(0, 4);
  if (!magic.equals(MAGIC)) throw new Error('formato desconhecido');
  const iv = payload.subarray(4, 16);
  const tag = payload.subarray(16, 32);
  const enc = payload.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
