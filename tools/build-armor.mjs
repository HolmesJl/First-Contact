/**
 * Lite Body Armor assets, built from the game's body glbs (client/public/models/body-<sex>.glb):
 *   client/public/models/armor/<sex>.glb          plate shells (cuirass, pauldrons, boots, shins, thighs, bracers)
 *                                                  skinned to the Quaternius skeleton, so every clip still works
 *   client/public/models/armor/<sex>.webp          armor colour layer (RGBA) to composite over the jumpsuit texture
 *   client/public/models/armor/<sex>-normal.webp   armor normal layer (RGBA)
 *   client/public/models/armor/<sex>-primary.webp  primary-colour mask (tinted at runtime)
 *   client/public/models/armor/<sex>-accent.webp   trim mask (recoloured to the job colour at runtime)
 *
 *   cd tools && npm install && npm run build:armor
 *
 * The shells are the body's own surface in the plate regions (tools/armor-regions.mjs), cut along the region's
 * iso-line, pushed out along the surface normal by the plate thickness, stiffened with a little Laplacian
 * smoothing and closed with a rim. Because they reuse the body's vertices, UVs, joints and weights, they deform
 * exactly like the body underneath and are textured by the same armor layer the body wears.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import { SC_COUNT, readBody, smooth } from './body-raster.mjs';
import { SHELLS, armorFrame, armorRegions } from './armor-regions.mjs';
import { PRIMARY, paintArmor } from './armor-painter.mjs';

const HERE = import.meta.dirname;
const PUBLIC = path.resolve(HERE, '../client/public/models');
const OUT = path.join(PUBLIC, 'armor');
const ISO = 0.5;
/** Rim inner edge sits this far off the body so it does not z-fight with the painted body. */
const RIM_INSET = 0.0015;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const v3 = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subv = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a, b, s) => a.map((x, k) => x + (b[k] - x) * s);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Per-vertex region masks for the whole body. */
function regionValues(body) {
  const f = armorFrame(body);
  const out = Object.fromEntries(Object.keys(SHELLS).map((k) => [k, new Float32Array(body.nVert)]));
  const sc = new Float32Array(SC_COUNT);
  for (let v = 0; v < body.nVert; v++) {
    for (let k = 0; k < SC_COUNT; k++) sc[k] = body.scalars[v * SC_COUNT + k];
    const r = armorRegions(f, v3(body.pos, v), v3(body.nrm, v), sc);
    for (const k of Object.keys(SHELLS)) out[k][v] = r[k];
  }
  return out;
}

/**
 * One shell: the body triangles inside the region (clipped to its iso-line), offset and closed with a rim.
 * Returns flat attribute arrays ready for a glTF primitive.
 */
