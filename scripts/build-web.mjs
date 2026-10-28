// index.html (CDN সংস্করণ) থেকে অফলাইন "www" ফোল্ডার তৈরি করে।
// www ফোল্ডারটাই APK-র ভেতরে যায়।
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'index.html');
const out = path.join(root, 'www');
const nm = (p) => path.join(root, 'node_modules', p);

let html = fs.readFileSync(src, 'utf8').replace(/\r/g, '');

// কোনো প্যাটার্ন না মিললে বিল্ড থেমে যাবে, যাতে চুপচাপ ভুল না হয়।
function replaceOnce(re, replacement, label) {
  const m = html.match(re);
  if (!m) throw new Error(`index.html এ "${label}" পাওয়া যায়নি। বিল্ড স্ক্রিপ্ট আপডেট দরকার।`);
  html = html.replace(re, replacement);
}

// ---------- ১. JSX আলাদা করে আগেই কম্পাইল ----------
const babelRe = /<script type="text\/babel">([\s\S]*?)<\/script>/;
const babelMatch = html.match(babelRe);
if (!babelMatch) throw new Error('<script type="text/babel"> পাওয়া যায়নি');
const jsx = babelMatch[1];

// ---------- ২. Tailwind কনফিগ ইনলাইন স্ক্রিপ্ট থেকে নেওয়া ----------
const cfgMatch = html.match(/<script>\s*tailwind\.config\s*=\s*([\s\S]*?);\s*<\/script>/);
if (!cfgMatch) throw new Error('inline tailwind.config পাওয়া যায়নি');
const twConfig = new Function(`return (${cfgMatch[1]});`)();

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const res = await build({
  stdin: { contents: jsx, loader: 'jsx', sourcefile: 'app.jsx' },
  bundle: false,
  write: false,
  format: 'iife',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: ['es2018'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
fs.writeFileSync(path.join(out, 'app.js'), res.outputFiles[0].text);

// ---------- ৩. Tailwind CSS ----------
const tmp = path.join(root, '.tw-build');
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'tailwind.config.cjs'),
  `module.exports = ${JSON.stringify({ ...twConfig, content: [src] })};`
);
fs.writeFileSync(path.join(tmp, 'input.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(
  process.execPath,
  [
    nm('tailwindcss/lib/cli.js'),
    '-c', path.join(tmp, 'tailwind.config.cjs'),
    '-i', path.join(tmp, 'input.css'),
    '-o', path.join(out, 'tailwind.css'),
    '--minify',
  ],
  { stdio: 'inherit' }
);
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- ৪. লাইব্রেরি (React, Firebase) ----------
const libs = {
  'react.production.min.js': nm('react/umd/react.production.min.js'),
  'react-dom.production.min.js': nm('react-dom/umd/react-dom.production.min.js'),
  'firebase-app-compat.js': nm('firebase/firebase-app-compat.js'),
  'firebase-firestore-compat.js': nm('firebase/firebase-firestore-compat.js'),
  'firebase-auth-compat.js': nm('firebase/firebase-auth-compat.js'),
};
for (const [name, from] of Object.entries(libs)) fs.copyFileSync(from, path.join(out, 'lib', name));

// ---------- ৫. ফন্ট (Inter, Manrope: latin; আইকন: Material Symbols) ----------
fs.copyFileSync(nm('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'), path.join(out, 'fonts/inter.woff2'));
fs.copyFileSync(nm('@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'), path.join(out, 'fonts/manrope.woff2'));
fs.copyFileSync(nm('material-symbols/material-symbols-outlined.woff2'), path.join(out, 'fonts/material-symbols-outlined.woff2'));
fs.writeFileSync(
  path.join(out, 'fonts.css'),
  `@font-face{font-family:'Inter';font-style:normal;font-display:swap;font-weight:100 900;src:url(fonts/inter.woff2) format('woff2-variations'),url(fonts/inter.woff2) format('woff2')}
@font-face{font-family:'Manrope';font-style:normal;font-display:swap;font-weight:200 800;src:url(fonts/manrope.woff2) format('woff2-variations'),url(fonts/manrope.woff2) format('woff2')}
@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:100 700;src:url(fonts/material-symbols-outlined.woff2) format('woff2')}
.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';font-feature-settings:'liga';-webkit-font-smoothing:antialiased}
`
);

// ---------- ৬. HTML ----------
// ফন্ট লিংক (preconnect + ২টা stylesheet)
replaceOnce(/<!-- Fonts & Material Symbols -->[\s\S]*?Material\+Symbols\+Outlined[^\n]*\n/, '<link rel="stylesheet" href="fonts.css">\n<link rel="stylesheet" href="tailwind.css">\n', 'Google Fonts লিংক');
// React + Babel + Tailwind CDN
replaceOnce(
  /<!-- React & Tailwind -->[\s\S]*?cdn\.tailwindcss\.com"><\/script>\n/,
  '<script src="lib/react.production.min.js"></script>\n<script src="lib/react-dom.production.min.js"></script>\n',
  'React/Babel/Tailwind CDN'
);
// Firebase
replaceOnce(
  /<!-- Firebase -->[\s\S]*?firebase-auth-compat\.js"><\/script>\n/,
  '<script src="lib/firebase-app-compat.js"></script>\n<script src="lib/firebase-firestore-compat.js"></script>\n<script src="lib/firebase-auth-compat.js"></script>\n',
  'Firebase CDN'
);
// ইনলাইন tailwind.config
replaceOnce(/<script>\s*tailwind\.config\s*=[\s\S]*?<\/script>\n/, '', 'inline tailwind.config');
// manifest.json নেই, তাই লিংক বাদ
replaceOnce(/<link rel="manifest"[^>]*>\n/, '', 'manifest লিংক');
// JSX স্ক্রিপ্ট → কম্পাইল করা app.js
replaceOnce(babelRe, '<script src="app.js"></script>', 'text/babel স্ক্রিপ্ট');

fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of ['icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(root, f), path.join(out, f));

// ---------- ৭. শেষ পরীক্ষা: বাইরের কোনো লিংক বাকি আছে কি? ----------
const left = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
if (left.length) throw new Error('বাইরের লিংক রয়ে গেছে: ' + left.join(', '));

const kb = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB';
console.log('✔ www তৈরি হয়েছে');
for (const f of ['index.html', 'app.js', 'tailwind.css', 'fonts/material-symbols-outlined.woff2', 'lib/firebase-firestore-compat.js']) console.log('  ', f.padEnd(42), kb(f));
