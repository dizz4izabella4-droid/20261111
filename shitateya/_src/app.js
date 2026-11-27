// 画面：部品の設定、プレビュー、保存と書き出し
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {parseBody} from './body.js';
import {makeSkinner,buildMeshes,exportGLB,countTriangles,MATERIALS} from './mesh.js';
import {PRESETS,COLOR_SETS,colorsOf,RANGES,CHOICES,sanitize} from './design.js';
import {plan,STEP_LABEL} from './garments.js';
import {zipOne} from './zip.js';

const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='class')e.className=v;else if(k.startsWith('on'))e[k]=v;else if(k in e&&typeof v!=='string')e[k]=v;else e.setAttribute(k,v);}e.append(...kids.filter(c=>c!=null));return e;};
const copy=o=>JSON.parse(JSON.stringify(o));
const STORE='shitateya.design.v1';
const load=()=>{try{const s=localStorage.getItem(STORE);return s?sanitize(JSON.parse(s)):null;}catch{return null;}};
const store=()=>{try{localStorage.setItem(STORE,JSON.stringify(design));}catch{}};

let design=load()||PRESETS[0](),history=[],committed=copy(design),tab='design';
let body=null,skinner=null,bodyIsBuiltIn=true,parts=null,shown=null,meshes=[],meshCache=new WeakMap();
let worker=null,job=0,running=null,wantExport=false,lastFile=null;

function status(text,warn=false){$('status').textContent=text;$('status').classList.toggle('warn',warn);}
const shapeKey=d=>plan(d).map(s=>s.id+JSON.stringify(s.key)).join(';');
const isCurrent=q=>shown&&shown.shape===shapeKey(design)&&(!q||shown.quality===q);

// ---------- 裏の計算 ----------
const workerSource=()=>$('worker-src').textContent;
function startWorker(){
  if(worker)worker.terminate();
  worker=new Worker(URL.createObjectURL(new Blob([workerSource()],{type:'text/javascript'})));
  worker.onmessage=e=>{const m=e.data;if(m.job!==job||!running)return;
    if(m.type==='progress'){showProgress(m.value,m.step);return;}
    if(m.type==='error'){running=null;wantExport=false;hideProgress();status('服を作れませんでした：'+m.message,true);refreshActions();return;}
    const{shape}=running;running=null;hideProgress();parts=m.parts;meshCache=new WeakMap();shown={shape,quality:m.quality};
    redraw();refreshActions();
    if(wantExport&&isCurrent('fine')){wantExport=false;saveGLB();}};
  worker.onerror=e=>{running=null;wantExport=false;hideProgress();status('計算の準備に失敗しました：'+(e.message||'原因不明'),true);refreshActions();};
}
function run(quality){
  if(!body)return;
  const shape=shapeKey(design);
  if(running&&running.shape===shape&&running.quality===quality)return;
  job++;running={shape,quality};showProgress(0,null);refreshActions();
  worker.postMessage({type:'run',job,design,quality});
}
function showProgress(v,step){const p=$('progress');p.hidden=false;p.querySelector('span').textContent=(running&&running.quality==='fine'?'仕上げ中':'下書き作成中')+'：'+(step?STEP_LABEL[step]:'素体を測っています');p.querySelector('i').style.width=Math.round(v*100)+'%';}
function hideProgress(){$('progress').hidden=true;}
function refreshActions(){
  $('finish').disabled=!body||!!(running&&running.quality==='fine')||isCurrent('fine');
  $('export').disabled=!body||wantExport;
  $('undo').disabled=!history.length;
  if(running){status(wantExport?'書き出し用に仕上げています。終わると保存します。':running.quality==='fine'?'仕上げています。細かい網目で計算するので、少し時間がかかります。':'下書きを作っています。');return;}
  if(!shown||!meshes.length)return;
  status(`${shown.quality==='fine'?'仕上げ表示':'下書き表示'}　服 ${countTriangles(meshes).toLocaleString('ja-JP')} 三角形`);
}