function buildShell(body, R, { thickness, smoothing }) {
  const { pos, nrm, uv, jnt, wgt, idx } = body;
  const verts = []; // { p, n, uv, j, w, r }
  const faces = [];
  const orig = new Map();
  const cut = new Map();
  const vert = (i) => {
    let o = orig.get(i);
    if (o === undefined) {
      o = verts.length;
      verts.push({ p: v3(pos, i), n: v3(nrm, i), uv: [uv[i * 2], uv[i * 2 + 1]], j: Array.from(jnt.subarray(i * 4, i * 4 + 4)), w: Array.from(wgt.subarray(i * 4, i * 4 + 4)), r: R[i] });
      orig.set(i, o);
    }
    return o;
  };
  const onEdge = (i, j) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    let o = cut.get(key);
    if (o === undefined) {
      const s = (ISO - R[i]) / (R[j] - R[i]);
      const near = s < 0.5 ? i : j;
      o = verts.length;
      verts.push({
        p: lerp(v3(pos, i), v3(pos, j), s),
        n: norm(lerp(v3(nrm, i), v3(nrm, j), s)),
        uv: [uv[i * 2] + (uv[j * 2] - uv[i * 2]) * s, uv[i * 2 + 1] + (uv[j * 2 + 1] - uv[i * 2 + 1]) * s],
        j: Array.from(jnt.subarray(near * 4, near * 4 + 4)),
        w: Array.from(wgt.subarray(near * 4, near * 4 + 4)),
        r: ISO,
      });
      cut.set(key, o);
    }
    return o;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ia = R[a] > ISO, ib = R[b] > ISO, ic = R[c] > ISO;
    const count = ia + ib + ic;
    if (count === 0) continue;
    if (count === 3) faces.push([vert(a), vert(b), vert(c)]);
    else if (count === 1) {
      if (ia) faces.push([vert(a), onEdge(a, b), onEdge(c, a)]);
      else if (ib) faces.push([onEdge(a, b), vert(b), onEdge(b, c)]);
      else faces.push([onEdge(c, a), onEdge(b, c), vert(c)]);
    } else {
      if (!ic) faces.push([vert(a), vert(b), onEdge(b, c)], [vert(a), onEdge(b, c), onEdge(c, a)]);
      else if (!ia) faces.push([onEdge(a, b), vert(b), vert(c)], [onEdge(a, b), vert(c), onEdge(c, a)]);
      else faces.push([vert(a), onEdge(a, b), onEdge(b, c)], [vert(a), onEdge(b, c), vert(c)]);
    }
  }
  if (!faces.length) return null;

  // weld by position: the body duplicates vertices along UV seams, the shell must not crack there
  const pointOf = new Int32Array(verts.length);
  const points = [];
  const keyOf = new Map();
  verts.forEach((v, i) => {
    const key = v.p.map((x) => Math.round(x * 2e4)).join(',');
    let pt = keyOf.get(key);
    if (pt === undefined) {
      pt = points.length;
      points.push({ verts: [], nb: new Set(), faces: 0, boundary: false });
      keyOf.set(key, pt);
    }
    points[pt].verts.push(i);
    pointOf[i] = pt;
  });
  const edgeCount = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const a = pointOf[f[k]], b = pointOf[f[(k + 1) % 3]];
      points[a].nb.add(b);
      points[b].nb.add(a);
      edgeCount.set(edgeKey(a, b), (edgeCount.get(edgeKey(a, b)) ?? 0) + 1);
    }
  }
  for (const [key, n] of edgeCount) if (n === 1) for (const pt of key.split('_')) points[+pt].boundary = true;

  // welded body normal and position per point, then the outward offset
  const pointP = points.map((pt) => verts[pt.verts[0]].p);
  const pointN = points.map((pt) => norm(pt.verts.reduce((acc, i) => addv(acc, verts[i].n), [0, 0, 0])));
  const outer = points.map((pt, i) => {
    const r = verts[pt.verts[0]].r;
    const taper = 0.55 + 0.45 * smooth(ISO, 0.8, r);
    const q = addv(pointP[i], scale(pointN[i], thickness * taper));
    // never below the body point: boot soles stay on the floor
    if (q[1] < pointP[i][1]) q[1] = pointP[i][1] + 0.001;
    return q;
  });
  for (let it = 0; it < smoothing; it++) {
    const next = outer.map((q, i) => {
      if (points[i].boundary || points[i].nb.size === 0) return q;
      let acc = [0, 0, 0];
      for (const nb of points[i].nb) acc = addv(acc, outer[nb]);
      return lerp(q, scale(acc, 1 / points[i].nb.size), 0.5);
    });
    for (let i = 0; i < outer.length; i++) {
      // smoothing pulls concave areas inwards; keep a minimum clearance from the body
      const d = dot3(subv(next[i], pointP[i]), pointN[i]);
      const minOff = thickness * 0.45;
      outer[i] = d < minOff ? addv(next[i], scale(pointN[i], minOff - d)) : next[i];
    }
  }

  // outer surface normals from the shell faces
  const faceN = faces.map((f) => norm(cross(subv(outer[pointOf[f[1]]], outer[pointOf[f[0]]]), subv(outer[pointOf[f[2]]], outer[pointOf[f[0]]]))));
  const outerN = points.map(() => [0, 0, 0]);
  faces.forEach((f, fi) => {
    for (const vi of f) outerN[pointOf[vi]] = addv(outerN[pointOf[vi]], faceN[fi]);
  });

  const P = [], Nn = [], UV = [], Jn = [], W = [], I = [];
  const push = (p, n, uvv, j, w) => {
    P.push(...p);
    Nn.push(...n);
    UV.push(...uvv);
    Jn.push(...j);
    W.push(...w);
    return P.length / 3 - 1;
  };
  const outIndex = verts.map((v, i) => push(outer[pointOf[i]], norm(outerN[pointOf[i]]), v.uv, v.j, v.w));
  for (const f of faces) I.push(outIndex[f[0]], outIndex[f[1]], outIndex[f[2]]);

  // rim: a flat-shaded quad from each boundary edge down to just above the body surface
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      if (edgeCount.get(edgeKey(pointOf[a], pointOf[b])) !== 1) continue;
      const va = verts[a], vb = verts[b];
      const aOut = outer[pointOf[a]], bOut = outer[pointOf[b]];
      const aIn = addv(pointP[pointOf[a]], scale(pointN[pointOf[a]], RIM_INSET));
      const bIn = addv(pointP[pointOf[b]], scale(pointN[pointOf[b]], RIM_INSET));
      const n = norm(cross(subv(aIn, aOut), subv(bIn, aIn)));
      const i0 = push(aOut, n, va.uv, va.j, va.w);
      const i1 = push(aIn, n, va.uv, va.j, va.w);
      const i2 = push(bIn, n, vb.uv, vb.j, vb.w);
      const i3 = push(bOut, n, vb.uv, vb.j, vb.w);
      I.push(i0, i1, i2, i0, i2, i3);
    }
  }
  return { P, N: Nn, UV, J: Jn, W, I, vertices: P.length / 3, faces: I.length / 3 };
}

