/* scn-parse.js — 簡易テキスト記法（scenario.txt）を、エンジンが読む JSON へ変換する。
 * 記法の説明は README.md。使い方: const {parse} = require('./scn-parse'); parse(文字列, {characters}) → {scenario, errors} */
'use strict';

function val(s) {
  s = String(s).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s !== '' && !isNaN(Number(s))) return Number(s);
  const m = /^"(.*)"$|^'(.*)'$/.exec(s);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : s;
}

/* 条件式: a && !b || (info:diary && trust >= 2) */
function parseCond(src) {
  const toks = [];
  const re = /\s*(&&|\|\||==|!=|>=|<=|>|<|!|\(|\)|"[^"]*"|'[^']*'|[^\s()!&|=<>]+)/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error('条件式を読めません: ' + src.slice(i));
    toks.push(m[1]); i = re.lastIndex;
  }
  let p = 0;
  const peek = () => toks[p], eat = () => toks[p++];
  function or() { const l = [and()]; while (peek() === '||') { eat(); l.push(and()); } return l.length === 1 ? l[0] : { any: l }; }
  function and() { const l = [unary()]; while (peek() === '&&') { eat(); l.push(unary()); } return l.length === 1 ? l[0] : { all: l }; }
  function unary() {
    if (peek() === '!') { eat(); const c = unary(); return typeof c === 'string' && c[0] !== '!' ? '!' + c : { not: c }; }
    if (peek() === '(') { eat(); const c = or(); if (eat() !== ')') throw new Error('条件式の ) がありません'); return c; }
    return atom();
  }
  function atom() {
    const t = eat();
    if (t === undefined || /^(&&|\|\||==|!=|>=|<=|>|<|\))$/.test(t)) throw new Error('条件式が途中で終わっています: ' + src);
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^(==|!=|>=|<=|>|<)$/.test(peek() || '')) {
      const op = eat(), v = eat();
      if (v === undefined) throw new Error('条件式の比較する値がありません: ' + src);
      if (/^(info|ending|chose):/.test(t)) throw new Error(t + ' は比較できません');
      return { flag: t, op, value: val(v) };
    }
    return t;
  }
  if (!toks.length) throw new Error('条件式が空です');
  const c = or();
  if (p < toks.length) throw new Error('条件式の余分な部分: ' + toks.slice(p).join(' '));
  return c;
}

/* "a=true b=2 c+=1 d" → {set:{…}, add:{…}} */
function parseAssign(s) {
  const set = {}, add = {};
  let ns = 0, na = 0;
  String(s).trim().split(/[\s,]+/).filter(Boolean).forEach(t => {
    let m;
    if ((m = /^([\w.-]+)\+=(-?[\d.]+)$/.exec(t))) { add[m[1]] = Number(m[2]); na++; }
    else if ((m = /^([\w.-]+)-=([\d.]+)$/.exec(t))) { add[m[1]] = -Number(m[2]); na++; }
    else if ((m = /^([\w.-]+)=(.*)$/.exec(t))) { set[m[1]] = val(m[2]); ns++; }
    else if (/^[\w.-]+$/.test(t)) { set[t] = true; ns++; }
    else throw new Error('フラグの書き方を読めません: ' + t);
  });
  return { set: ns ? set : undefined, add: na ? add : undefined };
}
function kv(words) {   /* ["a","k=v"] → {_: ["a"], k: "v"} */
  const o = { _: [] };
  words.forEach(w => { const m = /^([A-Za-z]\w*)=(.*)$/.exec(w); if (m) o[m[1]] = val(m[2]); else o._.push(w); });
  return o;
}

