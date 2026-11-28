// 仕立て屋を 1 枚の HTML にまとめる。
//   DEPS=<esbuild と three@0.187.0 を npm install したフォルダ> node build.mjs [アーティファクト用の出力先]
import fs from 'fs'; import path from 'path'; import {createRequire} from 'module'; import {fileURLToPath} from 'url';
const src=path.dirname(fileURLToPath(import.meta.url)),deps=path.resolve(process.env.DEPS||src);
const esbuild=createRequire(path.join(deps,'x.js'))('esbuild');
const bundle=async entry=>(await esbuild.build({entryPoints:[path.join(src,entry)],bundle:true,write:false,format:'iife',minify:true,charset:'utf8',target:'es2020',nodePaths:[path.join(deps,'node_modules')],legalComments:'inline'})).outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const read=f=>fs.readFileSync(path.join(src,f),'utf8');
const [app,worker]=await Promise.all([bundle('app.js'),bundle('worker.js')]);
const body=fs.readFileSync(path.join(src,'bodies/female.glb')).toString('base64');
const parts=`<title>仕立て屋</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${read('page.css')}</style>`;
const content=`${read('page.html')}<script type="text/plain" id="body-b64">${body}</script>\n<script type="text/plain" id="worker-src">${worker}</script>\n<script>${app}</script>\n`;
fs.writeFileSync(path.join(src,'../index.html'),`<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${parts}\n</head>\n<body>\n${content}</body>\n</html>\n`);
if(process.argv[2])fs.writeFileSync(process.argv[2],`${parts}\n${content}`);
console.log('app',app.length,'worker',worker.length,'total',fs.statSync(path.join(src,'../index.html')).size);
