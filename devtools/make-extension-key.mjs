// Sabit eklenti kimliği (ID) üretir.
//
// Native messaging host'unun "allowed_origins" alanı eklenti kimliğini bilmek
// zorunda. Paketlenmemiş (unpacked) eklentilerde kimlik normalde klasör yoluna
// göre değişir; manifest.json içindeki "key" alanı kimliği sabitler.
//
// Kullanım: node devtools/make-extension-key.mjs
// Çıktı: devtools/extension-key.json (özel anahtar dahil - SADECE geliştirme içindir)

import { generateKeyPairSync, createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, 'extension-key.json');

function idFromSpki(spkiDer) {
  const hash = createHash('sha256').update(spkiDer).digest();
  const alphabet = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += alphabet[hash[i] >> 4] + alphabet[hash[i] & 0xf];
  }
  return id;
}

if (existsSync(outFile) && !process.argv.includes('--force')) {
  const existing = JSON.parse(readFileSync(outFile, 'utf8'));
  console.log('Mevcut anahtar kullanılıyor.');
  console.log('Kimlik : ' + existing.id);
  console.log('Key    : ' + existing.key);
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const key = publicKey.toString('base64');
const id = idFromSpki(publicKey);

writeFileSync(
  outFile,
  JSON.stringify({ id, key, privateKeyPem: privateKey, createdAt: new Date().toISOString() }, null, 2),
  'utf8'
);

console.log('Kimlik : ' + id);
console.log('Key    : ' + key);
console.log('Yazıldı: ' + outFile);
