// Run with node. Set PLAYWRIGHT_MODULE if playwright-core is not installed locally.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:/,r=>{remote.push(r.request().url());return r.abort()});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 assert.equal(await page.locator('#part option').count(),1,'offline startup');
 assert.equal(await page.evaluate(()=>Object.values(loaders).length),7);
 const importFiles=async files=>{
   await page.locator('#fModel').setInputFiles(files.map(([name,text])=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(text)})));
   await page.waitForFunction(()=>!document.getElementById('warn').textContent.includes('読み込み中'));
   assert.ok(!/読み込めませんでした/.test(await page.locator('#warn').textContent()),await page.locator('#warn').textContent());
   assert.ok(await page.evaluate(()=>parts.length>0&&cur.geometry.attributes.uv&&cur.userData.layers.length===1));
 };
 const obj='o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
 await importFiles([['triangle.obj',obj]]);console.log('PASS OBJ without UV: automatic unwrap');
 const glb=await page.evaluate(()=>new Promise(resolve=>new THREE.GLTFExporter().parse(root,r=>resolve(Array.from(new Uint8Array(r))),{binary:true})));
 await importFiles([['roundtrip.glb',glb]]);console.log('PASS GLB export / import');
 const gltf=await page.evaluate(()=>new Promise(resolve=>new THREE.GLTFExporter().parse(root,r=>resolve(r),{binary:false})));
 const bin=Buffer.from(gltf.buffers[0].uri.split(',')[1],'base64');gltf.buffers[0].uri='mesh.bin';
 await importFiles([['mesh.gltf',JSON.stringify(gltf)],['mesh.bin',bin]]);console.log('PASS GLTF with external BIN');
 await importFiles([['triangle.stl','solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle']]);console.log('PASS STL');
 await importFiles([['triangle.ply','ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n']]);console.log('PASS PLY');
 const dae='<COLLADA version="1.4.1"><asset><up_axis>Y_UP</up_axis></asset><library_geometries><geometry id="geo"><mesh><source id="pos"><float_array id="pos-array" count="9">0 0 0 1 0 0 0 1 0</float_array><technique_common><accessor source="#pos-array" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="verts"><input semantic="POSITION" source="#pos"/></vertices><triangles count="1"><input semantic="VERTEX" source="#verts" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="Scene"><node id="triangle"><instance_geometry url="#geo"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#Scene"/></scene></COLLADA>';
 await importFiles([['triangle.dae',dae]]);console.log('PASS DAE');
 const zip=await page.evaluate(async obj=>{const z=new JSZip();z.file('folder/triangle.obj',obj);return Array.from(await z.generateAsync({type:'uint8array',compression:'DEFLATE'}))},obj);
 await importFiles([['model.zip',zip]]);console.log('PASS compressed ZIP');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await importFiles([['triangle.obj','mtllib triangle.mtl\n'+obj.replace('f 1','usemtl Skin\nf 1')],['triangle.mtl','newmtl Skin\nKd 1 1 1\nmap_Kd skin.png\n'],['skin.png',png]]);
 await page.waitForFunction(()=>images.length>0);await page.click('#apply');
 assert.ok(!(await page.locator('#warn').textContent()).includes('先に'));console.log('PASS OBJ + MTL + image, apply texture');
 // A rejected import must leave the current editable model intact.
 await page.locator('#fModel').setInputFiles({name:'broken.glb',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
 await page.waitForFunction(()=>document.getElementById('warn').textContent.includes('モデルを読み込めませんでした'));
 assert.ok(await page.evaluate(()=>parts.length===1&&cur.userData.layers.length===1));console.log('PASS invalid model: visible error, previous model retained');
 await page.locator('#fModel').setInputFiles({name:'empty.obj',mimeType:'text/plain',buffer:Buffer.from('# no meshes')});
 await page.waitForFunction(()=>document.getElementById('warn').textContent.includes('メッシュがありません'));
 assert.ok(await page.evaluate(()=>parts.length===1));console.log('PASS empty model: rejected');
 await page.locator('#fModel').setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:Buffer.from('broken')});
 await page.waitForFunction(()=>document.getElementById('warn').textContent.includes('ZIPを開けませんでした'));console.log('PASS invalid ZIP: visible error');
 await page.locator('#fModel').setInputFiles({name:'missing.gltf',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(gltf))});
 await page.waitForFunction(()=>document.getElementById('warn').textContent.includes('モデルを読み込めませんでした'));console.log('PASS missing BIN: visible error');
 await importFiles([['triangle.obj',obj]]);console.log('PASS valid import after errors');
 for(const name of ['female','male']){
   const file=path.resolve(__dirname,'../../kugutsu/samples/spare_body_'+name+'.glb');
   await page.locator('#fModel').setInputFiles(file);
   await page.waitForFunction(()=>parts.some(m=>m.isSkinnedMesh));
   assert.ok(await page.evaluate(()=>parts.every(m=>m.geometry.attributes.uv&&m.userData.layers.length===1)));
   console.log('PASS actual spare-body '+name+' skinned GLB');
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:process.env.SCREENSHOT_PATH||'/tmp/texture-model-fixed.png'});
 assert.deepEqual(errors,[],'uncaught browser errors');assert.deepEqual(remote,[],'no external dependencies');
 console.log('PASS mobile viewport, offline operation, no uncaught errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