// ---------- 設定の変更 ----------
function commit(){ // つまみを離したときなど、変更を確定する
  if(JSON.stringify(design)===JSON.stringify(committed))return;
  history.push(committed);if(history.length>60)history.shift();committed=copy(design);store();
  sync();renderTabs();
}
function sync(){ // 形が変わっていたら作り直す
  const shape=shapeKey(design);
  if(running&&running.shape!==shape){wantExport=false;if(isCurrent()){worker.postMessage({type:'cancel',job:++job});running=null;hideProgress();}else run('draft');}
  else if(!running&&!isCurrent()){wantExport=false;run('draft');}
  refreshActions();
}
function replaceDesign(next){design=sanitize(next);renderSheet();redraw();commit();}
let drawQueued=false;
function queueDraw(){if(drawQueued)return;drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;redraw();});}

// ---------- 設定の画面 ----------
const TABS=[['design','型・素体'],['top','上衣'],['vest','胴着'],['sleeve','袖'],['bracer','腕当て'],['pants','ズボン'],['skirt','スカート'],['tabard','前掛け'],['sash','帯'],['shoes','靴'],['cape','マント'],['hood','フード'],['hat','帽子'],['color','色・縁']];
const worn=id=>id==='sleeve'?design.sleeve.type!=='none':id==='hood'?design.cape.on&&design.hood.on:design[id]&&'on'in design[id]?design[id].on:true;
function renderTabs(){
  $('tabs').replaceChildren(...TABS.map(([id,label])=>el('button',{type:'button',role:'tab','aria-selected':String(tab===id),class:worn(id)?'':'off',onclick:()=>{tab=id;renderTabs();renderSheet();$('sheet').scrollTop=0;}},label)));
  $('tabs').querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
const k=()=>body?body.H/1.533:1;
const cm=v=>(v*k()*100).toFixed(v<0.02?1:0)+' cm', pct=v=>Math.round(v*100)+' %';
function slider(group,key,label,format,step,disabled=false){
  const[min,max]=RANGES[group][key],out=el('output',{},format(design[group][key]));
  const input=el('input',{type:'range',min:String(min),max:String(max),step:String(step),'aria-label':label,disabled});input.value=design[group][key];
  input.oninput=()=>{design[group][key]=+input.value;out.textContent=format(+input.value);if(group==='trim')queueDraw();};
  input.onchange=commit;
  return el('div',{class:'field'+(disabled?' dim':'')},el('span',{},label),input,out);
}
function select(group,key,label,options=CHOICES[group][key]){
  const s=el('select',{'aria-label':label},...options.map(([v,t])=>el('option',{value:v},t)));s.value=design[group][key];
  s.onchange=()=>{design[group][key]=s.value;renderSheet();commit();};
  return el('div',{class:'field'},el('span',{},label),s);
}
function check(group,key,label,cls='',disabled=false){
  const c=el('input',{type:'checkbox',disabled});c.checked=design[group][key];
  c.onchange=()=>{design[group][key]=c.checked;renderSheet();if(group==='trim')queueDraw();commit();};
  return el('label',{class:'check '+cls},c,el('span',{},label));
}
const note=t=>el('p',{class:'note'},t), heading=t=>el('h2',{},t), row=(...c)=>el('div',{class:'row'},...c);
const button=(label,onclick,props={})=>el('button',{type:'button',onclick,...props},label);
const COLOR_ROWS=[['top','上衣・袖',['地','縁','線']],['vest','胴着・腕当て',['地','縁']],['pants','ズボン',['地','縁','線']],['skirt','スカート',['地','縁','線']],['sash','帯',['地','縁']],['tabard','前掛け',['地','縁']],['shoes','靴',['地','底・縁']],['cape','マント・フード',['地','縁','裏地']],['hat','帽子',['地','縁','帯']]];

const SHEETS={
  design(){
    const name=el('input',{type:'text',id:'name',maxlength:'40','aria-label':'型の名前'});name.value=design.name;name.onchange=()=>{design.name=name.value.trim()||'名前のない衣装';name.value=design.name;commit();};
    return[heading('見本の型'),row(...PRESETS.map(p=>{const d=p();return button(d.name,()=>replaceDesign(d));})),note('見本を選ぶと今の設定が置き換わります。「元に戻す」で戻せます。'),
      heading('この型'),row(name),row(button('型を保存',saveDesign),button('型を開く',()=>$('open-design').click())),note('型（部品・寸法・色の設定）は、このブラウザにも自動で残ります。別の端末へ移すときは保存してください。'),
      heading('素体'),row(button('内蔵の女性素体',()=>useBuiltIn(),{'aria-pressed':String(bodyIsBuiltIn)}),button('素体GLBを開く',()=>$('open-body').click(),{'aria-pressed':String(!bodyIsBuiltIn)})),
      note('女性素体に合わせて調整しています。スペアボディの「傀儡用に書き出す（GLB）」で作った素体も開けますが、体型が大きく違うと服がずれることがあります。'+(body?`　今の素体：身長 ${(body.H*100).toFixed(1)} cm`:''))];
  },
  top(){return[select('top','neck','襟の形'),slider('top','depth','開きの深さ',cm,0.002),slider('top','ease','ゆとり',cm,0.0005),note('上衣は常に着ます。上衣を変えると、下の部品もすべて作り直します。')];},
  vest(){const{on,type}=design.vest;return[check('vest','on','胴着を着ける','wear'),...(on?[select('vest','type','形'),slider('vest','size',type==='corset'?'高さ':'丈',pct,0.01)]:[])];},
  sleeve(){const t=design.sleeve.type;return[select('sleeve','type','袖の形'),
    ...(t==='none'?[]:[slider('sleeve','length','長さ（腕に対して）',pct,0.01),t==='fit'?null:slider('sleeve','cuff',t==='bell'?'袖口の周り':'ふくらみ',t==='bell'?cm:v=>pct((v-0.25)/0.95),0.01),t==='bell'?slider('sleeve','drape','垂れ',cm,0.01):null]),
    t==='bell'?note('垂れは、長さが短いと小さくなります。'):t==='puff'?note('肩の近くがふくらみ、その先は腕に沿います。長さを短くすると、ふくらみだけになります。'):null];},
  bracer(){const on=design.bracer.on;return[check('bracer','on','腕当てを着ける','wear'),...(on?[slider('bracer','length','長さ（肘から手首）',pct,0.01),note('広がる袖と一緒に着けると、袖の中に隠れます。')]:[])];},
  pants(){const{on,type}=design.pants;return[check('pants','on','ズボンをはく','wear'),...(on?[select('pants','type','形'),slider('pants','length','丈',pct,0.01),type==='slim'?null:slider('pants','volume','ふくらみ',pct,0.01),design.skirt.on?note('スカートもはいているので、ズボンはその下になります。'):null]:[])];},
  skirt(){const{on,shape}=design.skirt;return[check('skirt','on','スカートをはく','wear'),...(on?[select('skirt','shape','形'),select('skirt','edge','裾の形'),slider('skirt','length','丈（腰から床）',pct,0.01),slider('skirt','hem',shape==='straight'?'裾の広がり':'裾の周り',shape==='straight'?v=>pct((v-1.1)/3.4):cm,0.05),slider('skirt','pleats','ひだの数',v=>v?v+' 本':'なし',1),
    note(shape==='open'?'前が開くので、ズボンと合わせると脚が隠れます。':shape==='tiered'?'段フリルは、ひだが 14 本より少なくなりません。':'丈が短いときは、裾の周りは丈に合う大きさまでで頭打ちになります。')]:[])];},
  tabard(){const on=design.tabard.on;return[check('tabard','on','前掛けを着ける','wear'),...(on?[slider('tabard','width','幅',cm,0.005),slider('tabard','length','腰から下の丈',pct,0.01),check('tabard','back','後ろにも垂らす')]:[])];},
  sash(){const on=design.sash.on;return[check('sash','on','帯を締める','wear'),...(on?[slider('sash','width','帯の幅',cm,0.002),slider('sash','tails','垂れ紐',v=>v?v+' 本':'なし',1),slider('sash','tail','垂れ紐の長さ',cm,0.01,!design.sash.tails)]:[])];},
  shoes(){const{on,type}=design.shoes;return[check('shoes','on','靴をはく','wear'),...(on?[select('shoes','type','形'),type==='boots'?slider('shoes','height','高さ（床から）',cm,0.01):null,type==='boots'&&design.pants.on?note('ズボンの裾はブーツの中に入れます。'):null]:[])];},
  cape(){const on=design.cape.on;return[check('cape','on','マントを羽織る','wear'),...(on?[select('cape','edge','裾の形'),slider('cape','length','丈',pct,0.01),slider('cape','width','裾の幅',cm,0.05),check('cape','clasp','胸の留め具と紐'),note('丈を短くすると、肩掛けになります。')]:[])];},
  hood(){const cape=design.cape.on;return[check('hood','on','フードを付ける','wear',!cape),cape?null:note('フードはマントに付きます。先にマントを羽織ってください。'),...(cape&&design.hood.on?[select('hood','pose','状態'),slider('hood','depth','深さ',cm,0.01),design.hood.pose==='up'&&design.hat.on&&design.hat.type!=='circlet'?note('フードをかぶっている間は、帽子は表示しません。'):null]:[])];},
  hat(){const{on,type}=design.hat,hidden=design.cape.on&&design.hood.on&&design.hood.pose==='up'&&type!=='circlet';return[check('hat','on','頭の装いを着ける','wear'),...(on?[select('hat','type','形'),
    type==='witch'||type==='brim'||type==='beret'?slider('hat','height',type==='beret'?'ふくらみ':'高さ',type==='beret'?v=>pct((v-0.08)/0.24):cm,0.01):null,
    type==='witch'||type==='brim'?slider('hat','brim','つばの幅',cm,0.005):null,type==='veil'?slider('hat','length','ベールの丈',cm,0.01):null,
    hidden?note('フードをかぶっているので、表示していません。フードを下ろすか外すと表示します。'):null]:[])];},
  color(){
    const pickers=COLOR_ROWS.map(([g,label,names])=>el('div',{class:'colors'},el('b',{},label),...names.map((n,i)=>{const c=el('input',{type:'color','aria-label':label+'の'+n});c.value=design.colors[g][i];c.oninput=()=>{design.colors[g][i]=c.value;queueDraw();};c.onchange=commit;return el('label',{},c,n);})));
    return[heading('配色'),swatches(),
      heading('部品ごとの色'),...pickers,heading('縁飾り'),slider('trim','width','縁の幅',v=>v<0.002?'なし':cm(v),0.001),check('trim','line','裾に細い線を足す')];
  },
};
function swatches(){
  return el('div',{class:'swatches'},...Object.entries(COLOR_SETS).map(([n,set])=>{
    const same=design.colorSet===n&&JSON.stringify(design.colors)===JSON.stringify(set);
    const chips=el('span',{class:'chips'},...[set.top[0],set.skirt[0],set.sash[0],set.cape[0],set.top[1]].map(c=>el('i',{style:'background:'+c})));
    const b=button(n,()=>{design.colorSet=n;design.colors=colorsOf(n);renderSheet();redraw();commit();},{'aria-pressed':String(same)});b.append(chips);return b;}));
}
function renderSheet(){$('sheet').replaceChildren(...SHEETS[tab]().filter(Boolean));}

// ---------- プレビュー ----------
const stage=$('viewport');
let renderer=null,scene,camera,controls,clothGroup=[],bodyScene=null,bodyMesh=null,bones={},pose='立ち姿',poseStart=0,showBody=true,wire=false;
const materials={};
try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));stage.prepend(renderer.domElement);
  scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x606070,1.7));
  const d1=new THREE.DirectionalLight(0xffffff,1.8);d1.position.set(1.5,2.5,2);const d2=new THREE.DirectionalLight(0xcfe0ff,0.9);d2.position.set(-2,1.5,-2);scene.add(d1,d2);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(0.9,64),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.1}));floor.rotation.x=-Math.PI/2;scene.add(floor);
  camera=new THREE.PerspectiveCamera(26,1,0.05,40);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=0.5;controls.maxDistance=10;
  for(const[name,m]of Object.entries(MATERIALS))materials[name]=new THREE.MeshStandardMaterial({vertexColors:true,metalness:m.metallic,roughness:m.roughness,side:m.doubleSided?THREE.DoubleSide:THREE.FrontSide});
}catch(err){renderer=null;stage.append(el('p',{class:'note',style:'position:absolute;inset:60px 16px auto'},'この環境では3D表示ができません。書き出しは使えます。'));}

