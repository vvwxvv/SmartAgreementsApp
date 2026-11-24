#!/usr/bin/env node
/**
 * scripts/subset-fonts.mjs  (P2-1)
 *
 * Downloads the upstream variable fonts (SIL OFL 1.1), subsets them to the
 * characters this app actually prints, and writes woff2 files to public/fonts.
 * The full TTFs never enter the repo. Idempotent unless --force.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const outDir = path.join(repo, 'public', 'fonts');
const force = process.argv.includes('--force');
await fsp.mkdir(outDir, { recursive: true });

const FONTS = [
  {
    name: 'NotoSansSC',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
    out: 'NotoSansSC-subset.woff2',
  },
  {
    name: 'NotoSerifSC',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf',
    out: 'NotoSerifSC-subset.woff2',
  },
];

const sources = [
  'src/data/collections/Agreement.json',
  'src/data/collections/AgreementSigner.json',
  'src/data/collections/SigningEvent.json',
  'src/components/pages/agreements/AgreementPrintPageComponent.jsx',
  'src/agreement/layoutConfig.js',
  'src/lib/agreementI18n.js',
];
let text = '';
for (const rel of sources) {
  const p = path.join(repo, rel);
  if (fs.existsSync(p)) text += fs.readFileSync(p, 'utf8');
}
text += ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}~';
text += '　、。〃〈〉《》「」『』【】〔〕〖〗〝〞–—‘’“”…‧﹏！＂＃％＆（）＊，．／：；＜＞？＠［］＿｛｜｝～';

// GB2312: 6763 Hanzi + 682 symbols. Generated locally, no external list needed.
const gb = execFileSync('python', [path.join('scripts', 'gb2312_chars.py')], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
});
text += gb;
text += '第页共签署人时间信用合同编号内容指纹签名第三方记查验方式附录';

const chars = Array.from(new Set(Array.from(text)));
const charsetFile = path.join(os.tmpdir(), 'agreement-font-charset.txt');
await fsp.writeFile(charsetFile, chars.join(''), 'utf8');
console.log('charset: ' + chars.length + ' unique characters');

const licenseOut = path.join(outDir, 'OFL.txt');
if (!fs.existsSync(licenseOut)) {
  const res = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt');
  if (res.ok) await fsp.writeFile(licenseOut, await res.text(), 'utf8');
}

for (const font of FONTS) {
  const outPath = path.join(outDir, font.out);
  if (fs.existsSync(outPath) && !force) {
    console.log(font.name + ': exists, skip');
    continue;
  }
  const ttf = path.join(os.tmpdir(), font.name + '.ttf');
  if (!fs.existsSync(ttf) || force) {
    console.log(font.name + ': downloading');
    const res = await fetch(font.url);
    if (!res.ok) throw new Error(font.name + ' download failed: ' + res.status);
    await fsp.writeFile(ttf, Buffer.from(await res.arrayBuffer()));
  }
  console.log(font.name + ': subsetting');
  execFileSync('python', ['-m', 'fontTools.subset', ttf,
    '--text-file=' + charsetFile,
    '--flavor=woff2',
    '--output-file=' + outPath,
    '--layout-features=*',
    '--no-hinting',
    '--desubroutinize',
  ], { stdio: 'inherit' });
  const size = (await fsp.stat(outPath)).size;
  console.log(font.name + ': ' + font.out + ' ' + Math.round(size / 1024) + ' KB');
}