function parse(src, opt) {
  opt = opt || {};
  const errors = [], scenes = {};
  const nameToId = {};
  Object.keys(opt.characters || {}).forEach(id => { const n = opt.characters[id].name; if (n && !nameToId[n]) nameToId[n] = id; });
  let cur = null, curId = null, start = null, choice = null, nextFx = null, ifStack = [], ifSeq = 0, meta = {};
  const lines = String(src).replace(/^﻿/, '').split(/\r?\n/);
  const push = c => { if (!cur) throw new Error('シーン（*名前）の前に命令があります'); cur.commands.push(c); choice = null; return c; };
  const text = (speaker, t) => {
    const c = { type: 'TEXT', text: t.replace(/\\n/g, '\n') };
    if (speaker) c.speaker = nameToId[speaker] || speaker;
    if (nextFx) { c.fx = nextFx; nextFx = null; }
    push(c);
  };
  function closeScene(ln) {
    if (ifStack.length) { errors.push('行' + ifStack[ifStack.length - 1].line + ': @if に対応する @endif がありません'); ifStack = []; }
  }
  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    let line = raw.replace(/^[ \t]+|[ \t]+$/g, '');
    if (!line || line[0] === '#' || line.startsWith('//')) return;
    try {
      if (line[0] === '*') {                       /* シーン */
        closeScene(ln);
        const parts = line.slice(1).split('|').map(s => s.trim());
        curId = parts[0];
        if (!/^[\w.-]+$/.test(curId)) throw new Error('シーン名は半角英数字と _ . - で書いてください: ' + curId);
        if (scenes[curId]) throw new Error('シーン "' + curId + '" が2回出てきます');
        cur = scenes[curId] = { commands: [] };
        if (!start) start = curId;
        parts.slice(1).forEach(p => {
          let m;
          if ((m = /^require\s+(.+)$/.exec(p))) cur.require = parseCond(m[1]);
          else if ((m = /^fallback\s+(\S+)$/.exec(p))) cur.fallback = m[1];
          else throw new Error('シーンの指定を読めません: ' + p);
        });
        choice = null;
        return;
      }
      if (line[0] === '-' && choice && !/^-{2,}/.test(line)) {    /* 選択肢の項目 */
        const parts = line.slice(1).split('|').map(s => s.trim());
        const o = {};
        const m = /^(.*?)\s*->\s*(\S+)$/.exec(parts[0]);
        if (m) { o.text = m[1].trim(); o.next = m[2]; } else o.text = parts[0];
        if (!o.text) throw new Error('選択肢の文がありません');
        parts.slice(1).forEach(p => {
          let k;
          if ((k = /^set\s+(.+)$/.exec(p))) { const a = parseAssign(k[1]); if (a.set) o.setFlag = Object.assign(o.setFlag || {}, a.set); if (a.add) o.addFlag = Object.assign(o.addFlag || {}, a.add); }
          else if ((k = /^add\s+(.+)$/.exec(p))) { const a = parseAssign(k[1].replace(/([\w.-]+)=(-?[\d.]+)/g, '$1+=$2')); o.addFlag = Object.assign(o.addFlag || {}, a.add || {}); }
          else if ((k = /^info\s+(.+)$/.exec(p))) o.info = k[1].trim().split(/\s+/);
          else if ((k = /^if\s+(.+)$/.exec(p))) o.if = parseCond(k[1]);
          else if ((k = /^id\s+(\S+)$/.exec(p))) o.id = k[1];
          else if (p === 'once') o.once = true;
          else if (p === 'correct') o.correct = true;
          else if (p === 'wrong') o.correct = false;
          else throw new Error('選択肢の指定を読めません: ' + p);
        });
        choice.options.push(o);
        return;
      }
      if (line[0] === '@') {                       /* 命令 */
        const m = /^@(\w+)\s*(.*)$/.exec(line);
        if (!m) throw new Error('命令を読めません');
        const name = m[1].toLowerCase(), rest = m[2].trim(), w = rest ? rest.split(/\s+/) : [];
        switch (name) {
          case 'title': meta.title = rest; break;
          case 'gameid': meta.gameId = rest; break;
          case 'start': start = rest; break;
          case 'status': {
            if (rest === 'clear') { push({ type: 'STATUS', clear: true }); break; }
            const p = rest.split('|').map(s => s.trim()), c = { type: 'STATUS' };
            ['date', 'place', 'chapter'].forEach((k, i) => { if (p[i] !== undefined && p[i] !== '-') c[k] = p[i]; });
            push(c); break;
          }
          case 'bg': { const o = kv(w); const c = { type: 'BG', id: o._[0] || 'none' }; if (o.fade !== undefined) c.fade = o.fade; push(c); break; }
          case 'char': { const o = kv(w); if (!o._[0]) throw new Error('@char にキャラクター名がありません'); push({ type: 'CHARACTER', id: o._[0], expr: o._[1] || 'normal', pos: o._[2] || 'center' }); break; }
          case 'hide': push({ type: 'HIDE_CHARACTER', id: w[0] || 'all' }); break;
          case 'bgm': case 'env': {
            const o = kv(w), c = { type: 'BGM', id: o._[0] || 'stop' };
            if (name === 'env') c.channel = 'env';
            if (o.fade !== undefined) c.fade = o.fade;
            push(c); break;
          }
          case 'se': if (!w[0]) throw new Error('@se に名前がありません'); push({ type: 'SE', id: w[0] }); break;
          case 'choice': {
            const p = rest.split('|').map(s => s.trim()), c = { type: 'CHOICE', options: [] };
            if (p[0]) c.id = p[0];
            if (p[1]) c.prompt = p[1];
            push(c); choice = c; break;
          }
          case 'flag': { const a = parseAssign(rest); if (!a.set && !a.add) throw new Error('@flag に設定がありません'); const c = { type: 'FLAG' }; if (a.set) c.set = a.set; if (a.add) c.add = a.add; push(c); break; }
          case 'if': {
            const mm = /^(.*?)\s*->\s*(\S+)(?:\s+else\s+(\S+))?$/.exec(rest);
            if (mm) { const c = { type: 'IF', cond: parseCond(mm[1]), then: mm[2] }; if (mm[3]) c.else = mm[3]; push(c); break; }
            const n = ++ifSeq, f = { n, line: ln, hasElse: false };
            ifStack.push(f);
            push({ type: 'IF', cond: parseCond(rest), else: '#__if' + n + '_else' });
            break;
          }
          case 'else': {
            const f = ifStack[ifStack.length - 1];
            if (!f || f.hasElse) throw new Error('@else に対応する @if がありません');
            f.hasElse = true;
            push({ type: 'JUMP', to: '#__if' + f.n + '_end' });
            push({ type: 'LABEL', name: '__if' + f.n + '_else' });
            break;
          }
          case 'endif': {
            const f = ifStack.pop();
            if (!f) throw new Error('@endif に対応する @if がありません');
            if (!f.hasElse) push({ type: 'LABEL', name: '__if' + f.n + '_else' });
            else push({ type: 'LABEL', name: '__if' + f.n + '_end' });
            break;
          }
          case 'jump': if (!w[0]) throw new Error('@jump に移動先がありません'); push({ type: 'JUMP', to: w[0] }); break;
          case 'call': if (!w[0]) throw new Error('@call に移動先がありません'); push({ type: 'CALL', to: w[0] }); break;
          case 'return': push({ type: 'RETURN' }); break;
          case 'label': if (!w[0]) throw new Error('@label に名前がありません'); push({ type: 'LABEL', name: w[0] }); break;
          case 'wait': push({ type: 'WAIT', ms: Number(w[0]) || 0 }); break;
          case 'info': if (!w[0]) throw new Error('@info に名前がありません'); { const c = { type: 'INFO', id: w[0] }; if (w[1] === 'silent') c.silent = true; push(c); } break;
          case 'effect': {
            const c = { type: 'EFFECT', name: w[0] };
            w.slice(1).forEach(t => { if (t === 'on') c.on = true; else if (t === 'off') c.on = false; else if (t === 'nowait') c.wait = false; else if (!isNaN(Number(t))) c.ms = Number(t); else throw new Error('@effect の指定を読めません: ' + t); });
            push(c); break;
          }
          case 'fx': nextFx = w[0]; if (['glitch', 'garble'].indexOf(nextFx) < 0) throw new Error('@fx は glitch か garble です'); break;
          case 'style': {
            const o = kv(w), c = { type: 'TEXT_STYLE' };
            if (o._[0]) c.mode = String(o._[0]).toUpperCase();
            const map = { speed: 'charMs', punct: 'punctMs', line: 'lineMs', fade: 'fadeMs', linems: 'lineModeMs' };
            Object.keys(o).forEach(k => { if (k === '_') return; if (!map[k]) throw new Error('@style の指定を読めません: ' + k); c[map[k]] = o[k]; });
            push(c); break;
          }
          case 'require': {
            const p = rest.split('|').map(s => s.trim()), c = { type: 'REQUIRE' };
            const mm = /^(.*?)\s*->\s*(\S+)$/.exec(p[0]);
            c.need = parseCond(mm ? mm[1] : p[0]);
            if (mm) c.call = mm[2];
            p.slice(1).forEach(x => {
              let k;
              if ((k = /^grant\s+(.+)$/.exec(x))) c.grant = k[1].trim().split(/\s+/);
              else if ((k = /^set\s+(.+)$/.exec(x))) c.setFlag = parseAssign(k[1]).set;
              else throw new Error('@require の指定を読めません: ' + x);
            });
            push(c); break;
          }
          case 'ending': { const c = { type: 'ENDING' }; if (w[0]) c.id = w[0]; push(c); break; }
          case 'end': push({ type: 'END' }); break;
          case 'raw': push(JSON.parse(rest)); break;
          default: throw new Error('知らない命令です: @' + name);
        }
        return;
      }
      /* 文章: 名前「…」（名前は characters.json にある名前か id）／ [名前]「…」（その場かぎりの名前）／ 地の文 */
      const adhoc = /^\[([^\]]+)\]\s*(.+)$/.exec(line);
      if (adhoc) { text(adhoc[1], adhoc[2]); return; }
      const sp = /^([^\s「」『』（）()]{1,12})(「.*」|『.*』|（.*）)$/.exec(line);
      if (sp && (nameToId[sp[1]] || (opt.characters || {})[sp[1]])) text(sp[1], sp[2]); else text(null, line);
    } catch (e) { errors.push('行' + ln + ': ' + e.message + '\n    ' + raw.trim()); }
  });
  closeScene(lines.length);
  const scenario = Object.assign({}, meta, { start, scenes });
  return { scenario, errors };
}

module.exports = { parse, parseCond, parseAssign };