let view={az:25,zoom:'全身'};
function aim(){
  if(!renderer)return;const H=body?body.H:1.53,upper=view.zoom==='上半身',t=Math.tan(13*Math.PI/180);
  const small=stage.clientHeight<520,half=upper?0.27*H*(small?1.2:1):H*(small?0.66:0.6),wide=upper?0.25*H:0.46*H,dist=Math.max(half/t,wide/(t*camera.aspect)),target=upper?0.73*H:0.49*H,r=view.az*Math.PI/180;
  camera.position.set(Math.sin(r)*dist,target+dist*0.06,Math.cos(r)*dist);controls.target.set(0,target,0);controls.update();
}
if(renderer){new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();aim();}).observe(stage);}

async function showBodyModel(bytes){
  if(!renderer)return;
  const gltf=await new GLTFLoader().parseAsync(bytes.slice().buffer,'');
  if(bodyScene){scene.remove(bodyScene);bodyScene.traverse(o=>{if(o.isMesh){o.geometry.dispose();}});}
  clothGroup=[];bodyScene=gltf.scene;bodyMesh=null;bones={};
  const old=[];bodyScene.traverse(o=>{if(o.name.startsWith('cloth_'))old.push(o);});old.forEach(o=>o.removeFromParent());
  bodyScene.traverse(o=>{if(o.isBone)bones[o.name]={o,q:o.quaternion.clone(),p:o.position.clone()};if(o.isSkinnedMesh&&!bodyMesh)bodyMesh=o;if(o.isMesh){o.frustumCulled=false;o.userData.isBody=true;o.visible=showBody;o.material.wireframe=wire;}});
  scene.add(bodyScene);
}
function redraw(){
  if(!body||!parts)return;
  meshes=buildMeshes(body,skinner,parts,design,meshCache);
  if(!renderer||!bodyMesh)return;
  for(const m of clothGroup){m.removeFromParent();m.geometry.dispose();}clothGroup=[];
  for(const m of meshes)for(const p of m.prims){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p.position,3));g.setAttribute('normal',new THREE.BufferAttribute(p.normal,3));g.setAttribute('color',new THREE.BufferAttribute(p.color,3));
    g.setAttribute('skinIndex',new THREE.BufferAttribute(p.joints,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(p.weights,4));g.setIndex(new THREE.BufferAttribute(p.index,1));
    const mesh=new THREE.SkinnedMesh(g,materials[p.mat]);mesh.name=m.name;mesh.frustumCulled=false;mesh.position.copy(bodyMesh.position);mesh.quaternion.copy(bodyMesh.quaternion);mesh.scale.copy(bodyMesh.scale);
    bodyMesh.parent.add(mesh);mesh.bind(bodyMesh.skeleton,bodyMesh.bindMatrix);clothGroup.push(mesh);
  }
  for(const m of Object.values(materials))m.wireframe=wire;
}
const euler=new THREE.Euler(),quat=new THREE.Quaternion();
const turn=(n,x,y=0,z=0)=>{const b=bones[n];if(b)b.o.quaternion.copy(b.q).multiply(quat.setFromEuler(euler.set(x,y,z)));};
function applyPose(now){
  for(const n in bones){bones[n].o.quaternion.copy(bones[n].q);bones[n].o.position.copy(bones[n].p);}
  if(pose==='歩く'){const w=(now-poseStart)/1000*Math.PI*1.7,s=Math.sin(w),c=Math.cos(w);
    turn('thigh_l',-0.34*s);turn('thigh_r',0.34*s);turn('shin_l',0.5*Math.max(0,c));turn('shin_r',0.5*Math.max(0,-c));turn('upperarm_l',0.22*s);turn('upperarm_r',-0.22*s);turn('chest',0,0.06*s,0);
    if(bones.hips)bones.hips.o.position.y+=0.012*Math.abs(c)-0.012;}
  if(pose==='腕を上げる'){turn('upperarm_l',0,0,0.9);turn('upperarm_r',0,0,-0.9);}
  if(pose==='ひねる'){turn('spine',0.15,0.3,0);turn('forearm_l',-0.8);turn('forearm_r',-0.8);}
}
if(renderer){
  const views=[['正面',0],['斜め',35],['横',90],['後ろ',180]];
  $('views').append(...views.map(([t,a])=>button(t,()=>{view.az=a;aim();})),button('上半身',e=>{view.zoom=view.zoom==='全身'?'上半身':'全身';e.currentTarget.setAttribute('aria-pressed',String(view.zoom==='上半身'));aim();},{'aria-pressed':'false'}));
  const poses=el('select',{'aria-label':'ポーズ'},...['立ち姿','歩く','腕を上げる','ひねる'].map(t=>el('option',{value:t},t)));poses.onchange=()=>{pose=poses.value;poseStart=performance.now();};
  const toggle=(label,get,set)=>button(label,e=>{set(!get());e.currentTarget.setAttribute('aria-pressed',String(get()));},{'aria-pressed':String(get())});
  $('looks').append(poses,toggle('素体',()=>showBody,v=>{showBody=v;bodyScene?.traverse(o=>{if(o.userData.isBody)o.visible=v;});}),
    toggle('回す',()=>controls.autoRotate,v=>controls.autoRotate=v),toggle('網目',()=>wire,v=>{wire=v;scene.traverse(o=>{if(o.isMesh&&o.parent!==scene)o.material.wireframe=v;});}));
  renderer.setAnimationLoop(now=>{applyPose(now);controls.update();renderer.render(scene,camera);});
}

