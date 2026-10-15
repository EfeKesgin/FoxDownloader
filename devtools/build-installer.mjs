// FoxDownloader - dagitim EXE'lerini uretir.
//
// Kullanim : node devtools/build-installer.mjs
// Girdiler : manifest.json, src/, icons/, helper/ (uretici betikler),
//            installer/src/*.cs
// Cikti    : dist/FoxDownloader-Kur.exe
//            dist/FoxDownloader-Kaldir.exe
//
// Kur.exe     : gomulu PowerShell kurulum betigini arayuzle calistirir,
//               eklentiyi %LOCALAPPDATA%\FoxDownloader\Eklenti'e cikarir.
// Kaldir.exe  : servisi, kayitlari ve eklenti klasorunu kaldirir.
// Ikisi de sessiz calisir: /sessiz

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const build = join(root, 'build');
const dist = join(root, 'dist');

function fail(msg) {
  console.error('');
  console.error('HATA: ' + msg);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (r.error) fail(r.error.message);
  if (r.status !== 0) fail('Komut basarisiz (' + r.status + '): ' + cmd);
}

// ---------------------------------------------------------------------------
// 1) Yardimci uretici betikleri yenile (PS1'ler eklenti + EXE icine gomulur)
// ---------------------------------------------------------------------------
console.log('==> Yardimci kurulum betikleri uretiliyor...');
run(process.execPath, [join(root, 'devtools', 'build-helper.mjs')]);

// ---------------------------------------------------------------------------
// 2) Eklenti staging klasoru + zip
// ---------------------------------------------------------------------------
console.log('==> Eklenti paketleniyor...');
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
const stage = join(build, 'eklenti');
mkdirSync(stage, { recursive: true });

copyFileSync(join(root, 'manifest.json'), join(stage, 'manifest.json'));
cpSync(join(root, 'src'), join(stage, 'src'), { recursive: true });
cpSync(join(root, 'icons'), join(stage, 'icons'), { recursive: true });
mkdirSync(join(stage, 'helper'), { recursive: true });
const helperFiles = [
  'FoxDownloader-Yardimci-Kur.cmd',
  'FoxDownloader-Yardimci-Kur.ps1',
  'FoxDownloader-Yardimci-Kaldir.cmd',
  'FoxDownloader-Yardimci-Kaldir.ps1'
];
for (const f of helperFiles) {
  const src = join(root, 'helper', f);
  if (!existsSync(src)) fail('Yardimci dosya bulunamadi: helper/' + f);
  copyFileSync(src, join(stage, 'helper', f));
}
if (existsSync(join(root, 'README.md'))) {
  copyFileSync(join(root, 'README.md'), join(stage, 'README.md'));
}

const zip = join(build, 'FoxEklenti.zip');
const zipCmd =
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
  "[IO.Compression.ZipFile]::CreateFromDirectory('" + stage + "', '" + zip +
  "', [IO.Compression.CompressionLevel]::Optimal, $false)";
run('powershell.exe', ['-NoProfile', '-Command', zipCmd]);
if (!existsSync(zip)) fail('Eklenti zip olusturulamadi.');

// ---------------------------------------------------------------------------
// 3) Fox ikonundan EXE ikonu (.ico) uret
// ---------------------------------------------------------------------------
console.log('==> Ikon hazirlaniyor...');
const ico = join(build, 'fox.ico');
writeIco(join(root, 'icons', 'icon128.png'), ico);

// PNG verisini tek girdili ICO dosyasina sarar (Vista+ PNG-ICO destegi).
function writeIco(pngPath, icoPath) {
  const png = readFileSync(pngPath);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(128, 0); // width
  entry.writeUInt8(128, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // data offset
  writeFileSync(icoPath, Buffer.concat([header, entry, png]));
}

// ---------------------------------------------------------------------------
// 4) csc (yerel C# derleyici) bul
// ---------------------------------------------------------------------------
const win = process.env.WINDIR || 'C:\\Windows';
const cscCandidates = [
  join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
];
const csc = cscCandidates.find(existsSync);
if (!csc) fail('.NET derleyicisi (csc.exe) bulunamadi.');

// Referanslar: framework klasorunde olanlari tam yolla ver.
const fwDir = dirname(csc);
const refNames = [
  'System.dll',
  'System.Drawing.dll',
  'System.Windows.Forms.dll',
  'System.IO.Compression.dll',
  'System.IO.Compression.FileSystem.dll'
];
const refs = refNames.map((n) => {
  const p = join(fwDir, n);
  return existsSync(p) ? p : n;
});

// ---------------------------------------------------------------------------
// 5) EXE'leri derle
// ---------------------------------------------------------------------------
console.log('==> EXE dosyalari derleniyor...');
mkdirSync(dist, { recursive: true });

const commonArgs = [
  '/nologo',
  '/optimize+',
  '/target:winexe',
  '/codepage:65001',
  '/win32icon:' + ico,
  ...refs.map((r) => '/r:' + r)
];

// Kur.exe : ortak katman + kurulum arayuzu + gomulu betik ve eklenti zip'i
run(csc, [
  ...commonArgs,
  '/out:' + join(dist, 'FoxDownloader-Kur.exe'),
  '/resource:' + zip + ',FoxEklenti.zip',
  '/resource:' + join(root, 'helper', 'FoxDownloader-Yardimci-Kur.ps1') + ',FoxKur.ps1',
  join(root, 'installer', 'src', 'Common.cs'),
  join(root, 'installer', 'src', 'FoxKur.cs')
]);

// Kaldir.exe : ortak katman + kaldirma arayuzu + gomulu kaldirma betigi
run(csc, [
  ...commonArgs,
  '/out:' + join(dist, 'FoxDownloader-Kaldir.exe'),
  '/resource:' + join(root, 'helper', 'FoxDownloader-Yardimci-Kaldir.ps1') + ',FoxKaldir.ps1',
  join(root, 'installer', 'src', 'Common.cs'),
  join(root, 'installer', 'src', 'FoxKaldir.cs')
]);

// ---------------------------------------------------------------------------
// 6) Ozet
// ---------------------------------------------------------------------------
function sizeMb(p) {
  return (statSync(p).size / (1024 * 1024)).toFixed(2) + ' MB';
}

console.log('');
console.log('Hazir:');
console.log('  dist/FoxDownloader-Kur.exe     ' + sizeMb(join(dist, 'FoxDownloader-Kur.exe')));
console.log('  dist/FoxDownloader-Kaldir.exe  ' + sizeMb(join(dist, 'FoxDownloader-Kaldir.exe')));
console.log('');
console.log('Not: TEST icin "FoxDownloader-Kur.exe /sessiz" kullanilabilir.');
