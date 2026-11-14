#!/usr/bin/env node
/* build.js — 作品フォルダのデータを検証し、エンジンと合わせて 1 枚の index.html にまとめる。
 *
 *   node pc98-novel/_engine/build.js              … サンプル（pc98-novel/）をビルド
 *   node pc98-novel/_engine/build.js ../新作/      … 別の作品フォルダをビルド（<作品>/index.html ができる）
 *   node pc98-novel/_engine/build.js --check      … 検証だけ（ファイルは書かない）
 *
 * 作品フォルダ: data/config.json  data/scenario.txt（または scenario.json）  data/characters.json
 *              data/endings.json  data/backgrounds.json  data/info.json  data/audio.json   assets/
 */
'use strict';
const fs = require('fs'), path = require('path');
const here = __dirname;
const S = require('./js/10-scenario.js');
const { parse } = require('./tools/scn-parse.js');

const args = process.argv.slice(2), checkOnly = args.includes('--check');
const gameDir = path.resolve(args.find(a => !a.startsWith('--')) || path.join(here, '..'));
const dataDir = path.join(gameDir, 'data');
const fail = msg => { console.error('\n✖ ' + msg); process.exit(1); };

function readJson(name, optional) {
  const p = path.join(dataDir, name);
  if (!fs.existsSync(p)) { if (optional) return undefined; fail('ファイルがありません: ' + path.relative(process.cwd(), p)); }
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch (e) { fail(name + ' の JSON に誤りがあります: ' + e.message); }
}

const game = {
  config: readJson('config.json'),
  characters: readJson('characters.json', true) || {},
  endings: readJson('endings.json', true) || [],
  backgrounds: readJson('backgrounds.json', true) || {},
  info: readJson('info.json', true) || {},
  audio: readJson('audio.json', true) || {}
};
/* シナリオ: scenario.txt があればそれを正とし、scenario.json を作り直す */
const txt = path.join(dataDir, 'scenario.txt');
if (fs.existsSync(txt)) {
  const r = parse(fs.readFileSync(txt, 'utf8'), { characters: game.characters });
  if (r.errors.length) fail('scenario.txt に誤りがあります（' + r.errors.length + '件）\n  ' + r.errors.join('\n  '));
  game.scenario = r.scenario;
  if (!checkOnly) fs.writeFileSync(path.join(dataDir, 'scenario.json'),
    JSON.stringify(Object.assign({ _note: 'このファイルは scenario.txt から build.js が作ります。直すときは scenario.txt を直してください。' }, r.scenario), null, 1) + '\n');
} else game.scenario = readJson('scenario.json');
delete game.scenario._note;

/* 素材の自動検出: assets/ に決まった名前で置かれたファイルを、データに書き足す（JSON を直さなくても差し替わる）
 *   背景  assets/background/<背景ID>.png|jpg|webp|gif
 *   立ち絵 assets/character/<キャラID>_<表情>.png …（<キャラID>.png は normal）
 *   BGM・環境音 assets/bgm/<ID>.mp3|ogg|m4a|wav      効果音 assets/se/<ID>.mp3|ogg|m4a|wav */
function scan(dir, exts) {
  const d = path.join(gameDir, 'assets', dir), o = {};
  if (!fs.existsSync(d)) return o;
  fs.readdirSync(d).forEach(f => { const m = /^(.+)\.(\w+)$/.exec(f); if (m && exts.includes(m[2].toLowerCase())) o[m[1]] = 'assets/' + dir + '/' + f; });
  return o;
}
const IMG = ['png', 'jpg', 'jpeg', 'webp', 'gif'], SND = ['mp3', 'ogg', 'm4a', 'wav'];
let found = 0;
Object.entries(scan('background', IMG)).forEach(([id, f]) => { const d = game.backgrounds[id] = game.backgrounds[id] || {}; if (!d.image) { d.image = f; found++; } });
Object.entries(scan('character', IMG)).forEach(([name, f]) => {
  const id = Object.keys(game.characters).filter(c => name === c || name.startsWith(c + '_')).sort((a, b) => b.length - a.length)[0];
  if (!id) return;
  const d = game.characters[id];
  if (typeof d.image === 'string') return;
  d.image = d.image || {};
  const expr = name === id ? 'normal' : name.slice(id.length + 1);
  if (!d.image[expr]) { d.image[expr] = f; found++; }
});
Object.entries(scan('bgm', SND)).forEach(([id, f]) => {
  const t = (game.audio.env && game.audio.env[id]) ? game.audio.env : (game.audio.bgm = game.audio.bgm || {});
  const d = t[id] = t[id] || {}; if (!d.file) { d.file = f; found++; }
});
Object.entries(scan('se', SND)).forEach(([id, f]) => { const t = game.audio.se = game.audio.se || {}; const d = t[id] = t[id] || {}; if (!d.file) { d.file = f; found++; } });
if (found) console.log('✔ 素材ファイルを ' + found + ' 件見つけました（仮表示・合成音から差し替え）');

const embed = JSON.stringify(game);
S.normalize(game);
const v = S.validate(game);
v.warnings.forEach(w => console.warn('  ! ' + w));
if (v.errors.length) fail('シナリオデータに誤りがあります（' + v.errors.length + '件）\n  ' + v.errors.join('\n  '));
const nScene = Object.keys(game.scenario.scenes).length;
const nCmd = Object.values(game.scenario.scenes).reduce((n, s) => n + s.commands.length, 0);
console.log('✔ 検証OK: ' + game.config.title + '（' + game.config.gameId + ' v' + game.config.version + '） シーン ' + nScene + ' / 命令 ' + nCmd + ' / エンディング ' + game.endings.length + ' / 警告 ' + v.warnings.length);
if (checkOnly) process.exit(0);

const read = f => fs.readFileSync(path.join(here, f), 'utf8');
const css = ['base', 'pc98-theme', 'dialogue', 'menu', 'effects'].map(n => read('css/' + n + '.css')).join('\n');
const js = fs.readdirSync(path.join(here, 'js')).filter(f => /^\d.*\.js$/.test(f)).sort()
  .map(f => '/* ======== ' + f.replace(/^\d+-/, '') + ' ======== */\n' + read('js/' + f)).join('\n');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const out = read('template.html')
  .replace('/*@@TITLE@@*/', () => esc(game.config.title))
  .replace('/*@@CSS@@*/', () => css)
  .replace('/*@@DATA@@*/', () => embed.replace(/</g, '\\u003c'))
  .replace('/*@@JS@@*/', () => js.replace(/<\/script>/g, '<\\/script>'));
const dst = path.join(gameDir, 'index.html');
fs.writeFileSync(dst, out);
console.log('✔ ' + path.relative(process.cwd(), dst) + '  ' + Math.round(out.length / 1024) + ' KB');