async function buildSex(sex) {
  const src = path.join(PUBLIC, `body-${sex}.glb`);
  const body = await readBody(src);
  const { doc, prim, skin } = body;
  const root = doc.getRoot();
  const armature = root.listNodes().find((n) => n.getName() === 'Armature');
  const jointsType = prim.getAttribute('JOINTS_0').getArray().constructor;

  const regions = regionValues(body);
  const material = doc.createMaterial('Armor').setBaseColorFactor([0.8, 0.8, 0.8, 1]).setRoughnessFactor(0.55).setMetallicFactor(0);
  const buffer = root.listBuffers()[0];
  const summary = {};
  const shellNodes = [];
  for (const [name, cfg] of Object.entries(SHELLS)) {
    const shell = buildShell(body, regions[name], cfg);
    if (!shell) throw new Error(`${sex}: empty shell ${name}`);
    summary[name] = { vertices: shell.vertices, faces: shell.faces };
    const acc = (type, arr, Ctor) => doc.createAccessor().setType(type).setArray(Ctor.from(arr)).setBuffer(buffer);
    const p = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', shell.P, Float32Array))
      .setAttribute('NORMAL', acc('VEC3', shell.N, Float32Array))
      .setAttribute('TEXCOORD_0', acc('VEC2', shell.UV, Float32Array))
      .setAttribute('JOINTS_0', acc('VEC4', shell.J, jointsType))
      .setAttribute('WEIGHTS_0', acc('VEC4', shell.W, Float32Array))
      .setIndices(acc('SCALAR', shell.I, Uint16Array))
      .setMaterial(material);
    const meshName = `Armor${name[0].toUpperCase()}${name.slice(1)}`;
    const mesh = doc.createMesh(meshName).addPrimitive(p);
    shellNodes.push(doc.createNode(meshName).setMesh(mesh).setSkin(skin));
  }

  // drop the body, face and hair meshes; keep the armature (the skin's joints) and add the shells
  for (const node of armature.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    mesh.listPrimitives().forEach((pr) => pr.dispose());
    mesh.dispose();
    node.dispose();
  }
  for (const n of shellNodes) armature.addChild(n);
  for (const s of root.listSkins()) if (s !== skin) s.dispose();
  for (const m of root.listMaterials()) if (m !== material) m.dispose();
  root.listTextures().forEach((t) => t.dispose());
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true }), dedup(), quantize({ pattern: /^(NORMAL|TEXCOORD_0|WEIGHTS_0)$/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }));
  const glb = path.join(OUT, `${sex}.glb`);
  await io.write(glb, doc);

  const paint = await paintArmor({ glbPath: src });
  fs.writeFileSync(path.join(OUT, `${sex}.webp`), paint.color);
  fs.writeFileSync(path.join(OUT, `${sex}-normal.webp`), paint.normal);
  fs.writeFileSync(path.join(OUT, `${sex}-primary.webp`), paint.primary);
  fs.writeFileSync(path.join(OUT, `${sex}-accent.webp`), paint.accent);

  const kb = (f) => `${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`;
  console.log(`${sex}.glb ${kb(`${sex}.glb`)}  ${Object.entries(summary).map(([k, v]) => `${k} ${v.vertices}v/${v.faces}f`).join(', ')}`);
  console.log(`${sex}.webp ${kb(`${sex}.webp`)}, normal ${kb(`${sex}-normal.webp`)}, primary ${kb(`${sex}-primary.webp`)}, accent ${kb(`${sex}-accent.webp`)}`);
  return summary;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const summary = {};
for (const sex of ['male', 'female']) summary[sex] = await buildSex(sex);
fs.writeFileSync(
  path.join(OUT, 'armor.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), primary: PRIMARY, shells: Object.fromEntries(Object.entries(SHELLS).map(([k, v]) => [k, v.thickness])), vertices: summary }, null, 1),
);
console.log('armor.json written');
