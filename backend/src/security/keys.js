import keytar from 'keytar';
import crypto from 'crypto';

const SERVICE = 'PontoCertoLocal';
const ACCOUNT_MASTER = 'master-key';
const ACCOUNT_SALT = 'salt';

export async function getOrCreateMaster() {
  let key = await keytar.getPassword(SERVICE, ACCOUNT_MASTER);
  if (!key) {
    key = crypto.randomBytes(32).toString('base64'); // 256-bit
    await keytar.setPassword(SERVICE, ACCOUNT_MASTER, key);
  }
  let salt = await keytar.getPassword(SERVICE, ACCOUNT_SALT);
  if (!salt) {
    salt = crypto.randomBytes(16).toString('base64');
    await keytar.setPassword(SERVICE, ACCOUNT_SALT, salt);
  }
  return {
    key: Buffer.from(key, 'base64'),
    salt: Buffer.from(salt, 'base64'),
  };
}
