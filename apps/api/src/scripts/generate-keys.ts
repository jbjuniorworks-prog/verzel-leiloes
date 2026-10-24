/**
 * Gera segredos novos para produção. Uso: npm run keys:generate
 * Guarde a AUDIT_PRIVATE_KEY com cuidado: trocá-la invalida a verificação de todo o
 * histórico já assinado (a chave pública publicada muda).
 */
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';

const seed = randomBytes(32);
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);

console.log(`JWT_SECRET="${randomBytes(48).toString('base64url')}"`);
console.log(`AUDIT_PRIVATE_KEY="${seed.toString('base64')}"`);
console.log(`PSEUDONYM_SECRET="${randomBytes(32).toString('base64url')}"`);
console.log(`\n# Chave pública correspondente (aparece na página de auditoria): ${publicKey.toString('base64')}`);
