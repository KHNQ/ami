import * as THREE from "three";

// Shared material palette + part registration used by every device
// archetype. Keeping these in one place means all the models read as one
// product family rather than five unrelated toys.

export const WHITE = 0xf2f4f7;
export const SHELL_GREY = 0xd7dce4;
export const DARK = 0x14161c;
export const STEEL = 0x8b93a3;

export function shellMaterial(color = WHITE) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.06 });
}

export function metalMaterial(color = STEEL) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.85 });
}

export function plasticMaterial(color = DARK) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
}

// Emissive display panel. `accent` is the per-product brand colour from the
// registry, so each device's screen glows in its own hue.
export function screenMaterial(accent = 0x22c55e) {
  return new THREE.MeshStandardMaterial({
    color: 0x0b1220,
    emissive: new THREE.Color(accent),
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0,
  });
}

// Registers a mesh as an explodable part: remembers where it belongs when
// assembled, and which direction it flies off toward when taken apart.
export function registerPart(parts, mesh, explodeOffset, spin = [0, 0, 0]) {
  mesh.userData.restPosition = mesh.position.clone();
  mesh.userData.restQuaternion = mesh.quaternion.clone();
  mesh.userData.explodeOffset = new THREE.Vector3(...explodeOffset);
  mesh.userData.explodeSpin = new THREE.Euler(...spin);
  parts.push(mesh);
  return mesh;
}

// t = 0 fully assembled, t = 1 fully exploded. Shared by every archetype so
// the auth-page reactions and the scroll-scrubbed heroes behave identically
// no matter which device is on screen.
export function applyExplode(parts, t) {
  const eased = t * t * (3 - 2 * t); // smoothstep -- softer at both ends
  for (const mesh of parts) {
    const rest = mesh.userData.restPosition;
    const off = mesh.userData.explodeOffset;
    mesh.position.set(rest.x + off.x * eased, rest.y + off.y * eased, rest.z + off.z * eased);
    const spin = mesh.userData.explodeSpin;
    mesh.quaternion.copy(mesh.userData.restQuaternion);
    if (spin.x || spin.y || spin.z) {
      mesh.rotateX(spin.x * eased);
      mesh.rotateY(spin.y * eased);
      mesh.rotateZ(spin.z * eased);
    }
  }
}

// Frees every GPU-side resource an archetype allocated. Geometries and
// materials are shared across meshes, so dedupe before disposing.
export function disposeDevice({ root }) {
  const seenGeo = new Set();
  const seenMat = new Set();
  const seenTex = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.geometry && !seenGeo.has(obj.geometry)) {
      seenGeo.add(obj.geometry);
      obj.geometry.dispose();
    }
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat || seenMat.has(mat)) continue;
      seenMat.add(mat);
      // material.dispose() does NOT release the textures hanging off it --
      // the branding/vent decals below are canvas-backed, so without this
      // every rebuild of a decalled device would leak a GPU texture.
      for (const key of ["map", "emissiveMap", "alphaMap", "roughnessMap", "normalMap"]) {
        const tex = mat[key];
        if (tex && tex.isTexture && !seenTex.has(tex)) {
          seenTex.add(tex);
          tex.dispose();
        }
      }
      mat.dispose();
    }
  });
}

// --- procedural decals --------------------------------------------------

// Draws into an offscreen canvas and hands back a texture. Returns null
// when there's no usable 2D context -- jsdom (where the geometry tests run)
// has a `canvas` element but no drawing backend, and every caller is
// expected to fall back to a flat material rather than skip the mesh, so
// part counts stay identical in the browser and under test.
let canvas2dSupported = null; // memoized: jsdom logs a warning per probe

function has2dContext() {
  if (canvas2dSupported !== null) return canvas2dSupported;
  if (typeof document === "undefined") {
    canvas2dSupported = false;
    return false;
  }
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    canvas2dSupported = !!ctx && typeof ctx.fillRect === "function";
  } catch {
    canvas2dSupported = false;
  }
  return canvas2dSupported;
}

export function decalTexture(draw, { width = 256, height = 512 } = {}) {
  if (!has2dContext()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// A decal material that degrades to a plain tint when no canvas is
// available, so the mesh is always created either way.
export function decalMaterial(texture, fallbackColor = 0x2a2e36) {
  if (!texture) {
    return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.85 });
  }
  return new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.55, metalness: 0.05 });
}

// Same idea for a live UI panel: the drawn canvas doubles as the emissive
// map so the interface itself glows, rather than being a flat sticker lit
// only by the scene. Falls back to the plain accent glow of screenMaterial.
export function screenDecalMaterial(texture, accent = 0x22c55e) {
  if (!texture) return screenMaterial(accent);
  return new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.85,
    roughness: 0.22,
    metalness: 0,
  });
}

// --- small composite builders reused across archetypes ---

