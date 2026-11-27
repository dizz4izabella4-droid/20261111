// Rebuild only kugutsu's male sample using the sibling spare-body generator.
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../spare-body/_src/', import.meta.url));
const female = process.argv.includes('--female');
const output = fileURLToPath(new URL(`../public/samples/spare_body_${female ? 'female' : 'male'}.glb`, import.meta.url));
const server = await createServer({ root: source, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { presetParams, clampParams } = await server.ssrLoadModule('/src/model/params.ts');
  const { buildBody } = await server.ssrLoadModule('/src/model/body.ts');
  const { hexToLinear } = await server.ssrLoadModule('/src/export/glb.ts');
  const { exportBodyGlb } = await server.ssrLoadModule('/src/export/exportBody.ts');
  const params = female ? presetParams('female') : clampParams({
    ...presetParams('male'),
    headWidth: 0.155, headDepth: 0.185, neckBaseWidth: 0.105,
    shoulderWidth: 0.38, chestDepth: 0.205, underbustCirc: 0.82,
    waistCirc: 0.69, hipCirc: 0.85, hipJointSpacing: 0.18,
    size: 22, projection: 0.004, baseWidth: 0.18, spacing: 0.18,
    upperArmCirc: 0.27, elbowCirc: 0.235, forearmCirc: 0.24, wristCirc: 0.165,
    handWidth: 0.082, handThickness: 0.033,
    thighCirc: 0.49, kneeCirc: 0.33, calfCirc: 0.33, ankleCirc: 0.215,
    footWidth: 0.095,
  });
  const body = buildBody(params, 'standard');
  const glb = Buffer.from(exportBodyGlb(body, params, female ? 'spare_body_female' : 'spare_body_male'));
  // Set the metal finish without modifying spare-body's shared exporter.
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  if (!female) {
    json.materials[0].name = 'body_silver';
    Object.assign(json.materials[0].pbrMetallicRoughness, { baseColorFactor: [...hexToLinear(0xbfc4cc), 1], metallicFactor: 0.55, roughnessFactor: 0.32 });
  }
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const tail = glb.subarray(20 + jsonLength);
  const header = Buffer.from(glb.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12);
  writeFileSync(output, Buffer.concat([header, padded, tail]));
  console.log(`${female ? 'Female' : 'Male silver slim'} sample with softness, height ${body.height.toFixed(2)} m`);
  if (body.warnings.length) console.log(body.warnings);
} finally {
  await server.close();
}
