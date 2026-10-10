/** Control math sanity check: `npm run check:controls`. Angle wrapping, "behind", shortest-path return, key movement. */
import { axesFromKeys, behindYaw, cameraForward, cameraYaw, moveVector, returnOffset, shortestDelta, wrapAngle } from './controlMath';

const problems: string[] = [];
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const expect = (name: string, ok: boolean, detail = '') => {
  if (!ok) problems.push(`${name} ${detail}`);
};
const expectVec = (name: string, v: { x: number; z: number }, x: number, z: number) =>
  expect(name, near(v.x, x, 1e-9) && near(v.z, z, 1e-9), `got (${v.x.toFixed(3)}, ${v.z.toFixed(3)}) want (${x}, ${z})`);

// wrapAngle lands in (-PI, PI]
for (const a of [0, 1, -1, Math.PI, -Math.PI, 3 * Math.PI, -3 * Math.PI, 7, -7, 100, -100]) {
  const w = wrapAngle(a);
  expect(`wrapAngle(${a}) range`, w > -Math.PI - 1e-12 && w <= Math.PI + 1e-12, `got ${w}`);
  expect(`wrapAngle(${a}) equivalent`, near(Math.cos(w), Math.cos(a), 1e-9) && near(Math.sin(w), Math.sin(a), 1e-9));
}
expect('wrapAngle(-PI) is +PI', near(wrapAngle(-Math.PI), Math.PI));

// shortest path never exceeds half a turn
expect('shortestDelta across the seam', near(shortestDelta(3, -3), 2 * Math.PI - 6));
expect('shortestDelta negative way', near(shortestDelta(-3, 3), 6 - 2 * Math.PI));
for (let a = -10; a < 10; a += 0.37) for (let b = -10; b < 10; b += 0.41) expect('shortestDelta bound', Math.abs(shortestDelta(a, b)) <= Math.PI + 1e-9);

// behind: the camera sits opposite the facing, so it looks the way the character looks
for (const f of [0, 0.5, Math.PI / 2, -2, 3.1, 9]) {
  const look = cameraForward(behindYaw(f));
  expectVec(`camera at behind(${f}) looks along facing`, look, Math.sin(f), Math.cos(f));
  expect(`cameraYaw(${f}, 0) === behindYaw`, near(cameraYaw(f, 0), behindYaw(f)));
}

// movement from keys and facing: facing 0 looks down +z, screen-right is -x
const keys = (...k: string[]) => axesFromKeys(new Set(k));
const mv = (k: string[], f: number) => {
  const a = keys(...k);
  return moveVector(a.x, a.y, f);
};
expectVec('W facing 0', mv(['KeyW'], 0), 0, 1);
expectVec('S facing 0', mv(['KeyS'], 0), 0, -1);
expectVec('D facing 0', mv(['KeyD'], 0), -1, 0);
expectVec('A facing 0', mv(['KeyA'], 0), 1, 0);
expectVec('W facing +x', mv(['KeyW'], Math.PI / 2), 1, 0);
expectVec('D facing +x', mv(['KeyD'], Math.PI / 2), 0, 1);
expectVec('A facing +x', mv(['KeyA'], Math.PI / 2), 0, -1);
expectVec('S facing PI', mv(['KeyS'], Math.PI), 0, 1);
expectVec('W+S cancel', mv(['KeyW', 'KeyS'], 1), 0, 0);
expectVec('no keys', mv([], 1), 0, 0);
expectVec('arrow up = W', mv(['ArrowUp'], 0), 0, 1);
const diag = mv(['KeyW', 'KeyD'], 0.7);
expect('diagonal is unit length', near(Math.hypot(diag.x, diag.z), 1) && near(diag.mag, 1));
// the right-hand key moves to the screen-right of the camera that sits behind the character
for (const f of [0, 1, 2.5, -1.3]) {
  const cam = cameraForward(behindYaw(f));
  const right = moveVector(1, 0, f);
  expect(`D is right of forward at ${f}`, near(cam.x * right.z - cam.z * right.x, 1, 1e-9), `cross ${cam.x * right.z - cam.z * right.x}`);
}
// half-stick is half speed
expect('half stick', near(moveVector(0, 0.5, 0).mag, 0.5));

// return tween: shortest way to 0, starts at the offset, ends at 0, monotonic
expect('return start', near(returnOffset(2, 0, 0.4), 2));
expect('return end', near(returnOffset(2, 0.4, 0.4), 0));
expect('return past end', near(returnOffset(2, 9, 0.4), 0));
expect('return from 190 deg goes the short way', returnOffset((190 * Math.PI) / 180, 0, 0.4) < 0);
expect('return from -190 deg goes the short way', returnOffset((-190 * Math.PI) / 180, 0, 0.4) > 0);
for (const from of [0.5, -2, 3.1, -3.1, 6]) {
  let prev = Math.abs(wrapAngle(from));
  for (let t = 0; t <= 0.4001; t += 0.02) {
    const v = Math.abs(returnOffset(from, t, 0.4));
    expect(`return monotonic from ${from}`, v <= prev + 1e-12);
    prev = v;
  }
}

if (problems.length) throw new Error(`control math problems:\n${problems.join('\n')}`);
console.log('controls ok');