// Rolling clinic cart: the base every floor-standing unit sits on.
export function addCasterBase(root, parts, { y = -2.1, radius = 0.95 } = {}) {
  const dark = plasticMaterial();
  const steel = metalMaterial();

  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.06, 0.16, 40), dark);
  base.position.set(0, y, 0);
  registerPart(parts, base, [0, -1.4, 0]);
  root.add(base);

  // Four casters around the base edge.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 14), steel);
    caster.rotation.z = Math.PI / 2;
    caster.position.set(Math.cos(angle) * radius * 0.78, y - 0.14, Math.sin(angle) * radius * 0.78);
    registerPart(parts, caster, [Math.cos(angle) * 2.2, -0.9, Math.sin(angle) * 2.2], [0.8, 0, 0]);
    root.add(caster);
  }
  return base;
}

// Tilted display head on a pivot -- the "face" of most of these devices.
export function addDisplayHead(root, parts, accent, { y = 1.45, z = 0.06, w = 1.3, h = 0.9, tilt = -0.3 } = {}) {
  const pivot = new THREE.Group();
  pivot.position.set(0, y, z);
  pivot.rotation.x = tilt;
  root.add(pivot);

  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), shellMaterial());
  registerPart(parts, shell, [0, 1.5, 0.25]);
  pivot.add(shell);

  const material = screenMaterial(accent);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.84, h * 0.76), material);
  glass.position.set(0, 0, 0.08);
  registerPart(parts, glass, [0, 1.9, 0.6]);
  pivot.add(glass);

  return { pivot, material };
}

// A coiled cable hanging between two points -- every laser and RF platform
// in this catalogue has one looping from the console down to a handpiece,
// and it's the most recognisable silhouette detail on the real hardware.
export function addCoiledCable(root, parts, { from = [0, 0.6, 0.5], to = [0.8, -0.4, 0.5], coils = 9, radius = 0.11 } = {}) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const dark = plasticMaterial(0x2a2e38);
  const span = new THREE.Vector3().subVectors(end, start);
  // 3 links per turn reads as a coil while keeping the draw-call count
  // sane on phones -- these rigs already run 20-70 meshes.
  const segs = coils * 3;

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Sag the cable under gravity, then wrap it in a helix.
    const sag = Math.sin(t * Math.PI) * 0.45;
    const angle = t * coils * Math.PI * 2;
    const p = start.clone().addScaledVector(span, t);
    p.y -= sag;
    p.x += Math.cos(angle) * radius;
    p.z += Math.sin(angle) * radius * 0.6;

    const link = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), dark);
    link.position.copy(p);
    registerPart(parts, link, [span.x * 1.5 + Math.cos(angle) * 1.2, -0.8, 1.0 + Math.sin(angle) * 0.6]);
    root.add(link);
  }
}

// Rounded-rectangle profile for ExtrudeGeometry shells -- the cross-section
// of every moulded-polymer tower in this catalogue. Built in the XY plane;
// extrude along Z and rotate -90deg about X to stand it upright.
export function roundedRectShape(width, depth, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  const r = Math.min(radius, width / 2, depth / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + depth - r);
  shape.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth);
  shape.lineTo(x + r, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// A smooth cable swept along a spline -- ONE mesh, unlike addCoiledCable's
// bead chain. Use this for the soft umbilicals that hang off a console:
// a device with three applicators would otherwise pay ~50 draw calls just
// for its hoses.
export function addTubeCable(root, parts, { points, radius = 0.05, material, explodeOffset = [0, -1, 1.4], segments }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments ?? Math.max(16, points.length * 8), radius, 8, false),
    material || plasticMaterial(0x3a3f47)
  );
  registerPart(parts, tube, explodeOffset);
  root.add(tube);
  return tube;
}

// Row of indicator LEDs on a console face.
export function addIndicatorRow(root, parts, accent, { x = 0, y = 0, z = 0.5, count = 3, gap = 0.11 } = {}) {
  for (let i = 0; i < count; i++) {
    const led = new THREE.Mesh(
      new THREE.CircleGeometry(0.026, 12),
      new THREE.MeshStandardMaterial({
        color: 0x0b1220,
        emissive: new THREE.Color(i === 0 ? accent : 0x64748b),
        emissiveIntensity: i === 0 ? 1.4 : 0.35,
        roughness: 0.3,
      })
    );
    led.position.set(x + (i - (count - 1) / 2) * gap, y, z);
    registerPart(parts, led, [0, 0.9, 1.3]);
    root.add(led);
  }
}

// A handpiece on a coiled cable -- lasers and RF platforms all have one or
// more of these hanging off a holster.
export function addHandpiece(root, parts, { x = 0.9, y = 0.2, z = 0.4, len = 0.5, tilt = 0.4 } = {}) {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, len, 6, 14), plasticMaterial());
  body.position.set(x, y, z);
  body.rotation.z = tilt;
  registerPart(parts, body, [x * 2.4, 0.2, z + 1.2], [0.5, 0, tilt]);
  root.add(body);

  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.12, 14), metalMaterial());
  tip.position.set(x - Math.sin(tilt) * (len / 2 + 0.08), y - Math.cos(tilt) * (len / 2 + 0.08), z);
  tip.rotation.z = tilt;
  registerPart(parts, tip, [x * 2.8, -0.2, z + 1.5], [0, 0, 1]);
  root.add(tip);

  return body;
}
