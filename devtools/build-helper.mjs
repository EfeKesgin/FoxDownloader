// Yardımcı kurulum/kaldırma dosyalarını üretir.
//
// Girdi : helper/src/ythelper.cs, helper/src/install.tmpl.ps1, helper/src/uninstall.tmpl.ps1
// Çıktı : helper/FoxDownloader-Yardimci-Kur.ps1 / .cmd
//         helper/FoxDownloader-Yardimci-Kaldir.ps1 / .cmd
//
// C# kaynağı kurulum .ps1 dosyasına gömülür (tek doğruluk kaynağı: ythelper.cs).
// Kullanım: node devtools/build-helper.mjs [--check]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const check = process.argv.includes('--check');

const keyFile = join(here, 'extension-id.json');
if (!existsSync(keyFile)) {
  console.error('devtools/extension-id.json yok. Önce: node devtools/make-extension-key.mjs');
  process.exit(1);
}
const extensionId = JSON.parse(readFileSync(keyFile, 'utf8')).id;

const csSource = readFileSync(join(root, 'helper', 'src', 'ythelper.cs'), 'utf8');
const installTmpl = readFileSync(join(root, 'helper', 'src', 'install.tmpl.ps1'), 'utf8');
const uninstallTmpl = readFileSync(join(root, 'helper', 'src', 'uninstall.tmpl.ps1'), 'utf8');

const crlf = (s) => s.replace(/\r?\n/g, '\r\n').replace(/\r\n+$/, '\r\n');

function renderPs(tmpl, { withCs }) {
  let out = tmpl;
  if (withCs) {
    if (!out.includes('__CS_SOURCE__')) throw new Error('C# yer tutucusu bulunamadı');
    out = out.replace('__CS_SOURCE__', csSource.replace(/\r?\n+$/, ''));
  }
  if (!out.includes('__EXTENSION_ID__') && withCs) throw new Error('kimlik yer tutucusu bulunamadı');
  return crlf(out.replace(/__EXTENSION_ID__/g, extensionId));
}

const installPs = renderPs(installTmpl, { withCs: true });
const uninstallPs = renderPs(uninstallTmpl, { withCs: false });

function wrapperCmd(psName) {
  return crlf(
    [
      '@echo off',
      'chcp 65001 >nul',
      'setlocal',
      'set "VDH_ARGS=%*"',
      'if not exist "%~dp0' + psName + '" (',
      '    echo.',
      '    echo   HATA: ' + psName + ' bulunamadi.',
      '    echo   Iki dosya da ayni klasorde olmali ^(genellikle Indirilenler^).',
      '    echo.',
      '    pause',
      '    exit /b 1',
      ')',
      'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0' + psName + '"',
      'set "RC=%ERRORLEVEL%"',
      'if not "%RC%"=="0" goto vdFail',
      'exit /b 0',
      ':vdFail',
      'echo.',
      'echo   PowerShell hata kodu: %RC%',
      'pause',
      'exit /b 1',
      ''
    ].join('\n')
  );
}

const outputs = [
  ['helper/FoxDownloader-Yardimci-Kur.ps1', installPs],
  ['helper/FoxDownloader-Yardimci-Kaldir.ps1', uninstallPs],
  ['helper/FoxDownloader-Yardimci-Kur.cmd', wrapperCmd('FoxDownloader-Yardimci-Kur.ps1')],
  ['helper/FoxDownloader-Yardimci-Kaldir.cmd', wrapperCmd('FoxDownloader-Yardimci-Kaldir.ps1')]
];

let changed = 0;
for (const [rel, content] of outputs) {
  const path = join(root, rel);
  const bom = '\uFEFF';
  const old = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const next = rel.endsWith('.ps1') ? bom + content : content;
  if (old === next) continue;
  changed++;
  if (check) {
    console.log('FARKLI: ' + rel);
  } else {
    writeFileSync(path, next, 'utf8');
    console.log('yazıldı: ' + rel);
  }
}

console.log(
  (check ? 'kontrol bitti' : 'üretim bitti') +
    ' — ' + changed + ' dosya ' + (check ? 'güncel değil' : 'güncellendi') +
    ' (eklenti kimliği: ' + extensionId + ')'
);
process.exit(check && changed ? 1 : 0);
