// Tüm JS dosyalarının söz dizimini denetler.
// Klasik betikler: node --check <dosya>
// ES modülleri  : geçici .mjs kopyası üzerinden node --check
// Kullanım: node devtools/check.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', 'devtools', 'build', 'dist']);
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) files.push(full);
  }
}
walk(root);

const tmp = mkdtempSync(join(tmpdir(), 'vd-check-'));
let bad = 0;
let ok = 0;

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  const isModule = /^\s*(import|export)\s/m.test(src);
  let target = file;
  if (isModule) {
    target = join(tmp, rel.replace(/[\\/]/g, '_') + '.mjs');
    writeFileSync(target, src, 'utf8');
  }
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    ok++;
    console.log('  ok   ' + rel + (isModule ? '  [module]' : ''));
  } catch (err) {
    bad++;
    const out = (err.stderr || err.stdout || '').toString().trim();
    console.log('  HATA ' + rel);
    console.log(out.split('\n').slice(0, 8).join('\n'));
  }
}

console.log(ok + ' dosya geçti, ' + bad + ' hata');
process.exit(bad ? 1 : 0);