// ---------- 素体 ----------
const builtInBytes=()=>{const s=atob($('body-b64').textContent.trim()),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;};
async function useBody(bytes,builtIn){
  const next=parseBody(bytes); // 合わない素体はここで止まる
  body=next;skinner=makeSkinner(body);bodyIsBuiltIn=builtIn;parts=null;shown=null;meshes=[];meshCache=new WeakMap();running=null;wantExport=false;
  startWorker();worker.postMessage({type:'body',bytes});
  clothGroup=[];await showBodyModel(bytes);aim();renderSheet();run('draft');
}
const useBuiltIn=()=>{if(!bodyIsBuiltIn)useBody(builtInBytes(),true).catch(e=>status(e.message,true));};
$('open-body').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{await useBody(new Uint8Array(await f.arrayBuffer()),false);}catch(err){status(err.message,true);}};

// ---------- 保存と書き出し ----------
const inClaude=!!(window.claude&&window.claude.use);
const downloadsReady=inClaude?window.claude.use('downloads').catch(()=>null):Promise.resolve(null);
const safeName=s=>s.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,60)||'衣装';
async function save(filename,data,type){
  if(inClaude){
    const d=await downloadsReady;if(!d){status('この画面ではファイルを保存できません。ブラウザで開き直してください。',true);return false;}
    try{await d.save({filename,data});return true;}
    catch(err){status(err.code==='declined'?'保存を取りやめました。もう一度ボタンを押すと保存できます。':err.code==='rate_limited'?'少し待ってから、もう一度押してください。':'保存できませんでした（'+err.code+'）。',true);return false;}
  }
  const a=el('a',{href:URL.createObjectURL(new Blob([data],{type})),download:filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);return true;
}
async function saveDesign(){const name=safeName(design.name)+'.json';if(await save(name,JSON.stringify(design,null,2),'application/json'))status('型を保存しました：'+name);}
$('open-design').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const data=JSON.parse(await f.text());if(!data||!data.top||!data.sleeve)throw 0;replaceDesign(data);status('型を開きました：'+design.name);}catch{status('この JSON は仕立て屋の型として読めません。',true);}};
async function saveGLB(){
  const glb=exportGLB(body,buildMeshes(body,skinner,parts,design,meshCache)),base=safeName(design.name)+'_衣装';
  lastFile=inClaude?base+'.zip':base+'.glb';
  const ok=inClaude?await save(lastFile,zipOne(base+'.glb',glb),'application/zip'):await save(lastFile,glb,'model/gltf-binary');
  refreshActions();
  if(ok)status(inClaude?`保存しました：${lastFile}（展開すると GLB が入っています）`:`保存しました：${lastFile}`);
}
$('export').onclick=()=>{if(isCurrent('fine')&&!running){saveGLB();return;}wantExport=true;run('fine');refreshActions();};
$('finish').onclick=()=>run('fine');
$('undo').onclick=()=>{const prev=history.pop();if(!prev)return;design=prev;committed=copy(prev);store();renderTabs();renderSheet();redraw();sync();};

renderTabs();renderSheet();
useBody(builtInBytes(),true).catch(e=>status('始められませんでした：'+e.message,true));
