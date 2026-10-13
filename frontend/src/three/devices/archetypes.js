import * as THREE from "three";
import {
  WHITE,
  SHELL_GREY,
  shellMaterial,
  metalMaterial,
  plasticMaterial,
  screenMaterial,
  registerPart,
  addCasterBase,
  addDisplayHead,
  addHandpiece,
  addCoiledCable,
  addIndicatorRow,
  decalTexture,
  decalMaterial,
  screenDecalMaterial,
  roundedRectShape,
  addTubeCable,
} from "./parts.js";

// Five procedural archetypes covering the whole Ashkan Medical catalogue.
// None of these are loaded models -- the only source art available is flat
// 600x600 product photos on white, which can't be turned into geometry. Each
// archetype is built from primitives to match the real device's silhouette
// and the feature list recorded in content/ashkan-medical/products.json, and
// products map onto them (with their own accent colour) via registry.js.
//
// Every builder returns the same shape: { root, parts, screenMaterial } so
// DeviceStage can drive any of them interchangeably.

// --- 1. Body-composition analyzer (InBody) ------------------------------
// Column on a weighing platform, tilted display, two hand-electrode grips.
export function createAnalyzer(accent = 0x22c55e) {
  const root = new THREE.Group();
  const parts = [];
  const shellWhite = shellMaterial(WHITE);
  const shellGrey = shellMaterial(SHELL_GREY);
  const dark = plasticMaterial();
  const steel = metalMaterial();

  const baseShape = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.22, 48), dark);
  baseShape.position.set(0, -2.05, 0);
  registerPart(parts, baseShape, [0, -1.5, 0]);
  root.add(baseShape);

  const baseTop = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.06, 48), shellWhite);
  baseTop.position.set(0, -1.92, 0);
  registerPart(parts, baseTop, [0, -0.9, 0.6]);
  root.add(baseTop);

  // 8-point tactile electrode system, matching the real InBody layout:
  // an elongated *sole* plate under the ball of each foot plus a separate
  // *round* heel electrode behind it (users align heels to the round pads
  // and point their toes forward).
  const soleGeo = new THREE.BoxGeometry(0.34, 0.035, 0.5);
  const heelGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 24);
  [-0.5, 0.5].forEach((side, i) => {
    const sole = new THREE.Mesh(soleGeo, steel);
    sole.position.set(side, -1.87, 0.46);
    registerPart(parts, sole, [side * 1.8, -0.4, 1.1], [0, 0, i ? 0.4 : -0.4]);
    root.add(sole);

    const heel = new THREE.Mesh(heelGeo, steel);
    heel.position.set(side, -1.87, -0.42);
    registerPart(parts, heel, [side * 1.9, -0.5, -1.2], [0.5, 0, 0]);
    root.add(heel);
  });

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3.1, 32), shellWhite);
  column.position.set(0, -0.3, 0);
  registerPart(parts, column, [0, 0.4, -1.4]);
  root.add(column);

  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.7, 0.04), shellGrey);
  seam.position.set(0, -0.3, 0.3);
  registerPart(parts, seam, [0, 0, 1.6]);
  root.add(seam);

  const head = addDisplayHead(root, parts, accent, { y: 1.5, w: 1.34, h: 0.94, tilt: -0.32 });
  addIndicatorRow(root, parts, accent, { x: 0, y: 0.92, z: 0.33, count: 3 });

  // Hand electrodes on retractable arms.
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.62, 16), shellGrey);
    arm.position.set(side * 0.42, 0.42, 0);
    arm.rotation.z = side * 1.15;
    registerPart(parts, arm, [side * 1.8, 0.3, 0.2], [0, 0, side * 0.5]);
    root.add(arm);

    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 6, 16), plasticMaterial());
    grip.position.set(side * 0.78, 0.18, 0);
    registerPart(parts, grip, [side * 2.6, -0.1, 0.5], [0.6, 0, side * 0.8]);
    root.add(grip);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.108, 0.16, 16), steel);
    band.position.set(side * 0.78, 0.3, 0);
    registerPart(parts, band, [side * 3.1, 0.2, 0.7], [0, 0, side * 1.2]);
    root.add(band);

    // InBody's patented thumb electrode -- a small oval pad on the top
    // face of each grip, distinct from the palm contact band above.
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14), steel);
    thumb.position.set(side * 0.78, 0.05, 0.1);
    thumb.rotation.x = Math.PI / 2;
    registerPart(parts, thumb, [side * 3.4, -0.3, 1.0], [1.0, 0, 0]);
    root.add(thumb);
  });

  root.position.y = 0.35;
  return { root, parts, screenMaterial: head.material };
}

// --- 2. Laser platform on a cart ----------------------------------------
// Prime Lase / Elysion Pro / Angela / Pico Premium / Q10: a tall tower with
// a big display, an articulated delivery arm, and a handpiece in a holster.
export function createLaserCart(accent = 0x3b82f6) {
  const root = new THREE.Group();
  const parts = [];
  const shellWhite = shellMaterial(WHITE);
  const shellGrey = shellMaterial(SHELL_GREY);

  addCasterBase(root, parts, { y: -2.1, radius: 0.9 });

  // Main tower body.
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.5, 0.85), shellWhite);
  tower.position.set(0, -0.75, 0);
  registerPart(parts, tower, [0, -0.4, -1.5]);
  root.add(tower);

  // Front vent slats -- reads as a real chassis rather than a plain box.
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.045, 0.03), shellGrey);
    vent.position.set(0, -1.42 - i * 0.13, 0.44);
    registerPart(parts, vent, [0, -0.6, 1.4 + i * 0.2]);
    root.add(vent);
  }

  const head = addDisplayHead(root, parts, accent, { y: 0.95, z: 0.3, w: 1.25, h: 0.82, tilt: -0.42 });

  // Articulated delivery arm: three segments hinged off the tower top.
  const armMat = shellGrey;
  const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.1, 16), armMat);
  seg1.position.set(0.45, 0.95, -0.2);
  seg1.rotation.z = -0.9;
  registerPart(parts, seg1, [1.6, 0.9, -0.6], [0, 0, 0.8]);
  root.add(seg1);

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), metalMaterial());
  joint.position.set(0.87, 1.24, -0.2);
  registerPart(parts, joint, [2.2, 1.2, -0.4]);
  root.add(joint);

  const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.95, 16), armMat);
  seg2.position.set(1.2, 0.95, -0.2);
  seg2.rotation.z = 0.75;
  registerPart(parts, seg2, [2.8, 0.4, -0.2], [0, 0, -0.9]);
  root.add(seg2);

  addHandpiece(root, parts, { x: 1.42, y: 0.45, z: -0.2, len: 0.46, tilt: 0.25 });

  // The coiled delivery fibre looping from the console down to the
  // handpiece -- the single most recognisable detail on these carts.
  addCoiledCable(root, parts, { from: [0.3, 0.45, 0.45], to: [1.25, 0.15, 0.1], coils: 7, radius: 0.1 });

  addIndicatorRow(root, parts, accent, { x: -0.35, y: 0.32, z: 0.44, count: 3 });

  // Seam where the "plug-and-play cart module" meets the tower.
  const cartSeam = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.05, 0.89), shellGrey);
  cartSeam.position.set(0, -1.9, 0);
  registerPart(parts, cartSeam, [0, -1.2, 1.0]);
  root.add(cartSeam);

  root.position.y = 0.3;
  return { root, parts, screenMaterial: head.material };
}

// --- 3. RF / vacuum multi-handpiece platform ----------------------------
// 4Plus / Powershape 2 / Ashley / Cooltech: cart with a console top and a
// row of handpieces sitting in holsters along the side.
export function createRfPlatform(accent = 0x38bdf8) {
  const root = new THREE.Group();
  const parts = [];
  const shellWhite = shellMaterial(WHITE);
  const shellGrey = shellMaterial(SHELL_GREY);

  addCasterBase(root, parts, { y: -2.1, radius: 0.98 });

  // Lower cabinet + upper console, slightly inset for a two-tone look.
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.5, 0.95), shellWhite);
  cabinet.position.set(0, -1.2, 0);
  registerPart(parts, cabinet, [0, -1.1, -1.4]);
  root.add(cabinet);

  const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), shellGrey);
  console_.position.set(0, -0.05, 0);
  registerPart(parts, console_, [0, 0.2, -1.7]);
  root.add(console_);

  const head = addDisplayHead(root, parts, accent, { y: 0.85, z: 0.22, w: 1.3, h: 0.86, tilt: -0.5 });
  addIndicatorRow(root, parts, accent, { x: -0.4, y: 0.2, z: 0.42, count: 4, gap: 0.09 });

  // Three handpieces in holsters down the right flank.
  [0, 1, 2].forEach((i) => {
    const holster = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.028, 8, 20), shellGrey);
    holster.position.set(0.78, -0.55 - i * 0.42, 0.3);
    holster.rotation.x = Math.PI / 2;
    registerPart(parts, holster, [2.0, -0.2, 0.9], [0, 0.8, 0]);
    root.add(holster);

    addHandpiece(root, parts, { x: 0.78, y: -0.55 - i * 0.42, z: 0.3, len: 0.34, tilt: 0.1 });

    // 360-degree cooling collar around each applicator (Cooltech Define's
    // signature feature -- plates that wrap the whole treatment area).
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 20), metalMaterial());
    collar.position.set(0.78, -0.68 - i * 0.42, 0.3);
    collar.rotation.x = Math.PI / 2;
    registerPart(parts, collar, [2.4, -0.4, 1.1], [0, 1.0, 0]);
    root.add(collar);

    // Hose running from the console down to the applicator.
    addCoiledCable(root, parts, {
      from: [0.45, 0.1, 0.35],
      to: [0.78, -0.5 - i * 0.42, 0.3],
      coils: 4,
      radius: 0.06,
    });
  });

  root.position.y = 0.3;
  return { root, parts, screenMaterial: head.material };
}

// --- 4. Handheld / benchtop unit ----------------------------------------
// Exciplex (950g handheld excimer) and Wolf (compact diode laser box):
// a small chassis with a control panel and an emitter head.
export function createHandheld(accent = 0x22c55e) {
  const root = new THREE.Group();
  const parts = [];
  const shellWhite = shellMaterial(WHITE);
  const shellGrey = shellMaterial(SHELL_GREY);

  // Benchtop chassis.
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.05, 1.25), shellWhite);
  body.position.set(0, -0.5, 0);
  registerPart(parts, body, [0, -1.2, -1.2]);
  root.add(body);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.09, 1.29), shellGrey);
  trim.position.set(0, -0.02, 0);
  registerPart(parts, trim, [0, 0.9, 0.8]);
  root.add(trim);

  const material = screenMaterial(accent);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), material);
  panel.position.set(-0.35, -0.42, 0.63);
  registerPart(parts, panel, [-1.4, 0.2, 1.5]);
  root.add(panel);

  // Emitter head on a short gooseneck, the business end of the unit.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 14), shellGrey);
  neck.position.set(0.62, 0.42, 0);
  neck.rotation.z = -0.25;
  registerPart(parts, neck, [1.5, 1.2, -0.4], [0, 0, 0.7]);
  root.add(neck);

  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.34, 20), plasticMaterial());
  emitter.position.set(0.85, 0.86, 0);
  emitter.rotation.z = -0.25;
  registerPart(parts, emitter, [2.2, 1.6, 0.3], [0.7, 0, 0.5]);
  root.add(emitter);

  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), screenMaterial(accent));
  lens.position.set(0.9, 0.7, 0.02);
  lens.rotation.x = -Math.PI / 2.6;
  registerPart(parts, lens, [2.6, 1.2, 0.8]);
  root.add(lens);

  // Cylindrical bumper rails down each side of the chassis -- Wolf's
  // benchtop unit is bracketed by these.
  [-1, 1].forEach((side) => {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.05, 18), plasticMaterial(0x1b1e25));
    rail.position.set(side * 1.02, -0.5, 0);
    registerPart(parts, rail, [side * 2.4, -0.4, 0.4], [0, 0, side * 0.5]);
    root.add(rail);

    const railCap = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.1, 18), shellGrey);
    railCap.position.set(side * 1.02, 0.03, 0);
    registerPart(parts, railCap, [side * 2.7, 0.6, 0.5]);
    root.add(railCap);
  });

  // Big red emergency stop, right of the panel.
  const estop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.07, 20),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4, metalness: 0.05 })
  );
  estop.position.set(0.5, -0.42, 0.64);
  estop.rotation.x = Math.PI / 2;
  registerPart(parts, estop, [1.6, 0.2, 1.6], [1.0, 0, 0]);
  root.add(estop);

  // Screen bezel around the control panel.
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.04), plasticMaterial(0x0f1116));
  bezel.position.set(-0.35, -0.42, 0.615);
  registerPart(parts, bezel, [-1.5, 0.1, 1.3]);
  root.add(bezel);

  // Vent slots along the lower front.
  for (let i = 0; i < 4; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.02), shellGrey);
    vent.position.set(-0.35, -0.85 - i * 0.055, 0.63);
    registerPart(parts, vent, [0, -0.9, 1.2 + i * 0.15]);
    root.add(vent);
  }

  // Recessed carry handle on top.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20, Math.PI), shellGrey);
  handle.position.set(-0.45, 0.02, 0);
  handle.rotation.z = Math.PI;
  registerPart(parts, handle, [-1.2, 1.4, 0], [0.8, 0, 0]);
  root.add(handle);

  addIndicatorRow(root, parts, accent, { x: 0.5, y: -0.72, z: 0.64, count: 3, gap: 0.1 });

  root.position.y = 0.1;
  return { root, parts, screenMaterial: material };
}

// --- 5. Body-contouring station (Tesla Former) --------------------------
// The real device is not a plain pedestal: it is a treatment *chair* with
// two FMS applicators built into the seat and lumbar rest working
// simultaneously, alongside a trolley-mounted console and a third
// applicator on a mechanical arm for hands-free work. Modelled to match:
// upholstered seat + back on a dark frame, footrest, console tower, and the
// arm-mounted coil ring.
export function createContourStation(accent = 0x8b5cf6) {
  const root = new THREE.Group();
  const parts = [];
  const shellWhite = shellMaterial(WHITE);
  const shellGrey = shellMaterial(SHELL_GREY);
  const frame = plasticMaterial(0x272b33);
  // The production Tesla Former chair is upholstered in deep red -- it's
  // the thing that makes it recognisable at a glance.
  const upholstery = new THREE.MeshStandardMaterial({ color: 0x7f1d2e, roughness: 0.75, metalness: 0.02 });

  // --- chair frame ---
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 1.35), frame);
  plinth.position.set(-0.35, -1.95, 0);
  registerPart(parts, plinth, [-0.6, -1.4, 0]);
  root.add(plinth);

  [-0.55, 0.55].forEach((dz) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), frame);
    leg.position.set(-0.35, -1.45, dz);
    registerPart(parts, leg, [-1.2, -1.0, dz * 2.2]);
    root.add(leg);
  });

  // --- seat pad (contains the first FMS applicator) ---
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.26, 1.15), upholstery);
  seat.position.set(-0.35, -0.92, 0);
  registerPart(parts, seat, [-1.4, -0.5, 0.9], [0.3, 0, 0]);
  root.add(seat);

  const seatCoil = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 10, 26), screenMaterial(accent));
  seatCoil.position.set(-0.35, -0.78, 0);
  seatCoil.rotation.x = Math.PI / 2;
  registerPart(parts, seatCoil, [-1.6, 0.4, 1.3], [1.0, 0, 0]);
  root.add(seatCoil);

  // --- backrest (second, synergistic lumbar applicator) ---
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.35, 0.26), upholstery);
  back.position.set(-0.9, -0.18, 0);
  back.rotation.z = 0.22;
  registerPart(parts, back, [-2.2, 0.4, 0], [0, 0, -0.5]);
  root.add(back);

  const lumbarCoil = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 10, 24), screenMaterial(accent));
  lumbarCoil.position.set(-0.74, -0.3, 0);
  lumbarCoil.rotation.y = Math.PI / 2;
  lumbarCoil.rotation.z = 0.22;
  registerPart(parts, lumbarCoil, [-2.6, 0.2, 0.6], [0, 1.1, 0]);
  root.add(lumbarCoil);

  // --- footrest ---
  const footrest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 1.0), frame);
  footrest.position.set(0.5, -1.62, 0);
  registerPart(parts, footrest, [1.4, -1.0, 0.8], [0, 0, 0.4]);
  root.add(footrest);

  // --- console tower on casters, beside the chair ---
  addCasterBase(root, parts, { y: -2.1, radius: 0.5 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.1, 0.65), shellWhite);
  tower.position.set(1.15, -0.95, -0.1);
  registerPart(parts, tower, [2.2, -0.6, -1.2]);
  root.add(tower);

  const towerTrim = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.07, 0.69), shellGrey);
  towerTrim.position.set(1.15, 0.12, -0.1);
  registerPart(parts, towerTrim, [2.4, 0.6, -0.9]);
  root.add(towerTrim);

  const head = addDisplayHead(root, parts, accent, { y: 0.5, z: 0.18, w: 0.78, h: 0.56, tilt: -0.45 });
  head.pivot.position.x = 1.15;
  addIndicatorRow(root, parts, accent, { x: 1.15, y: -0.15, z: 0.24, count: 3, gap: 0.09 });

  // --- third applicator on the hands-free mechanical arm ---
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 14), shellGrey);
  boom.position.set(1.3, 1.15, -0.1);
  boom.rotation.z = 0.9;
  registerPart(parts, boom, [2.6, 1.3, -0.5], [0, 0, -0.9]);
  root.add(boom);

  const armRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 12, 26), shellWhite);
  armRing.position.set(0.72, 1.62, -0.1);
  armRing.rotation.x = 0.5;
  registerPart(parts, armRing, [1.4, 2.2, 0.7], [0.6, 0.7, 0]);
  root.add(armRing);

  const armCoil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 10, 22), screenMaterial(accent));
  armCoil.position.set(0.72, 1.62, -0.1);
  armCoil.rotation.x = 0.5;
  registerPart(parts, armCoil, [1.6, 2.5, 1.0], [0.7, 0.9, 0]);
  root.add(armCoil);

  root.position.set(0.2, 0.3, 0);
  return { root, parts, screenMaterial: head.material };
}

// --- 6. Angela MX_7000 fractional CO2 laser ------------------------------
// Modelled part-for-part from the manufacturer's component decomposition
// sheet rather than from the generic laserCart silhouette, because Angela
// is the one device in the catalogue whose real breakdown we have. The
// component groups below follow that sheet's own labelling:
//
//   [M] mobility -- four swivel casters on an X-shaped base plate
//   [C] chassis  -- dark rounded side enclosures over an internal frame,
//                   with a curved silver front inset and vertical branding
//   [V] vents    -- circular dotted grilles top and bottom, side filter mesh
//   [I] UI       -- angled touch display, push handle, e-stop, key switch
//   [A] arm      -- 7-mirror articulated delivery arm (the MX-7000's defining
//                   feature), built as a real kinematic chain so every joint
//                   pivots about the exact centre of its sphere
//   [H] handpiece-- white housing, cone nozzle, interchangeable tip, connector
//
// The laser itself is 10,600nm CO2, so the beam accent stays red regardless
// of the registry colour -- that part isn't a styling choice.
const ANGELA_RED = 0xc0202c;

function iusBrandingTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      // The side panels carry the "ius" mark running bottom-to-top.
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#c0202c";
      ctx.font = "bold 150px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ius", 0, 0);
      ctx.font = "bold 54px Helvetica, Arial, sans-serif";
      ctx.fillText("A L F A", 0, 110);
      ctx.restore();
    },
    { width: 512, height: 256 }
  );
}

function angelaScriptTexture() {
  return decalTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#b81f2b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // A large script capital, then the remaining letters spaced down the
    // panel -- the sheet's "A n g e l a" vertical lockup.
    ctx.font = "italic 190px Georgia, 'Times New Roman', serif";
    ctx.fillText("A", w / 2, 120);
    ctx.font = "italic 74px Georgia, 'Times New Roman', serif";
    "ngela".split("").forEach((ch, i) => ctx.fillText(ch, w / 2, 250 + i * 52));
  });
}

function ventGrilleTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // Perforated disc: concentric rings of holes, densest at the rim,
      // matching the circular dotted grilles on the real side panels.
      const cx = w / 2;
      const cy = h / 2;
      ctx.fillStyle = "#0a0c10";
      for (let ring = 1; ring <= 5; ring++) {
        const radius = (ring / 5.6) * (w / 2);
        const count = ring * 8;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + ring * 0.2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, w * 0.016, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.02, 0, Math.PI * 2);
      ctx.fill();
    },
    { width: 256, height: 256 }
  );
}

export function createAngela(accent = 0xf43f5e) {
  const root = new THREE.Group();
  const parts = [];

  // Per the sheet's bill of materials: dark matte chassis, anodized silver
  // arm, glossy black bezel, white handpiece.
  const chassisDark = new THREE.MeshStandardMaterial({ color: 0x33373f, roughness: 0.72, metalness: 0.12 });
  const baseDark = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.85, metalness: 0.08 });
  const casterDark = new THREE.MeshStandardMaterial({ color: 0x191c21, roughness: 0.3, metalness: 0.35 });
  const silverPanel = new THREE.MeshStandardMaterial({ color: 0xb9c0cb, roughness: 0.42, metalness: 0.35 });
  const armSilver = new THREE.MeshStandardMaterial({ color: 0xc7ccd4, roughness: 0.18, metalness: 0.92 });
  const rodGrey = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.45 });
  const glossBlack = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.12, metalness: 0.3 });
  const housingWhite = shellMaterial(0xf4f6f9);
  const redMat = new THREE.MeshStandardMaterial({ color: ANGELA_RED, roughness: 0.38, metalness: 0.1 });
  const steel = metalMaterial();

  const CHASSIS_W = 1.02;
  const CHASSIS_D = 0.88;
  const CHASSIS_H = 2.5;
  const CHASSIS_Y = -0.62;
  const chassisTop = CHASSIS_Y + CHASSIS_H / 2;
  const chassisBottom = CHASSIS_Y - CHASSIS_H / 2;

  // ---------- [M] mobility & base station ----------
  // [M2] X-shaped caster plate: two crossed beveled beams plus a hub, not a
  // disc -- the real base is an open X so the tower can be rolled over
  // trailing cables.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.16, 20), baseDark);
  hub.position.set(0, -2.02, 0);
  registerPart(parts, hub, [0, -1.5, 0]);
  root.add(hub);

  const armAngles = [Math.PI / 4, -Math.PI / 4];
  armAngles.forEach((angle, i) => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.13, 0.26), baseDark);
    beam.position.set(0, -2.02, 0);
    beam.rotation.y = angle;
    registerPart(parts, beam, [0, -1.7, 0], [0, i ? 0.6 : -0.6, 0]);
    root.add(beam);

    // Bevelled cap along each beam's top edge -- catches the key light and
    // stops the base reading as a flat slab.
    const bevel = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.04, 0.18), chassisDark);
    bevel.position.set(0, -1.94, 0);
    bevel.rotation.y = angle;
    registerPart(parts, bevel, [0, -1.2, 0], [0, i ? 0.6 : -0.6, 0]);
    root.add(bevel);
  });

  // [M1] Four caster assemblies: swivel stem + flattened wheel + fork.
  const casterR = 0.82;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = Math.cos(a) * casterR;
    const pz = Math.sin(a) * casterR;

    const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 14), casterDark);
    swivel.position.set(px, -2.16, pz);
    registerPart(parts, swivel, [px * 2.2, -0.9, pz * 2.2]);
    root.add(swivel);

    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.05), casterDark);
    fork.position.set(px, -2.27, pz);
    fork.rotation.y = a;
    registerPart(parts, fork, [px * 2.6, -1.1, pz * 2.6]);
    root.add(fork);

    // Flattened cylinder lying on its side = the wheel itself.
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 18), casterDark);
    wheel.rotation.z = Math.PI / 2;
    wheel.rotation.y = a;
    wheel.position.set(px, -2.35, pz);
    registerPart(parts, wheel, [px * 3.0, -1.4, pz * 3.0], [1.2, 0, 0]);
    root.add(wheel);
  }

  // ---------- [C5] internal main frame ----------
  // Only really seen when the device is exploded, which is exactly what the
  // decomposition sheet shows: a simplified structural cage the panels bolt
  // onto.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.45, metalness: 0.6 });
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, CHASSIS_H - 0.1, 0.06), frameMat);
      strut.position.set(sx * (CHASSIS_W / 2 - 0.1), CHASSIS_Y, sz * (CHASSIS_D / 2 - 0.1));
      // Struts stay put while the skins fly off, so the frame is what's
      // left standing mid-explode.
      registerPart(parts, strut, [sx * 0.25, 0, sz * 0.25]);
      root.add(strut);
    });
  });
  [chassisBottom + 0.12, CHASSIS_Y, chassisTop - 0.12].forEach((y, i) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(CHASSIS_W - 0.16, 0.05, CHASSIS_D - 0.16), frameMat);
    rail.position.set(0, y, 0);
    // Spread vertically as well as backwards so the middle rail still has
    // somewhere to go -- a zero offset would leave one part welded in place
    // through the whole explode.
    registerPart(parts, rail, [0, (i - 1) * 0.5, -0.35]);
    root.add(rail);
  });

  // ---------- [C3a] side enclosures ----------
  const sideGeo = new THREE.BoxGeometry(0.05, CHASSIS_H, CHASSIS_D);
  const iusTex = iusBrandingTexture();
  [-1, 1].forEach((side) => {
    const panel = new THREE.Mesh(sideGeo, chassisDark);
    panel.position.set(side * (CHASSIS_W / 2), CHASSIS_Y, 0);
    registerPart(parts, panel, [side * 2.4, 0.1, 0], [0, side * 0.5, 0]);
    root.add(panel);

    // Vertical red "ius / ALFA" branding decal on each flank.
    const branding = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.15), decalMaterial(iusTex, ANGELA_RED));
    branding.position.set(side * (CHASSIS_W / 2 + 0.028), CHASSIS_Y + 0.1, 0);
    branding.rotation.y = side * (Math.PI / 2);
    // Rotated so the mark reads bottom-to-top on the panel.
    branding.rotation.z = Math.PI / 2;
    registerPart(parts, branding, [side * 3.0, 0.4, 0], [0, side * 0.6, 0]);
    root.add(branding);

    // [V1] Circular dotted ventilation grilles, one high and one low.
    const ventTex = ventGrilleTexture();
    [chassisTop - 0.42, chassisBottom + 0.5].forEach((y, i) => {
      const grille = new THREE.Mesh(new THREE.CircleGeometry(0.22, 28), decalMaterial(ventTex, 0x14171c));
      grille.position.set(side * (CHASSIS_W / 2 + 0.03), y, -0.12);
      grille.rotation.y = side * (Math.PI / 2);
      registerPart(parts, grille, [side * 3.4, (i ? -0.6 : 0.6), -0.4], [0, side * 0.8, 0]);
      root.add(grille);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.018, 8, 24), chassisDark);
      ring.position.set(side * (CHASSIS_W / 2 + 0.028), y, -0.12);
      ring.rotation.y = side * (Math.PI / 2);
      registerPart(parts, ring, [side * 3.7, (i ? -0.7 : 0.7), -0.5]);
      root.add(ring);
    });

    // Rectangular filter-mesh vent low on the flank.
    const filter = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.38), glossBlack);
    filter.position.set(side * (CHASSIS_W / 2 + 0.02), chassisBottom + 0.16, 0.14);
    registerPart(parts, filter, [side * 2.8, -0.8, 0.5]);
    root.add(filter);
    for (let s = 0; s < 4; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.34), chassisDark);
      slat.position.set(side * (CHASSIS_W / 2 + 0.025), chassisBottom + 0.05 + s * 0.07, 0.14);
      registerPart(parts, slat, [side * 3.2, -1.0 - s * 0.05, 0.6]);
      root.add(slat);
    }
  });

  // Vertical corner fillets -- the cheapest honest way to read as a rounded
  // extrusion without a bevelled custom geometry.
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const fillet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CHASSIS_H, 12), chassisDark);
      fillet.position.set(sx * (CHASSIS_W / 2 - 0.02), CHASSIS_Y, sz * (CHASSIS_D / 2 - 0.02));
      registerPart(parts, fillet, [sx * 1.6, 0.2, sz * 1.6]);
      root.add(fillet);
    });
  });

  // [C4] Back panel + top and bottom caps close the box.
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(CHASSIS_W, CHASSIS_H, 0.05), chassisDark);
  backPanel.position.set(0, CHASSIS_Y, -CHASSIS_D / 2);
  registerPart(parts, backPanel, [0, 0.2, -2.4]);
  root.add(backPanel);

  [chassisTop, chassisBottom].forEach((y, i) => {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(CHASSIS_W, 0.06, CHASSIS_D), chassisDark);
    cap.position.set(0, y, 0);
    registerPart(parts, cap, [0, i ? -1.9 : 1.9, 0]);
    root.add(cap);
  });

  // ---------- [C1/C2] curved silver front inset ----------
  // A shallow cylinder section rather than a flat box, so the front face
  // genuinely curves the way the sheet's C3 part does.
  const frontPanel = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 2.3, CHASSIS_H - 0.14, 32, 1, true, -0.21, 0.42),
    silverPanel
  );
  frontPanel.position.set(0, CHASSIS_Y, CHASSIS_D / 2 - 2.28);
  registerPart(parts, frontPanel, [0, 0, 2.4]);
  root.add(frontPanel);

  // Vertical "A n g e l a" script across the lower half of that panel.
  const script = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.2), decalMaterial(angelaScriptTexture(), ANGELA_RED));
  script.position.set(0, CHASSIS_Y - 0.45, CHASSIS_D / 2 + 0.035);
  registerPart(parts, script, [0, -0.5, 3.0]);
  root.add(script);

  // ---------- [I] user interface ----------
  // [I5] Push handle across the front panel, on two standoffs.
  const handleY = CHASSIS_Y + 0.72;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.09, 0.1), chassisDark);
  handle.position.set(0, handleY, CHASSIS_D / 2 + 0.13);
  registerPart(parts, handle, [0, 0.4, 2.6]);
  root.add(handle);
  [-1, 1].forEach((side) => {
    const standoff = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.1), chassisDark);
    standoff.position.set(side * 0.34, handleY, CHASSIS_D / 2 + 0.07);
    registerPart(parts, standoff, [side * 1.2, 0.3, 2.2]);
    root.add(standoff);
  });

  // [I3] Emergency stop -- red mushroom head on a yellow-grey collar.
  const estopCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 20), steel);
  estopCollar.position.set(-0.2, handleY + 0.26, CHASSIS_D / 2 + 0.03);
  estopCollar.rotation.x = Math.PI / 2;
  registerPart(parts, estopCollar, [-1.0, 0.7, 2.0]);
  root.add(estopCollar);

  const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.07, 20), redMat);
  estop.position.set(-0.2, handleY + 0.26, CHASSIS_D / 2 + 0.07);
  estop.rotation.x = Math.PI / 2;
  registerPart(parts, estop, [-1.3, 0.9, 2.4], [1.2, 0, 0]);
  root.add(estop);

  // [I4] Key switch, smaller and metallic, beside the e-stop.
  const keySwitch = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16), steel);
  keySwitch.position.set(0.14, handleY + 0.26, CHASSIS_D / 2 + 0.05);
  keySwitch.rotation.x = Math.PI / 2;
  registerPart(parts, keySwitch, [0.9, 0.7, 2.0]);
  root.add(keySwitch);

  const keyBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.03), chassisDark);
  keyBarrel.position.set(0.14, handleY + 0.26, CHASSIS_D / 2 + 0.08);
  registerPart(parts, keyBarrel, [1.2, 0.8, 2.3], [0, 0, 1.0]);
  root.add(keyBarrel);

  addIndicatorRow(root, parts, accent, { x: 0.36, y: handleY + 0.26, z: CHASSIS_D / 2 + 0.04, count: 3, gap: 0.08 });

  // [I1/I2] Angled touch display at the very top of the chassis.
  const screenPivot = new THREE.Group();
  screenPivot.position.set(0, chassisTop + 0.3, 0.12);
  screenPivot.rotation.x = -0.55;
  root.add(screenPivot);

  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.74, 0.09), glossBlack);
  registerPart(parts, bezel, [0, 1.6, 0.6]);
  screenPivot.add(bezel);

  const screenMat = screenMaterial(accent);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.6), screenMat);
  glass.position.set(0, 0, 0.05);
  registerPart(parts, glass, [0, 2.0, 1.0]);
  screenPivot.add(glass);

  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 12), chassisDark);
  hinge.position.set(0, -0.36, -0.06);
  hinge.rotation.z = Math.PI / 2;
  registerPart(parts, hinge, [0, 1.2, -0.5]);
  screenPivot.add(hinge);

  // ---------- [A] articulated delivery arm ----------
  // Built as a real parent-child chain. Each joint Group sits at the exact
  // centre of its sphere, and the segment that follows is offset along its
  // own local axis -- so rotating a group swings everything downstream of
  // it correctly, the way the physical 7-mirror arm does.
  const LOWER_LEN = 1.25;
  const UPPER_LEN = 1.05;

  // [A1] base swivel joint, mounted on the chassis roof. The Group's own
  // origin IS the joint centre, so the sphere sits at (0,0,0) inside it and
  // the segment below rotates about that exact point.
  const shoulder = new THREE.Group();
  shoulder.position.set(0.22, chassisTop + 0.24, -0.22);
  root.add(shoulder);

  const swivelBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.26, 20), armSilver);
  swivelBody.position.set(0, -0.15, 0);
  registerPart(parts, swivelBody, [0.6, 0.9, -1.2]);
  shoulder.add(swivelBody);

  const swivelCap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), armSilver);
  swivelCap.name = "joint:shoulder";
  registerPart(parts, swivelCap, [0.9, 1.3, -1.4]);
  shoulder.add(swivelCap);

  // Lower arm pivots about the swivel centre.
  const lowerArm = new THREE.Group();
  lowerArm.rotation.z = -0.72;
  shoulder.add(lowerArm);

  const lowerTube = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, LOWER_LEN, 18), armSilver);
  lowerTube.position.set(0, LOWER_LEN / 2, 0);
  registerPart(parts, lowerTube, [1.4, 0.6, -0.8], [0, 0, 0.7]);
  lowerArm.add(lowerTube);

  // [A6] optical tube covers -- collars at each end of every segment.
  [0.12, LOWER_LEN - 0.12].forEach((y, i) => {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 18), rodGrey);
    collar.position.set(0, y, 0);
    registerPart(parts, collar, [1.6 + i * 0.2, 0.4, -0.6]);
    lowerArm.add(collar);
  });

  // Parallel tension rods, thinner and darker than the optical tube.
  [-1, 1].forEach((side) => {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, LOWER_LEN - 0.1, 10), rodGrey);
    rod.position.set(0, LOWER_LEN / 2, side * 0.1);
    registerPart(parts, rod, [1.8, 0.5, side * 1.2], [0, 0, 0.9]);
    lowerArm.add(rod);
  });

  // [A3] elbow -- group origin sits exactly at the sphere's centre.
  const elbow = new THREE.Group();
  elbow.position.set(0, LOWER_LEN, 0);
  elbow.rotation.z = 1.5;
  lowerArm.add(elbow);

  const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), armSilver);
  elbowBall.name = "joint:elbow";
  registerPart(parts, elbowBall, [2.0, 0.9, -0.4]);
  elbow.add(elbowBall);

  // [A4] upper arm segment, hinged about that same centre.
  const upperArm = new THREE.Group();
  upperArm.rotation.z = 0.35;
  elbow.add(upperArm);

  const elbowCover = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.12, 18), rodGrey);
  elbowCover.position.set(0, 0.12, 0);
  registerPart(parts, elbowCover, [2.2, 1.1, -0.3]);
  upperArm.add(elbowCover);

  const upperTube = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, UPPER_LEN, 18), armSilver);
  upperTube.position.set(0, UPPER_LEN / 2, 0);
  registerPart(parts, upperTube, [2.4, 0.2, 0.4], [0, 0, -0.8]);
  upperArm.add(upperTube);

  [-1, 1].forEach((side) => {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, UPPER_LEN - 0.1, 10), rodGrey);
    rod.position.set(0, UPPER_LEN / 2, side * 0.085);
    registerPart(parts, rod, [2.6, 0.1, side * 1.4], [0, 0, -1.0]);
    upperArm.add(rod);
  });

  const upperCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.09, 18), rodGrey);
  upperCollar.position.set(0, UPPER_LEN - 0.1, 0);
  registerPart(parts, upperCollar, [2.8, 0.0, 0.5]);
  upperArm.add(upperCollar);

  // [A5] wrist -- again pivoting about its own sphere centre.
  const wrist = new THREE.Group();
  wrist.position.set(0, UPPER_LEN, 0);
  wrist.rotation.z = 0.55;
  upperArm.add(wrist);

  const wristBall = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), armSilver);
  wristBall.name = "joint:wrist";
  registerPart(parts, wristBall, [3.0, -0.2, 0.6]);
  wrist.add(wristBall);

  // ---------- [H] handpiece assembly ----------
  // Hangs off the wrist centre, so angling the handpiece swings it about
  // the joint rather than sliding it through the joint cover.
  const handpiece = new THREE.Group();
  handpiece.rotation.z = 0.4;
  wrist.add(handpiece);

  const wristCover = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.16, 16), armSilver);
  wristCover.position.set(0, 0.13, 0);
  registerPart(parts, wristCover, [3.2, -0.4, 0.7]);
  handpiece.add(wristCover);

  // [H3] connector back to the arm.
  const connector = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 16), steel);
  connector.position.set(0, 0.24, 0);
  registerPart(parts, connector, [3.3, -0.3, 0.8]);
  handpiece.add(connector);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 16), glossBlack);
  grip.position.set(0, 0.4, 0);
  registerPart(parts, grip, [3.6, -0.8, 1.0]);
  handpiece.add(grip);

  // [H1] white housing body.
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.17), housingWhite);
  housing.position.set(0, 0.44, 0);
  registerPart(parts, housing, [3.4, -0.6, 0.9], [0, 0, 1.2]);
  handpiece.add(housing);

  // [H2] interchangeable tip: a downward-facing cone nozzle.
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 18), housingWhite);
  nozzle.position.set(0, 0.74, 0);
  registerPart(parts, nozzle, [3.9, -1.0, 1.2], [0, 0, 1.6]);
  handpiece.add(nozzle);

  // The 10,600nm CO2 beam's red aiming spot at the nozzle mouth.
  const aimingBeam = new THREE.Mesh(
    new THREE.CircleGeometry(0.03, 14),
    new THREE.MeshStandardMaterial({ color: 0x1a0406, emissive: new THREE.Color(ANGELA_RED), emissiveIntensity: 1.6, roughness: 0.3 })
  );
  aimingBeam.position.set(0, 0.86, 0);
  aimingBeam.rotation.x = Math.PI / 2;
  registerPart(parts, aimingBeam, [4.2, -1.2, 1.4]);
  handpiece.add(aimingBeam);

  // ---------- foot pedal ----------
  // Part of the shipped system per the manufacturer's component list, and
  // it grounds the tower on the floor plane.
  const pedalBase = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.34), chassisDark);
  pedalBase.position.set(-1.35, -2.3, 0.5);
  registerPart(parts, pedalBase, [-2.6, -1.2, 1.4]);
  root.add(pedalBase);

  const pedalPlate = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.26), rodGrey);
  pedalPlate.position.set(-1.35, -2.23, 0.53);
  pedalPlate.rotation.x = -0.16;
  registerPart(parts, pedalPlate, [-2.9, -1.0, 1.7], [0.6, 0, 0]);
  root.add(pedalPlate);

  addCoiledCable(root, parts, { from: [-0.5, chassisBottom + 0.1, 0.2], to: [-1.3, -2.24, 0.5], coils: 4, radius: 0.05 });

  // The arm's reach makes this the tallest rig in the set. DeviceStage uses
  // one fixed camera for every archetype, so scale it back into the same
  // envelope as the others (~4.2 units tall) rather than having it crop or
  // shrink the frame when the homepage swaps devices mid-scroll.
  root.scale.setScalar(0.86);
  root.position.y = 0.1;
  return { root, parts, screenMaterial: screenMat };
}

// --- 7. Primelase Excellence (IUS-PRIMELASE) -----------------------------
// The second device we have a manufacturer decomposition sheet for, so like
// Angela it gets its own archetype instead of the generic laserCart. Groups
// follow that sheet's labelling:
//
//   [C] chassis   -- white polymer shell in matte + gloss finishes over a
//                    bottom case, grille inserts, four casters, edge profile
//   [F] framework -- open metal frame, 4800W PSU, four-wavelength laser
//                    source module (Alex / Diode / Blend / ND:YAG), control
//                    board, filter grids
//   [I] interface -- top bezel panel, LCD touch screen, handle holder dock
//   [H] handpiece -- head, cold-plate & Crystal Freeze module, laser diodes,
//                    handle body with inner tube, flexible umbilical hose
//   [B] branding  -- Primelase script, Sinclair mark, Crystal Freeze
//                    snowflake, 3ms Ultra Short Pulse waveform, vertical
//                    IUS-PRIMELASE block
//
// The four wavelengths are the product's whole identity, so the diode
// colours below are keyed to them rather than to the registry accent.
const PRIMELASE_WAVELENGTHS = [
  { label: "755nm", name: "Alex", color: 0xef4444 },
  { label: "810nm", name: "Diode", color: 0x84cc16 },
  { label: "940nm", name: "Blend", color: 0xf97316 },
  { label: "1064nm", name: "ND:YAG", color: 0xa855f7 },
];

function primelaseScreenTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.fillStyle = "#0a1424";
      ctx.fillRect(0, 0, w, h);
      // Title strip.
      ctx.fillStyle = "#132238";
      ctx.fillRect(0, 0, w, h * 0.13);
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "bold 26px Helvetica, Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("WAVELENGTH", 22, h * 0.065);

      // The four selectable wavelengths down the left, first one active --
      // this is the actual control surface on the real unit.
      PRIMELASE_WAVELENGTHS.forEach((wl, i) => {
        const y = h * 0.2 + i * h * 0.18;
        const active = i === 0;
        ctx.fillStyle = active ? "#f59e0b" : "#1e3350";
        ctx.beginPath();
        ctx.roundRect(22, y, w * 0.3, h * 0.13, 10);
        ctx.fill();
        ctx.fillStyle = active ? "#1a1206" : "#93c5fd";
        ctx.font = "bold 28px Helvetica, Arial, sans-serif";
        ctx.fillText(wl.label, 40, y + h * 0.065);
      });

      // Central fluence dial.
      const cx = w * 0.58;
      const cy = h * 0.52;
      ctx.strokeStyle = "#1e3a5f";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.24, -Math.PI / 2, Math.PI * 0.75);
      ctx.stroke();
      ctx.fillStyle = "#e0f2fe";
      ctx.font = "bold 40px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("18", cx, cy - 6);
      ctx.font = "20px Helvetica, Arial, sans-serif";
      ctx.fillStyle = "#7dd3fc";
      ctx.fillText("J/cm²", cx, cy + 30);
      ctx.textAlign = "left";

      // Right-hand status tiles.
      ["COOLING", "READY"].forEach((label, i) => {
        ctx.fillStyle = i ? "#166534" : "#1e3350";
        ctx.beginPath();
        ctx.roundRect(w * 0.78, h * 0.24 + i * h * 0.2, w * 0.17, h * 0.15, 8);
        ctx.fill();
        ctx.fillStyle = i ? "#bbf7d0" : "#93c5fd";
        ctx.font = "bold 18px Helvetica, Arial, sans-serif";
        ctx.fillText(label, w * 0.795, h * 0.315 + i * h * 0.2);
      });
    },
    { width: 512, height: 320 }
  );
}

function primelaseScriptTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#3f4652";
      ctx.font = "italic 84px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Primelase", w / 2, h / 2);
    },
    { width: 512, height: 128 }
  );
}

function sinclairLogoTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // The Sinclair mark: a swept blue arc over the wordmark.
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 13;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(w * 0.2, h * 0.44);
      ctx.quadraticCurveTo(w * 0.5, h * 0.04, w * 0.82, h * 0.38);
      ctx.stroke();
      ctx.fillStyle = "#374151";
      ctx.font = "600 62px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("sinclair", w / 2, h * 0.72);
    },
    { width: 512, height: 192 }
  );
}

function crystalFreezeTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // Snowflake: six spokes with barbs.
      const cx = w / 2;
      const cy = h * 0.38;
      const r = h * 0.28;
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const ex = cx + Math.cos(a) * r;
        const ey = cy + Math.sin(a) * r;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        for (const t of [0.55, 0.85]) {
          const bx = cx + Math.cos(a) * r * t;
          const by = cy + Math.sin(a) * r * t;
          for (const spread of [-0.6, 0.6]) {
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(a + spread) * r * 0.22, by + Math.sin(a + spread) * r * 0.22);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = "#0284c7";
      ctx.font = "bold 34px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Crystal", cx, h * 0.79);
      ctx.fillText("Freeze", cx, h * 0.93);
    },
    { width: 256, height: 256 }
  );
}

function ultraShortPulseTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // A single sharp spike -- the 3ms ultra-short-pulse waveform icon.
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 8;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const mid = h * 0.42;
      ctx.moveTo(w * 0.08, mid);
      ctx.lineTo(w * 0.34, mid);
      ctx.lineTo(w * 0.42, h * 0.1);
      ctx.lineTo(w * 0.5, h * 0.72);
      ctx.lineTo(w * 0.58, h * 0.18);
      ctx.lineTo(w * 0.66, mid);
      ctx.lineTo(w * 0.92, mid);
      ctx.stroke();
      ctx.fillStyle = "#dc2626";
      ctx.font = "bold 30px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("3ms", w * 0.5, h * 0.86);
      ctx.fillStyle = "#374151";
      ctx.font = "bold 22px Helvetica, Arial, sans-serif";
      ctx.fillText("ULTRA SHORT PULSE", w * 0.5, h * 0.98);
    },
    { width: 256, height: 200 }
  );
}

function iusPrimelaseTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#d40f22";
      ctx.font = "bold 160px Helvetica, Arial, sans-serif";
      ctx.fillText("IUS", -60, 0);
      ctx.font = "bold 46px Helvetica, Arial, sans-serif";
      ctx.fillText("IUS-PRIMELASE", 90, 0);
      ctx.restore();
    },
    { width: 512, height: 256 }
  );
}

function psuLabelTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#111827";
      ctx.font = "italic bold 58px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("4800 Watts", w / 2, h / 2);
    },
    { width: 512, height: 128 }
  );
}

export function createPrimelase(accent = 0x3b82f6) {
  const root = new THREE.Group();
  const parts = [];

  // [C1] calls for white polymer in *both* matte and gloss finishes -- the
  // contrast between the two is what gives the real shell its shape.
  const shellMatte = new THREE.MeshStandardMaterial({ color: 0xf3f5f8, roughness: 0.62, metalness: 0.04 });
  const shellGloss = new THREE.MeshStandardMaterial({ color: 0xfbfcfe, roughness: 0.1, metalness: 0.16 });
  const greyPolymer = new THREE.MeshStandardMaterial({ color: 0x9aa2ae, roughness: 0.6, metalness: 0.08 });
  const darkCase = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7, metalness: 0.15 });
  const casterDark = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.32, metalness: 0.35 });
  const frameMetal = new THREE.MeshStandardMaterial({ color: 0x7d848f, roughness: 0.4, metalness: 0.72 });
  const pcbGreen = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.55, metalness: 0.2 });
  const glossBlack = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.11, metalness: 0.3 });
  const coldPlateBlue = new THREE.MeshStandardMaterial({
    color: 0x1e5fa8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.5,
  });
  const hoseDark = plasticMaterial(0x4b5058);
  const steel = metalMaterial();

  // Elliptical tower: a slab that's wider than it is deep, with rounded
  // flanks -- the sheet's CylinderGeometry note for [C1].
  const RX = 0.6;
  const Z_SQUASH = 0.7;
  const TOWER_H = 2.9;
  const TOWER_Y = -0.32;
  const towerTop = TOWER_Y + TOWER_H / 2;
  const towerBottom = TOWER_Y - TOWER_H / 2;
  const frontZ = RX * Z_SQUASH;

  // ---------- [C3][C4] bottom case & casters ----------
  const bottomCase = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.16, 0.9), darkCase);
  bottomCase.position.set(0, towerBottom - 0.06, 0);
  registerPart(parts, bottomCase, [0, -1.5, 0]);
  root.add(bottomCase);

  const caseTrim = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.04, 0.94), greyPolymer);
  caseTrim.position.set(0, towerBottom + 0.03, 0);
  registerPart(parts, caseTrim, [0, -1.1, 0.4]);
  root.add(caseTrim);

  // Four outrigger arms out to the caster mounts. They splay well wider
  // than the tower itself -- a 2.9-unit column on a base its own width
  // would read as about to topple.
  const casterR = 1.05;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = Math.cos(a) * casterR;
    const pz = Math.sin(a) * casterR * 0.85;

    const outrigger = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.09, 0.16), darkCase);
    outrigger.position.set(px * 0.55, towerBottom - 0.1, pz * 0.55);
    outrigger.rotation.y = -Math.atan2(pz, px);
    registerPart(parts, outrigger, [px * 1.6, -1.2, pz * 1.6]);
    root.add(outrigger);

    const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.18, 14), casterDark);
    swivel.position.set(px, towerBottom - 0.18, pz);
    registerPart(parts, swivel, [px * 2.4, -0.9, pz * 2.4]);
    root.add(swivel);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.075, 18), casterDark);
    wheel.rotation.z = Math.PI / 2;
    wheel.rotation.y = a;
    wheel.position.set(px, towerBottom - 0.34, pz);
    registerPart(parts, wheel, [px * 3.0, -1.3, pz * 3.0], [1.2, 0, 0]);
    root.add(wheel);

    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.085, 12), greyPolymer);
    hubCap.rotation.z = Math.PI / 2;
    hubCap.rotation.y = a;
    hubCap.position.set(px, towerBottom - 0.34, pz);
    registerPart(parts, hubCap, [px * 3.4, -1.5, pz * 3.4], [1.4, 0, 0]);
    root.add(hubCap);
  }

  // ---------- [F1] primary structural frame ----------
  // An open metal cube, exactly as drawn -- what's left standing when the
  // shell halves fly off mid-explode.
  const strutSpanX = 0.42;
  const strutSpanZ = 0.3;
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.055, TOWER_H - 0.3, 0.055), frameMetal);
      strut.position.set(sx * strutSpanX, TOWER_Y, sz * strutSpanZ);
      registerPart(parts, strut, [sx * 0.3, 0.15, sz * 0.3]);
      root.add(strut);
    });
  });
  [towerBottom + 0.2, towerTop - 0.2].forEach((y, level) => {
    [-1, 1].forEach((sz) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(strutSpanX * 2, 0.05, 0.05), frameMetal);
      rail.position.set(0, y, sz * strutSpanZ);
      registerPart(parts, rail, [0, level ? 0.7 : -0.7, sz * 0.5]);
      root.add(rail);
    });
    [-1, 1].forEach((sx) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, strutSpanZ * 2), frameMetal);
      rail.position.set(sx * strutSpanX, y, 0);
      registerPart(parts, rail, [sx * 0.5, level ? 0.7 : -0.7, 0]);
      root.add(rail);
    });
  });

  // ---------- [F2] 4800W power supply ----------
  const psu = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.5), frameMetal);
  psu.position.set(0, towerBottom + 0.52, 0);
  registerPart(parts, psu, [-1.9, -0.5, 0.3], [0, 0.5, 0]);
  root.add(psu);

  const psuLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), decalMaterial(psuLabelTexture(), 0x111827));
  psuLabel.position.set(0, towerBottom + 0.58, 0.252);
  registerPart(parts, psuLabel, [-2.2, -0.4, 0.6], [0, 0.5, 0]);
  root.add(psuLabel);

  // Twin extraction fans on the PSU flank.
  [-0.16, 0.16].forEach((dx, i) => {
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 18), darkCase);
    fan.rotation.x = Math.PI / 2;
    fan.position.set(dx, towerBottom + 0.42, 0.252);
    registerPart(parts, fan, [-2.4, -0.6 - i * 0.1, 0.8], [0.8, 0, 0]);
    root.add(fan);
  });

  // ---------- [F3] four-wavelength laser source module ----------
  PRIMELASE_WAVELENGTHS.forEach((wl, i) => {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.34, 16),
      new THREE.MeshStandardMaterial({ color: wl.color, roughness: 0.42, metalness: 0.3 })
    );
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(-0.06, towerBottom + 1.02 + i * 0.19, (i % 2 ? 0.1 : -0.1));
    registerPart(parts, barrel, [1.9 + i * 0.15, -0.2 + i * 0.12, 0.7], [0, 0, 0.9]);
    root.add(barrel);

    // Emitting face, glowing in that wavelength's own colour.
    const emitter = new THREE.Mesh(
      new THREE.CircleGeometry(0.062, 14),
      new THREE.MeshStandardMaterial({
        color: 0x0b0f16,
        emissive: new THREE.Color(wl.color),
        emissiveIntensity: 1.5,
        roughness: 0.3,
      })
    );
    emitter.rotation.y = Math.PI / 2;
    emitter.position.set(0.12, towerBottom + 1.02 + i * 0.19, (i % 2 ? 0.1 : -0.1));
    registerPart(parts, emitter, [2.4 + i * 0.15, -0.1 + i * 0.12, 0.9]);
    root.add(emitter);
  });

  // ---------- [F4] R&D control board ----------
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.02, 0.44), pcbGreen);
  board.position.set(0, towerBottom + 1.92, 0);
  registerPart(parts, board, [-2.0, 0.9, -0.6], [0.7, 0, 0]);
  root.add(board);

  for (let i = 0; i < 4; i++) {
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.09), glossBlack);
    chip.position.set(-0.2 + (i % 2) * 0.32, towerBottom + 1.945, -0.1 + Math.floor(i / 2) * 0.2);
    registerPart(parts, chip, [-2.3, 1.1 + i * 0.08, -0.8]);
    root.add(chip);
  }

  // [F2a]/[F4a] filter grids.
  [-1, 1].forEach((sz) => {
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), decalMaterial(ventGrilleTexture(), 0x2f343c));
    grid.position.set(0, towerBottom + 1.5, sz * 0.31);
    if (sz < 0) grid.rotation.y = Math.PI;
    registerPart(parts, grid, [0, 0.3, sz * 2.2]);
    root.add(grid);
  });

  // ---------- [C1] main shell: two curved half-shells ----------
  // Split down the middle so the explode pulls the device open the way the
  // sheet's C1 pair does, rather than lifting one solid box off.
  [-1, 1].forEach((side) => {
    const half = new THREE.Mesh(
      new THREE.CylinderGeometry(RX, RX, TOWER_H, 30, 1, true, side > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI),
      side > 0 ? shellGloss : shellMatte
    );
    half.scale.z = Z_SQUASH;
    half.position.set(0, TOWER_Y, 0);
    registerPart(parts, half, [side * 2.6, 0.15, 0], [0, side * 0.4, 0]);
    root.add(half);

    // "edge profile" -- the thin vertical trim strip called out on the
    // sheet where the two shells meet.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.035, TOWER_H, 0.05), greyPolymer);
    edge.position.set(side * RX, TOWER_Y, 0);
    registerPart(parts, edge, [side * 3.2, 0.3, 0]);
    root.add(edge);
  });

  // Rounded top cap + gloss crown.
  const topCap = new THREE.Mesh(new THREE.SphereGeometry(RX, 30, 16, 0, Math.PI * 2, 0, Math.PI / 2), shellGloss);
  topCap.scale.z = Z_SQUASH;
  topCap.scale.y = 0.55;
  topCap.position.set(0, towerTop, 0);
  registerPart(parts, topCap, [0, 2.0, 0]);
  root.add(topCap);

  const bottomCap = new THREE.Mesh(new THREE.CylinderGeometry(RX, RX * 0.97, 0.05, 30), shellMatte);
  bottomCap.scale.z = Z_SQUASH;
  bottomCap.position.set(0, towerBottom, 0);
  registerPart(parts, bottomCap, [0, -1.8, 0]);
  root.add(bottomCap);

  // ---------- [C2] front grille inserts + side vent stack ----------
  // Two grey teardrop inserts low on the front face.
  [-1, 1].forEach((side) => {
    const insert = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.04), greyPolymer);
    insert.position.set(side * 0.22, towerBottom + 0.42, frontZ - 0.01);
    insert.rotation.z = side * 0.12;
    registerPart(parts, insert, [side * 1.5, -0.9, 1.6], [0, 0, side * 0.4]);
    root.add(insert);

    for (let s = 0; s < 4; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.028, 0.03), darkCase);
      slat.position.set(side * 0.22, towerBottom + 0.24 + s * 0.11, frontZ + 0.012);
      slat.rotation.z = side * 0.12;
      registerPart(parts, slat, [side * 1.9, -1.0 - s * 0.06, 1.9]);
      root.add(slat);
    }
  });

  // The long horizontal vent stack down the right flank, the most
  // recognisable feature of the assembled unit.
  for (let i = 0; i < 11; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.4), darkCase);
    slat.position.set(RX - 0.03, TOWER_Y + 0.42 - i * 0.082, 0.02);
    registerPart(parts, slat, [2.9, 0.2 - i * 0.05, 0.3]);
    root.add(slat);
  }

  // ---------- [I] interface ----------
  const screenPivot = new THREE.Group();
  screenPivot.position.set(0, TOWER_Y + 0.95, frontZ - 0.05);
  screenPivot.rotation.x = -0.34;
  root.add(screenPivot);

  // [I1] top bezel panel.
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.6, 0.06), glossBlack);
  registerPart(parts, bezel, [0, 1.7, 1.4]);
  screenPivot.add(bezel);

  const bezelTrim = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.66, 0.03), shellGloss);
  bezelTrim.position.set(0, 0, -0.03);
  registerPart(parts, bezelTrim, [0, 2.0, 1.1]);
  screenPivot.add(bezelTrim);

  // [I2] LCD touch screen -- the wavelength UI is drawn into the emissive
  // map, so the panel actually reads as a running interface.
  const screenMat = screenDecalMaterial(primelaseScreenTexture(), accent);
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), screenMat);
  lcd.position.set(0, 0, 0.035);
  registerPart(parts, lcd, [0, 2.2, 1.8]);
  screenPivot.add(lcd);

  // [I3] handle holder dock on the front-left.
  const dockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.06), greyPolymer);
  dockPlate.position.set(-0.3, TOWER_Y + 0.28, frontZ + 0.02);
  registerPart(parts, dockPlate, [-2.0, 0.5, 1.5]);
  root.add(dockPlate);

  const dockCradle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 8, 20, Math.PI * 1.4), greyPolymer);
  dockCradle.position.set(-0.3, TOWER_Y + 0.34, frontZ + 0.1);
  dockCradle.rotation.x = Math.PI / 2;
  registerPart(parts, dockCradle, [-2.3, 0.7, 1.9], [0, 1.0, 0]);
  root.add(dockCradle);

  addIndicatorRow(root, parts, accent, { x: 0.3, y: TOWER_Y + 0.3, z: frontZ + 0.02, count: 3, gap: 0.08 });

  // ---------- [H] handpiece assembly, docked ----------
  const handpiece = new THREE.Group();
  handpiece.position.set(-0.3, TOWER_Y + 0.34, frontZ + 0.16);
  handpiece.rotation.x = 0.3;
  root.add(handpiece);

  // [H4] handle body, with the inner tube visible at its base.
  const handleBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 8, 18), greyPolymer);
  registerPart(parts, handleBody, [-2.6, 0.4, 2.2], [0, 0, 0.8]);
  handpiece.add(handleBody);

  const innerTube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 14), glossBlack);
  innerTube.position.set(0, -0.26, 0);
  registerPart(parts, innerTube, [-2.9, 0.1, 2.4]);
  handpiece.add(innerTube);

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.035), glossBlack);
  trigger.position.set(0, 0.02, 0.08);
  registerPart(parts, trigger, [-3.1, 0.5, 2.6], [0.8, 0, 0]);
  handpiece.add(trigger);

  // [H2] cold-plate & Crystal Freeze module, plus its sealing o-ring.
  const coldPlate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.11), coldPlateBlue);
  coldPlate.position.set(0, 0.26, 0);
  registerPart(parts, coldPlate, [-2.4, 1.0, 2.6], [0, 0.9, 0]);
  handpiece.add(coldPlate);

  const oRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), plasticMaterial(0x23262c));
  oRing.position.set(0, 0.35, 0);
  oRing.rotation.x = Math.PI / 2;
  registerPart(parts, oRing, [-2.2, 1.3, 2.8], [1.1, 0, 0]);
  handpiece.add(oRing);

  // [H3] the four laser diodes stacked behind the cold plate.
  PRIMELASE_WAVELENGTHS.forEach((wl, i) => {
    const diode = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.045, 0.045),
      new THREE.MeshStandardMaterial({ color: wl.color, roughness: 0.4, metalness: 0.35 })
    );
    diode.position.set(-0.045 + (i % 2) * 0.09, 0.2, -0.045 + Math.floor(i / 2) * 0.09);
    registerPart(parts, diode, [-2.0 - i * 0.12, 1.1 + i * 0.1, 3.0], [0, 1.2, 0]);
    handpiece.add(diode);
  });

  // Chromed collar where the head screws onto the handle body.
  const headCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.05, 20), steel);
  headCollar.position.set(0, 0.35, 0);
  registerPart(parts, headCollar, [-2.5, 1.4, 2.7], [0, 0, 1.0]);
  handpiece.add(headCollar);

  // [H1] handpiece head: flared cone onto a sapphire treatment window.
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.085, 0.2, 20), greyPolymer);
  head.position.set(0, 0.46, 0);
  registerPart(parts, head, [-2.6, 1.6, 2.9], [0, 0, 1.2]);
  handpiece.add(head);

  const window_ = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 20),
    new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: new THREE.Color(0x38bdf8), emissiveIntensity: 1.1, roughness: 0.15 })
  );
  window_.position.set(0, 0.57, 0);
  window_.rotation.x = -Math.PI / 2;
  registerPart(parts, window_, [-2.9, 1.9, 3.1]);
  handpiece.add(window_);

  // [H5] flexible umbilical hose, dock down to the chassis inlet, with
  // braided sleeve rings along its length.
  addCoiledCable(root, parts, {
    from: [-0.34, TOWER_Y + 0.05, frontZ + 0.12],
    to: [-0.1, towerBottom + 0.3, frontZ - 0.1],
    coils: 5,
    radius: 0.09,
  });

  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.1, 16), darkCase);
  inlet.position.set(-0.1, towerBottom + 0.28, frontZ - 0.02);
  inlet.rotation.x = Math.PI / 2;
  registerPart(parts, inlet, [-1.4, -1.0, 1.6], [1.0, 0, 0]);
  root.add(inlet);

  const strainRelief = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.12, 14), hoseDark);
  strainRelief.position.set(-0.34, TOWER_Y - 0.02, frontZ + 0.13);
  registerPart(parts, strainRelief, [-2.2, -0.2, 2.4], [0, 0, 0.8]);
  root.add(strainRelief);

  // ---------- [B] branding & labels ----------
  const scriptPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.13), decalMaterial(primelaseScriptTexture(), 0x3f4652));
  scriptPlate.position.set(0, TOWER_Y + 0.62, frontZ + 0.005);
  registerPart(parts, scriptPlate, [0, 1.2, 2.6]);
  root.add(scriptPlate);

  const sinclair = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), decalMaterial(sinclairLogoTexture(), 0x1d4ed8));
  sinclair.position.set(0, towerBottom + 1.12, frontZ + 0.005);
  registerPart(parts, sinclair, [0, -0.4, 2.8]);
  root.add(sinclair);

  const snowflake = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), decalMaterial(crystalFreezeTexture(), 0x38bdf8));
  snowflake.position.set(-0.22, towerBottom + 0.92, frontZ + 0.005);
  registerPart(parts, snowflake, [-1.6, -0.6, 2.9]);
  root.add(snowflake);

  const pulseIcon = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), decalMaterial(ultraShortPulseTexture(), 0xdc2626));
  pulseIcon.position.set(0.2, towerBottom + 0.92, frontZ + 0.005);
  registerPart(parts, pulseIcon, [1.6, -0.6, 2.9]);
  root.add(pulseIcon);

  // Vertical IUS-PRIMELASE block on the left flank.
  const iusBlock = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.24), decalMaterial(iusPrimelaseTexture(), 0xd40f22));
  iusBlock.position.set(-RX - 0.005, TOWER_Y - 0.3, 0);
  iusBlock.rotation.y = -Math.PI / 2;
  iusBlock.rotation.z = Math.PI / 2;
  registerPart(parts, iusBlock, [-3.0, -0.3, 0]);
  root.add(iusBlock);

  // Same reason as Angela: DeviceStage uses one fixed camera for every
  // archetype, so this narrow tower is scaled up to fill the same ~4.2-unit
  // envelope the rest of the set occupies.
  root.scale.setScalar(1.14);
  root.position.y = 0.48;
  return { root, parts, screenMaterial: screenMat };
}

// --- 8. Powershape 2 (multi-modal aesthetic system) ----------------------
// Third sheet-derived rig. Unlike Angela (dark tower, laser arm) and
// Primelase (white slab, one handpiece), Powershape is a *gloss white
// leaning tower* with sweeping dark inlays, a front storage drawer, and
// three different applicators racked on a side dock. Groups follow the
// reference sheet:
//
//   [C] chassis  -- gloss white outer shell on a leaning vertical profile,
//                   swept side accent inlays, front storage drawer with a
//                   recessed handle, base skirt, four DUAL-wheel casters
//   [F] systems  -- metal chassis, vacuum pump + RF generator, handpiece
//                   storage bay, cable routing and air filter
//   [H] handpieces- roll (motorised dual rollers), multi-polar (electrode
//                   nodes), thermal (ceramic bi-polar tips), holder dock,
//                   flexible umbilicals
//   [I] interface-- articulated display neck, bezel, 10.2" LCD, and the
//                   glowing status strip along the top front edge
//   [B] branding -- POWERSHAPE 2 on the lower side panel, PowerShape on the
//                   upper front bezel
function powershapeScreenTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.fillStyle = "#f2f5f9";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#2f6fb5";
      ctx.fillRect(0, 0, w, h * 0.11);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px Helvetica, Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("POWERSHAPE 2", 18, h * 0.055);

      // Three modality sliders down the left -- RF, Vacuum, LED -- the
      // system's actual control axes.
      ["RF", "VACUUM", "LED"].forEach((label, i) => {
        const y = h * 0.24 + i * h * 0.2;
        ctx.fillStyle = "#64748b";
        ctx.font = "bold 17px Helvetica, Arial, sans-serif";
        ctx.fillText(label, 20, y - 16);
        ctx.fillStyle = "#dbe4ee";
        ctx.beginPath();
        ctx.roundRect(20, y, w * 0.3, 12, 6);
        ctx.fill();
        ctx.fillStyle = "#2f6fb5";
        ctx.beginPath();
        ctx.roundRect(20, y, w * 0.3 * (0.75 - i * 0.18), 12, 6);
        ctx.fill();
      });

      // Central mode dial.
      const cx = w * 0.56;
      const cy = h * 0.5;
      ctx.strokeStyle = "#dbe4ee";
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.23, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.23, -Math.PI / 2, Math.PI * 0.55);
      ctx.stroke();
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.font = "bold 30px Helvetica, Arial, sans-serif";
      ctx.fillText("MODE", cx, cy - 4);
      ctx.font = "18px Helvetica, Arial, sans-serif";
      ctx.fillStyle = "#64748b";
      ctx.fillText("BODY", cx, cy + 26);
      ctx.textAlign = "left";

      // Start / stop pills.
      [
        ["START", "#16a34a"],
        ["STOP", "#dc2626"],
      ].forEach(([label, colour], i) => {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.roundRect(w * 0.78, h * 0.28 + i * h * 0.24, w * 0.17, h * 0.16, 10);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 17px Helvetica, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, w * 0.865, h * 0.36 + i * h * 0.24);
        ctx.textAlign = "left";
      });
    },
    { width: 512, height: 320 }
  );
}

// The swept dark inlay that wraps each flank -- the single most
// recognisable styling cue on the real cabinet.
function powershapeAccentTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, "#4a4038");
      gradient.addColorStop(0.55, "#6b5c50");
      gradient.addColorStop(1, "#33302e");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(w * 0.02, h * 0.04);
      ctx.bezierCurveTo(w * 0.75, h * 0.12, w * 0.28, h * 0.62, w * 0.98, h * 0.96);
      ctx.lineTo(w * 0.98, h * 0.62);
      ctx.bezierCurveTo(w * 0.34, h * 0.44, w * 0.86, h * 0.18, w * 0.02, h * 0.3);
      ctx.closePath();
      ctx.fill();
    },
    { width: 256, height: 512 }
  );
}

function powershapeLogoTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "middle";
      ctx.font = "bold 62px Helvetica, Arial, sans-serif";
      ctx.fillStyle = "#4b5563";
      ctx.fillText("POWER", w * 0.06, h * 0.5);
      const shapeX = w * 0.06 + ctx.measureText("POWER").width;
      ctx.fillStyle = "#2f6fb5";
      ctx.fillText("SHAPE", shapeX, h * 0.5);
      ctx.fillStyle = "#4b5563";
      ctx.font = "bold 34px Helvetica, Arial, sans-serif";
      ctx.fillText("2", shapeX + ctx.measureText("SHAPE").width * 1.02, h * 0.68);
    },
    { width: 512, height: 128 }
  );
}

export function createPowershape2(accent = 0xf59e0b) {
  const root = new THREE.Group();
  const parts = [];

  const glossWhite = new THREE.MeshStandardMaterial({ color: 0xfafbfd, roughness: 0.09, metalness: 0.14 });
  const matteWhite = new THREE.MeshStandardMaterial({ color: 0xeef1f5, roughness: 0.58, metalness: 0.05 });
  const darkBrown = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.72, metalness: 0.1 });
  const frameMetal = new THREE.MeshStandardMaterial({ color: 0x7d848f, roughness: 0.4, metalness: 0.72 });
  const casterMetal = metalMaterial(0xb6bcc6);
  const casterGrey = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.3 });
  const glossBlack = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.11, metalness: 0.3 });
  const rubber = plasticMaterial(0x2f333a);

  const BODY_W = 1.02;
  const BODY_D = 0.78;
  const LOWER_H = 1.62;
  const UPPER_H = 1.12;
  const FLOOR = -2.02;
  const lowerY = FLOOR + 0.2;
  const upperY = lowerY + LOWER_H;

  // Everything above the base skirt leans back a few degrees -- the sheet's
  // "leaning vertical profile", and what stops this reading as yet another
  // upright box.
  const lean = new THREE.Group();
  lean.position.set(0, 0, 0);
  lean.rotation.x = -0.06;
  root.add(lean);

  // ---------- [C4][C5] base skirt & dual-wheel casters ----------
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.78, 0.26, 6), matteWhite);
  skirt.scale.z = 0.86;
  skirt.rotation.y = Math.PI / 6;
  skirt.position.set(0, FLOOR + 0.1, 0);
  registerPart(parts, skirt, [0, -1.5, 0]);
  root.add(skirt);

  const skirtTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 6), darkBrown);
  skirtTrim.scale.z = 0.86;
  skirtTrim.rotation.y = Math.PI / 6;
  skirtTrim.position.set(0, FLOOR + 0.24, 0);
  registerPart(parts, skirtTrim, [0, -1.1, 0.5]);
  root.add(skirtTrim);

  // Four *dual*-wheel swivel casters: a fork carrying two wheels either
  // side of a metallic hub, not a single roller.
  const casterR = 0.82;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = Math.cos(a) * casterR;
    const pz = Math.sin(a) * casterR * 0.88;

    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.14), matteWhite);
    leg.position.set(px * 0.55, FLOOR - 0.04, pz * 0.55);
    leg.rotation.y = -Math.atan2(pz, px);
    registerPart(parts, leg, [px * 1.7, -1.2, pz * 1.7]);
    root.add(leg);

    const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.16, 14), casterMetal);
    swivel.position.set(px, FLOOR - 0.14, pz);
    registerPart(parts, swivel, [px * 2.4, -0.9, pz * 2.4]);
    root.add(swivel);

    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.2), casterGrey);
    fork.position.set(px, FLOOR - 0.25, pz);
    fork.rotation.y = a;
    registerPart(parts, fork, [px * 2.8, -1.1, pz * 2.8]);
    root.add(fork);

    // The pair of wheels.
    [-1, 1].forEach((sideSign) => {
      const offX = Math.sin(a) * 0.075 * sideSign;
      const offZ = -Math.cos(a) * 0.075 * sideSign;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.055, 18), casterGrey);
      wheel.rotation.z = Math.PI / 2;
      wheel.rotation.y = a;
      wheel.position.set(px + offX, FLOOR - 0.35, pz + offZ);
      registerPart(parts, wheel, [px * 3.2 + offX * 4, -1.4, pz * 3.2 + offZ * 4], [1.3, 0, 0]);
      root.add(wheel);

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.062, 12), casterMetal);
      hub.rotation.z = Math.PI / 2;
      hub.rotation.y = a;
      hub.position.set(px + offX, FLOOR - 0.35, pz + offZ);
      registerPart(parts, hub, [px * 3.6 + offX * 4, -1.6, pz * 3.6 + offZ * 4], [1.5, 0, 0]);
      root.add(hub);
    });
  }

  // ---------- [F1] primary structural chassis ----------
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, LOWER_H + UPPER_H - 0.2, 0.05), frameMetal);
      strut.position.set(sx * 0.38, lowerY + (LOWER_H + UPPER_H) / 2 - 0.1, sz * 0.26);
      registerPart(parts, strut, [sx * 0.3, 0.1, sz * 0.3]);
      lean.add(strut);
    });
  });
  [lowerY + 0.1, lowerY + LOWER_H, lowerY + LOWER_H + UPPER_H - 0.2].forEach((y, level) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.045, 0.52), frameMetal);
    rail.position.set(0, y, 0);
    registerPart(parts, rail, [0, (level - 1) * 0.6, -0.4]);
    lean.add(rail);
  });

  // ---------- [F2] vacuum pump & RF generator ----------
  const pumpBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.38, 18), frameMetal);
  pumpBody.rotation.z = Math.PI / 2;
  pumpBody.position.set(-0.1, lowerY + 0.45, 0);
  registerPart(parts, pumpBody, [-2.0, -0.7, 0.6], [0, 0, 0.9]);
  lean.add(pumpBody);

  const pumpFan = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16), casterGrey);
  pumpFan.rotation.z = Math.PI / 2;
  pumpFan.position.set(0.14, lowerY + 0.45, 0);
  registerPart(parts, pumpFan, [-2.4, -0.9, 0.8], [0, 0, 1.4]);
  lean.add(pumpFan);

  const pumpMount = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.3), darkBrown);
  pumpMount.position.set(-0.1, lowerY + 0.24, 0);
  registerPart(parts, pumpMount, [-1.8, -1.0, 0.5]);
  lean.add(pumpMount);

  const rfBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.42), frameMetal);
  rfBox.position.set(0, lowerY + 1.0, 0);
  registerPart(parts, rfBox, [1.9, -0.3, 0.5], [0, 0.6, 0]);
  lean.add(rfBox);

  // RF generator heatsink fins.
  for (let f = 0; f < 5; f++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.38), casterMetal);
    fin.position.set(-0.2 + f * 0.1, lowerY + 1.0, 0.24);
    registerPart(parts, fin, [2.3, -0.2 + f * 0.06, 0.9]);
    lean.add(fin);
  }

  // ---------- [F3] handpiece storage bay + [F4] filter & routing ----------
  const storageBay = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.26, 0.4), darkBrown);
  storageBay.position.set(0, lowerY + 1.42, 0.02);
  registerPart(parts, storageBay, [0, 0.7, -1.6]);
  lean.add(storageBay);

  const airFilter = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.3), decalMaterial(ventGrilleTexture(), 0x2f343c));
  airFilter.position.set(0, lowerY + 0.2, -BODY_D / 2 - 0.01);
  airFilter.rotation.y = Math.PI;
  registerPart(parts, airFilter, [0, -0.8, -2.2]);
  lean.add(airFilter);

  // ---------- [C1] main outer shell ----------
  // Rounded-rectangle extrusions rather than plain boxes, and split into a
  // wider lower section plus an inset upper one so the tower tapers.
  const extrudeOpts = { bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 2, curveSegments: 10 };

  const lowerShell = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(BODY_W, BODY_D, 0.22), { depth: LOWER_H, ...extrudeOpts }),
    glossWhite
  );
  lowerShell.rotation.x = -Math.PI / 2;
  lowerShell.position.set(0, lowerY, 0);
  registerPart(parts, lowerShell, [0, -0.5, 2.4]);
  lean.add(lowerShell);

  const upperShell = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(BODY_W * 0.86, BODY_D * 0.84, 0.2), { depth: UPPER_H, ...extrudeOpts }),
    glossWhite
  );
  upperShell.rotation.x = -Math.PI / 2;
  upperShell.position.set(0, upperY, 0.01);
  registerPart(parts, upperShell, [0, 1.7, 1.2]);
  lean.add(upperShell);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, 0.05, BODY_D), matteWhite);
  shoulder.position.set(0, upperY, 0);
  registerPart(parts, shoulder, [0, 0.9, 1.8]);
  lean.add(shoulder);

  const crown = new THREE.Mesh(new THREE.BoxGeometry(BODY_W * 0.86, 0.05, BODY_D * 0.84), matteWhite);
  crown.position.set(0, upperY + UPPER_H, 0.01);
  registerPart(parts, crown, [0, 2.2, 0.6]);
  lean.add(crown);

  // ---------- [C2] swept side accent inlays + [B] side logo ----------
  const accentTex = powershapeAccentTexture();
  const logoTex = powershapeLogoTexture();
  [-1, 1].forEach((side) => {
    const inlay = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.9), decalMaterial(accentTex, 0x4a4038));
    inlay.position.set(side * (BODY_W / 2 + 0.012), lowerY + 1.0, 0);
    inlay.rotation.y = side * (Math.PI / 2);
    if (side < 0) inlay.rotation.z = Math.PI;
    registerPart(parts, inlay, [side * 2.8, 0.3, 0], [0, side * 0.5, 0]);
    lean.add(inlay);

    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.12), decalMaterial(logoTex, 0x2f6fb5));
    logo.position.set(side * (BODY_W / 2 + 0.02), lowerY + 0.34, 0.02);
    logo.rotation.y = side * (Math.PI / 2);
    registerPart(parts, logo, [side * 3.2, -0.4, 0.4]);
    lean.add(logo);
  });

  // ---------- [C3] front storage drawer ----------
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(BODY_W * 0.78, 0.34, 0.06), darkBrown);
  drawer.position.set(0, lowerY + 1.42, BODY_D / 2 + 0.015);
  registerPart(parts, drawer, [0, -0.2, 2.8]);
  lean.add(drawer);

  const drawerHandle = new THREE.Mesh(new THREE.BoxGeometry(BODY_W * 0.4, 0.045, 0.03), glossBlack);
  drawerHandle.position.set(0, lowerY + 1.32, BODY_D / 2 + 0.045);
  registerPart(parts, drawerHandle, [0, -0.4, 3.2]);
  lean.add(drawerHandle);

  const drawerTrim = new THREE.Mesh(new THREE.BoxGeometry(BODY_W * 0.8, 0.02, 0.02), matteWhite);
  drawerTrim.position.set(0, lowerY + 1.6, BODY_D / 2 + 0.04);
  registerPart(parts, drawerTrim, [0, 0.2, 3.0]);
  lean.add(drawerTrim);

  // ---------- [I4] front status indicator strip ----------
  const statusStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(BODY_W * 0.7, 0.035),
    new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      emissive: new THREE.Color(accent),
      emissiveIntensity: 1.7,
      roughness: 0.2,
    })
  );
  statusStrip.position.set(0, upperY + UPPER_H - 0.06, BODY_D * 0.42 + 0.01);
  statusStrip.rotation.x = -0.5;
  registerPart(parts, statusStrip, [0, 1.9, 1.6]);
  lean.add(statusStrip);

  // ---------- [I1][I2][I3] articulated display ----------
  const neckBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 16), matteWhite);
  neckBase.position.set(0, upperY + UPPER_H + 0.04, -0.1);
  registerPart(parts, neckBase, [0, 1.2, -1.6]);
  lean.add(neckBase);

  const neckLower = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.42, 14), matteWhite);
  neckLower.position.set(0, upperY + UPPER_H + 0.26, -0.14);
  neckLower.rotation.x = 0.2;
  registerPart(parts, neckLower, [0, 1.6, -1.9], [0.7, 0, 0]);
  lean.add(neckLower);

  const neckJoint = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), matteWhite);
  neckJoint.position.set(0, upperY + UPPER_H + 0.47, -0.1);
  registerPart(parts, neckJoint, [0, 2.0, -1.7]);
  lean.add(neckJoint);

  const neckUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 14), matteWhite);
  neckUpper.position.set(0, upperY + UPPER_H + 0.62, -0.02);
  neckUpper.rotation.x = -0.45;
  registerPart(parts, neckUpper, [0, 2.3, -1.2], [-0.8, 0, 0]);
  lean.add(neckUpper);

  const screenPivot = new THREE.Group();
  screenPivot.position.set(0, upperY + UPPER_H + 0.86, 0.06);
  screenPivot.rotation.x = -0.36;
  lean.add(screenPivot);

  const displayBezel = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.66, 0.07), matteWhite);
  registerPart(parts, displayBezel, [0, 2.4, 1.2]);
  screenPivot.add(displayBezel);

  const bezelInner = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.58, 0.03), glossBlack);
  bezelInner.position.set(0, 0, 0.04);
  registerPart(parts, bezelInner, [0, 2.7, 1.5]);
  screenPivot.add(bezelInner);

  const screenMat = screenDecalMaterial(powershapeScreenTexture(), accent);
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.52), screenMat);
  lcd.position.set(0, 0, 0.06);
  registerPart(parts, lcd, [0, 3.0, 1.9]);
  screenPivot.add(lcd);

  // ---------- [H4] handpiece dock + [H1..H3] three applicators ----------
  const dockX = BODY_W / 2 + 0.16;
  const dockBack = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.92, 0.34), matteWhite);
  dockBack.position.set(dockX, lowerY + 1.55, -0.14);
  registerPart(parts, dockBack, [2.6, 0.6, -0.8]);
  lean.add(dockBack);

  const applicators = [
    // [H1] roll handpiece -- the big one, motorised dual rollers.
    { y: lowerY + 1.92, kind: "roll" },
    // [H2] multi-polar -- electrode nodes around the tip.
    { y: lowerY + 1.55, kind: "multipolar" },
    // [H3] thermal -- ceramic bi-polar tips.
    { y: lowerY + 1.2, kind: "thermal" },
  ];

  applicators.forEach(({ y, kind }, idx) => {
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 8, 18, Math.PI * 1.3), matteWhite);
    cradle.position.set(dockX + 0.06, y, -0.14);
    cradle.rotation.y = Math.PI / 2;
    registerPart(parts, cradle, [3.0, 0.4 + idx * 0.2, -0.6], [0, 0, 1.0]);
    lean.add(cradle);

    const holder = new THREE.Group();
    holder.position.set(dockX + 0.2, y, -0.14);
    holder.rotation.z = -0.25;
    lean.add(holder);

    if (kind === "roll") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.34, 0.17), matteWhite);
      registerPart(parts, body, [3.2, 0.9, 0.5], [0, 0, 0.9]);
      holder.add(body);

      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.13), glossBlack);
      grip.position.set(0, 0.2, 0);
      registerPart(parts, grip, [3.4, 1.1, 0.6]);
      holder.add(grip);

      // The two motorised rollers -- what makes this the roll applicator.
      [-0.05, 0.05].forEach((dz, i) => {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.15, 16), casterMetal);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(0, -0.2, dz * 1.6);
        registerPart(parts, roller, [3.6, 0.5 - i * 0.15, 0.9], [0, 0, 1.4]);
        holder.add(roller);
      });

      const vacWindow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: new THREE.Color(accent), emissiveIntensity: 1.2, roughness: 0.2 })
      );
      vacWindow.position.set(0.1, -0.05, 0);
      vacWindow.rotation.y = Math.PI / 2;
      registerPart(parts, vacWindow, [3.8, 0.7, 1.1]);
      holder.add(vacWindow);
    } else if (kind === "multipolar") {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.24, 6, 16), matteWhite);
      registerPart(parts, body, [3.2, 0.2, 0.5], [0, 0, 0.9]);
      holder.add(body);

      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.06, 18), glossBlack);
      face.position.set(0, -0.19, 0);
      registerPart(parts, face, [3.5, 0.0, 0.7]);
      holder.add(face);

      // Ring of electrode nodes.
      for (let n = 0; n < 6; n++) {
        const ang = (n / 6) * Math.PI * 2;
        const node = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), casterMetal);
        node.position.set(Math.cos(ang) * 0.045, -0.22, Math.sin(ang) * 0.045);
        registerPart(parts, node, [3.8 + n * 0.05, -0.2, 0.9]);
        holder.add(node);
      }
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 6, 14), matteWhite);
      registerPart(parts, body, [3.2, -0.5, 0.5], [0, 0, 0.9]);
      holder.add(body);

      // Ceramic-coated bi-polar tips: two, not one.
      [-0.032, 0.032].forEach((dx, i) => {
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.07, 12), glossWhite);
        tip.position.set(dx, -0.16, 0);
        registerPart(parts, tip, [3.6, -0.7 - i * 0.1, 0.8], [0, 0, 1.2]);
        holder.add(tip);
      });
    }

    // [H5] soft umbilical from the applicator back into the cabinet -- one
    // swept tube each rather than a bead chain, so three hoses cost three
    // draw calls.
    addTubeCable(lean, parts, {
      points: [
        [dockX + 0.22, y - 0.02, -0.14],
        [dockX + 0.42, y - 0.34, -0.02],
        [dockX + 0.18, y - 0.72, 0.14],
        [BODY_W / 2 - 0.02, lowerY + 0.62, 0.1],
      ],
      radius: kind === "roll" ? 0.045 : 0.032,
      material: rubber,
      explodeOffset: [3.0, -0.6 - idx * 0.2, 1.4],
    });
  });

  addIndicatorRow(root, parts, accent, { x: 0, y: lowerY + 1.72, z: BODY_D / 2 + 0.04, count: 3, gap: 0.08 });

  // The display neck puts this over the shared ~4.2-unit camera envelope
  // DeviceStage frames every archetype in; scale it back into line.
  root.scale.setScalar(0.92);
  root.position.y = 0.26;
  return { root, parts, screenMaterial: screenMat };
}

// --- 9. 4 Plus (Novaclinical multi-modal platform) -----------------------
// Fourth sheet-derived rig, and the odd one out in this catalogue: not a
// tower at all but a *bowl head on a slender stalk over a tripod base*,
// with five different applicators racked on a curved tray above the head.
// Groups follow the reference sheet:
//
//   [C] chassis   -- left/right side panels, central column, base collar
//                    ring + casters, and the two-hemisphere head/bowl
//   [I] interface -- touchscreen, handpiece tray with five docking slots,
//                    centre control dial, emergency stop
//   [F] systems   -- control PCB, power supply, twin cooling fans, wiring
//   [H] handpieces-- LED paddle, 4-pin multi-polar RF, 2-pin bipolar RF,
//                    and two gold-mesh thermal fractional tips
//   [V] vents     -- stamped grille with filter mesh, cable bundles
const NOVA_TEAL = 0x1c9aa8;

function fourPlusScreenTexture() {
  return decalTexture(
    (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#ffffff");
      bg.addColorStop(1, "#e8f4f6");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Centre: the big "4 PLUS" mark inside a soft teal disc.
      const cx = w / 2;
      const cy = h * 0.44;
      ctx.fillStyle = "#d6eef1";
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1c9aa8";
      ctx.font = "bold 92px Helvetica, Arial, sans-serif";
      ctx.fillText("4", cx, cy - 6);
      ctx.font = "bold 22px Helvetica, Arial, sans-serif";
      ctx.fillText("PLUS", cx, cy + 44);

      // HELP and SETTINGS either side, as the sheet's UI shows.
      [
        ["?", "HELP", w * 0.2],
        ["⚙", "SETTINGS", w * 0.8],
      ].forEach(([glyph, label, x]) => {
        ctx.strokeStyle = "#1c9aa8";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, cy, h * 0.15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#1c9aa8";
        ctx.font = "bold 46px Helvetica, Arial, sans-serif";
        ctx.fillText(glyph, x, cy);
        ctx.fillStyle = "#5b7f85";
        ctx.font = "bold 20px Helvetica, Arial, sans-serif";
        ctx.fillText(label, x, cy + h * 0.24);
      });

      // NOVACLINICAL wordmark along the bottom.
      ctx.fillStyle = "#2c4a52";
      ctx.font = "bold 30px Helvetica, Arial, sans-serif";
      ctx.fillText("NOVA", cx - 44, h * 0.88);
      ctx.fillStyle = "#1c9aa8";
      ctx.fillText("CLÍNICAL", cx + 40, h * 0.88);
    },
    { width: 512, height: 340 }
  );
}

function fourPlusLogoTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#1c9aa8";
      ctx.font = "bold 118px Helvetica, Arial, sans-serif";
      ctx.fillText("4", w * 0.42, h * 0.42);
      ctx.beginPath();
      ctx.arc(w * 0.62, h * 0.3, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 30px Helvetica, Arial, sans-serif";
      ctx.fillText("PLUS", w * 0.5, h * 0.72);
    },
    { width: 256, height: 256 }
  );
}

function novaclinicalTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "middle";
      // The little swept "n" mark that precedes the wordmark.
      ctx.strokeStyle = "#2c4a52";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(w * 0.06, h * 0.66);
      ctx.quadraticCurveTo(w * 0.1, h * 0.3, w * 0.15, h * 0.66);
      ctx.stroke();
      ctx.fillStyle = "#2c4a52";
      ctx.font = "bold 54px Helvetica, Arial, sans-serif";
      ctx.fillText("NOVA", w * 0.2, h * 0.52);
      ctx.fillStyle = "#1c9aa8";
      ctx.fillText("CLÍNICAL", w * 0.2 + ctx.measureText("NOVA").width, h * 0.52);
    },
    { width: 512, height: 128 }
  );
}

// Gold micro-needle mesh for the thermal fractional caps.
function goldMeshTexture() {
  return decalTexture(
    (ctx, w, h) => {
      ctx.fillStyle = "#b8912f";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#6d5416";
      const step = w / 12;
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 12; y++) {
          ctx.beginPath();
          ctx.arc((x + 0.5) * step, (y + 0.5) * step, step * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    { width: 128, height: 128 }
  );
}

export function createFourPlus(accent = 0x38bdf8) {
  const root = new THREE.Group();
  const parts = [];

  const shellWhite = new THREE.MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.24, metalness: 0.1 });
  const shellSoft = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5, metalness: 0.06 });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x39424d, roughness: 0.55, metalness: 0.2 });
  const glossBlack = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.11, metalness: 0.3 });
  const steelPin = metalMaterial(0xc3c9d2);
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8a13c, roughness: 0.35, metalness: 0.85 });
  const pcbGreen = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.55, metalness: 0.2 });
  const frameMetal = new THREE.MeshStandardMaterial({ color: 0x7d848f, roughness: 0.4, metalness: 0.72 });
  const rubber = plasticMaterial(0x2f333a);

  const FLOOR = -2.0;
  const HEAD_Y = 0.62;
  const HEAD_RX = 0.78;
  const HEAD_RY = 0.62;

  // ---------- [1d] base collar ring, legs & casters ----------
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 12, 28), darkTrim);
  collar.position.set(0, FLOOR + 0.32, 0);
  collar.rotation.x = Math.PI / 2;
  registerPart(parts, collar, [0, -1.3, 0], [1.0, 0, 0]);
  root.add(collar);

  // Three swept legs, tubes along a curve rather than straight boxes --
  // the sheet draws them as curved swooshes off the collar.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    addTubeCable(root, parts, {
      points: [
        [dirX * 0.12, FLOOR + 0.42, dirZ * 0.12],
        [dirX * 0.42, FLOOR + 0.3, dirZ * 0.42],
        [dirX * 0.72, FLOOR + 0.12, dirZ * 0.72],
        [dirX * 0.94, FLOOR + 0.06, dirZ * 0.94],
      ],
      radius: 0.075,
      material: shellSoft,
      explodeOffset: [dirX * 2.4, -1.0, dirZ * 2.4],
      segments: 20,
    });

    const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.12, 12), darkTrim);
    swivel.position.set(dirX * 0.96, FLOOR - 0.02, dirZ * 0.96);
    registerPart(parts, swivel, [dirX * 2.8, -0.9, dirZ * 2.8]);
    root.add(swivel);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), darkTrim);
    wheel.rotation.z = Math.PI / 2;
    wheel.rotation.y = a;
    wheel.position.set(dirX * 0.96, FLOOR - 0.12, dirZ * 0.96);
    registerPart(parts, wheel, [dirX * 3.2, -1.2, dirZ * 3.2], [1.3, 0, 0]);
    root.add(wheel);
  }

  // ---------- [1c] central column ----------
  // Flares at the foot, narrows to the neck: two stacked tapers.
  const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, 0.62, 24), shellWhite);
  flare.position.set(0, FLOOR + 0.62, 0);
  registerPart(parts, flare, [0, -1.0, 0.9]);
  root.add(flare);

  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.36, 24), shellWhite);
  stalk.position.set(0, FLOOR + 1.6, 0);
  registerPart(parts, stalk, [0, -0.4, 1.4]);
  root.add(stalk);

  // [1a][1b] Left and right side panels wrapping the column -- separate
  // mouldings on the sheet, so they explode apart sideways.
  [-1, 1].forEach((side) => {
    const panel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.31, 1.5, 20, 1, true, side > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI),
      shellWhite
    );
    panel.scale.z = 0.8;
    panel.position.set(0, FLOOR + 1.1, 0);
    registerPart(parts, panel, [side * 2.6, -0.2, 0], [0, side * 0.5, 0]);
    root.add(panel);

    // [6a] Stamped vent grille set into each panel.
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.34), decalMaterial(ventGrilleTexture(), 0x2f343c));
    grille.position.set(side * 0.24, FLOOR + 1.28, 0.02);
    grille.rotation.y = side * (Math.PI / 2);
    registerPart(parts, grille, [side * 3.0, 0.1, 0.4], [0, side * 0.7, 0]);
    root.add(grille);
  });

  const neckRing = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.09, 20), darkTrim);
  neckRing.position.set(0, FLOOR + 2.3, 0);
  registerPart(parts, neckRing, [0, -0.2, 1.2]);
  root.add(neckRing);

  // ---------- [F] internals, revealed on explode ----------
  const chassisPlate = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.03, 0.5), frameMetal);
  chassisPlate.position.set(0, HEAD_Y - 0.18, 0);
  registerPart(parts, chassisPlate, [0, -0.9, -1.4]);
  root.add(chassisPlate);

  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.34), pcbGreen);
  pcb.position.set(-0.1, HEAD_Y - 0.1, 0.02);
  registerPart(parts, pcb, [-2.2, 0.3, -1.0], [0.7, 0, 0]);
  root.add(pcb);

  for (let i = 0; i < 3; i++) {
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.07), glossBlack);
    chip.position.set(-0.22 + i * 0.12, HEAD_Y - 0.07, 0.02);
    registerPart(parts, chip, [-2.5, 0.5 + i * 0.1, -1.2]);
    root.add(chip);
  }

  const psu = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.28), frameMetal);
  psu.position.set(0.2, HEAD_Y + 0.02, -0.06);
  registerPart(parts, psu, [2.2, 0.2, -1.2], [0, 0.6, 0]);
  root.add(psu);

  // [4c] twin cooling fans.
  [-1, 1].forEach((side, i) => {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), darkTrim);
    housing.position.set(side * 0.3, HEAD_Y + 0.1, -0.22);
    registerPart(parts, housing, [side * 2.4, 0.8, -1.8]);
    root.add(housing);

    const blades = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.03, 14), glossBlack);
    blades.rotation.x = Math.PI / 2;
    blades.position.set(side * 0.3, HEAD_Y + 0.1, -0.19);
    registerPart(parts, blades, [side * 2.8, 1.0 - i * 0.1, -2.1], [1.4, 0, 0]);
    root.add(blades);
  });

  // [4d] internal wiring loom.
  addTubeCable(root, parts, {
    points: [
      [-0.24, HEAD_Y - 0.06, 0.06],
      [-0.05, HEAD_Y - 0.2, -0.1],
      [0.05, FLOOR + 2.1, 0],
      [0.02, FLOOR + 1.3, 0.04],
    ],
    radius: 0.028,
    material: rubber,
    explodeOffset: [-1.6, -0.6, -1.6],
  });

  // ---------- [1e] head / bowl assembly ----------
  // Two hemispheres with a seam, per the sheet -- so it splits open along
  // its equator when exploded.
  const lowerBowl = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    shellWhite
  );
  lowerBowl.scale.set(HEAD_RX, HEAD_RY, HEAD_RX * 0.82);
  lowerBowl.position.set(0, HEAD_Y, 0);
  registerPart(parts, lowerBowl, [0, -1.4, 0.6]);
  root.add(lowerBowl);

  const upperBowl = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    shellWhite
  );
  upperBowl.scale.set(HEAD_RX, HEAD_RY * 0.86, HEAD_RX * 0.82);
  upperBowl.position.set(0, HEAD_Y, 0);
  registerPart(parts, upperBowl, [0, 1.7, 0.4]);
  root.add(upperBowl);

  const seam = new THREE.Mesh(new THREE.TorusGeometry(HEAD_RX * 0.995, 0.018, 8, 40), shellSoft);
  seam.scale.z = 0.82;
  seam.position.set(0, HEAD_Y, 0);
  seam.rotation.x = Math.PI / 2;
  registerPart(parts, seam, [0, 0.4, 2.0], [0.8, 0, 0]);
  root.add(seam);

  // ---------- [3a] touchscreen, recessed into the head's top face ----------
  const screenPivot = new THREE.Group();
  screenPivot.position.set(0, HEAD_Y + HEAD_RY * 0.6, 0.2);
  screenPivot.rotation.x = -0.72;
  root.add(screenPivot);

  const screenWell = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.6, 0.05), shellSoft);
  registerPart(parts, screenWell, [0, 1.9, 1.0]);
  screenPivot.add(screenWell);

  const screenBezel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.53, 0.03), glossBlack);
  screenBezel.position.set(0, 0, 0.03);
  registerPart(parts, screenBezel, [0, 2.2, 1.3]);
  screenPivot.add(screenBezel);

  const screenMat = screenDecalMaterial(fourPlusScreenTexture(), accent);
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.47), screenMat);
  lcd.position.set(0, 0, 0.05);
  registerPart(parts, lcd, [0, 2.5, 1.6]);
  screenPivot.add(lcd);

  // ---------- [3c] centre dial + [3d] emergency stop ----------
  const dialBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.04, 20), shellSoft);
  dialBase.position.set(0, HEAD_Y + HEAD_RY * 0.8, -0.34);
  registerPart(parts, dialBase, [0, 1.6, -1.4]);
  root.add(dialBase);

  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 20), shellWhite);
  dial.position.set(0, HEAD_Y + HEAD_RY * 0.84, -0.34);
  registerPart(parts, dial, [0, 1.9, -1.7], [0, 1.4, 0]);
  root.add(dial);

  const estopCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 18), new THREE.MeshStandardMaterial({ color: 0xd9b310, roughness: 0.5 }));
  estopCollar.rotation.x = Math.PI / 2.4;
  estopCollar.position.set(-0.24, HEAD_Y - 0.3, HEAD_RX * 0.62);
  registerPart(parts, estopCollar, [-1.6, -0.6, 2.0]);
  root.add(estopCollar);

  const estop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.062, 0.055, 18),
    new THREE.MeshStandardMaterial({ color: 0xd12b2b, roughness: 0.38, metalness: 0.08 })
  );
  estop.rotation.x = Math.PI / 2.4;
  estop.position.set(-0.24, HEAD_Y - 0.33, HEAD_RX * 0.68);
  registerPart(parts, estop, [-1.9, -0.8, 2.4], [1.2, 0, 0]);
  root.add(estop);

  // ---------- branding ----------
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), decalMaterial(fourPlusLogoTexture(), NOVA_TEAL));
  logo.position.set(0.22, HEAD_Y + 0.16, HEAD_RX * 0.6);
  logo.rotation.x = -0.25;
  registerPart(parts, logo, [1.6, 1.2, 2.2]);
  root.add(logo);

  const wordmark = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), decalMaterial(novaclinicalTexture(), 0x2c4a52));
  wordmark.position.set(0, HEAD_Y - 0.06, HEAD_RX * 0.72);
  registerPart(parts, wordmark, [0, 0.2, 2.6]);
  root.add(wordmark);

  // ---------- [3b] handpiece tray with five docking slots ----------
  const trayY = HEAD_Y + HEAD_RY + 0.5;
  const tray = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.075, 10, 40, Math.PI * 0.78), shellWhite);
  tray.scale.y = 0.42;
  tray.position.set(0, trayY, -0.05);
  tray.rotation.x = Math.PI / 2;
  tray.rotation.z = Math.PI * 0.11;
  registerPart(parts, tray, [0, 1.8, 0.8], [0.9, 0, 0]);
  root.add(tray);

  const trayStem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.46, 14), shellSoft);
  trayStem.position.set(0, trayY - 0.28, -0.16);
  registerPart(parts, trayStem, [0, 1.2, -1.0]);
  root.add(trayStem);

  // Five applicators, each a genuinely different head per the sheet.
  const HANDPIECES = ["ledPaddle", "multipolar", "bipolar", "thermalA", "thermalB"];
  const goldTex = goldMeshTexture();

  HANDPIECES.forEach((kind, i) => {
    const t = (i / (HANDPIECES.length - 1) - 0.5) * Math.PI * 0.72;
    const px = Math.sin(t) * 0.9;
    const pz = -0.05 - Math.cos(t) * 0.16;

    const slot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.07, 16), shellSoft);
    slot.position.set(px, trayY + 0.05, pz);
    registerPart(parts, slot, [px * 2.6, 1.4, pz * 2.0]);
    root.add(slot);

    const hp = new THREE.Group();
    hp.position.set(px, trayY + 0.2, pz);
    hp.rotation.z = -t * 0.5;
    root.add(hp);

    if (kind === "ledPaddle") {
      // [HP1] flat high-intensity LED paddle.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.1), shellWhite);
      registerPart(parts, body, [px * 3.0, 1.9, 1.2], [0, 0, 0.8]);
      hp.add(body);

      const array = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.2),
        new THREE.MeshStandardMaterial({
          color: 0x0b1220,
          emissive: new THREE.Color(accent),
          emissiveIntensity: 1.4,
          roughness: 0.25,
        })
      );
      array.position.set(0, 0, 0.052);
      registerPart(parts, array, [px * 3.4, 2.1, 1.6]);
      hp.add(array);

      const lightBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.16, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: new THREE.Color(0x9ae66e), emissiveIntensity: 1.6 })
      );
      lightBar.position.set(0.09, 0, 0.03);
      registerPart(parts, lightBar, [px * 3.8, 2.0, 1.9]);
      hp.add(lightBar);
    } else if (kind === "multipolar" || kind === "bipolar") {
      // [HP2]/[HP3] RF heads -- four pins vs two, the distinction the
      // sheet is explicit about.
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.18, 6, 14), shellWhite);
      registerPart(parts, body, [px * 3.0, 1.6, 1.2], [0, 0, 0.8]);
      hp.add(body);

      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.08, 18), darkTrim);
      cap.position.set(0, 0.16, 0);
      registerPart(parts, cap, [px * 3.3, 1.9, 1.4]);
      hp.add(cap);

      const pinCount = kind === "multipolar" ? 4 : 2;
      for (let n = 0; n < pinCount; n++) {
        const ang = (n / pinCount) * Math.PI * 2;
        const r = pinCount === 2 ? 0.03 : 0.04;
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.07, 10), steelPin);
        pin.position.set(Math.cos(ang) * r, 0.23, Math.sin(ang) * r);
        registerPart(parts, pin, [px * 3.7 + n * 0.06, 2.1, 1.7]);
        hp.add(pin);
      }
    } else {
      // [HP4]/[HP5] thermal fractional tips with gold micro-needle caps.
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 6, 14), shellWhite);
      registerPart(parts, body, [px * 3.0, 1.5, 1.2], [0, 0, 0.8]);
      hp.add(body);

      const collarRing = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.062, 0.05, 18), gold);
      collarRing.position.set(0, 0.15, 0);
      registerPart(parts, collarRing, [px * 3.4, 1.8, 1.5]);
      hp.add(collarRing);

      const meshCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.068, 0.055, 20),
        goldTex
          ? new THREE.MeshStandardMaterial({ map: goldTex, roughness: 0.35, metalness: 0.8 })
          : gold
      );
      meshCap.position.set(0, 0.2, 0);
      registerPart(parts, meshCap, [px * 3.8, 2.0, 1.8], [0, 1.2, 0]);
      hp.add(meshCap);
    }

    // [H7] flexible multi-core cable back down into the head.
    if (i % 2 === 0) {
      addTubeCable(root, parts, {
        points: [
          [px, trayY - 0.02, pz],
          [px * 0.8, trayY - 0.34, pz + 0.12],
          [px * 0.4, HEAD_Y + HEAD_RY * 0.8, 0.14],
          [px * 0.16, HEAD_Y + 0.16, 0.1],
        ],
        radius: 0.026,
        material: rubber,
        explodeOffset: [px * 2.4, 0.6, 1.6],
      });
    }
  });

  // [H6] interchangeable contact surface plates -- the sheet shows both a
  // round gold-dotted disc and a square stamped pad.
  const goldSurface = goldTex
    ? new THREE.MeshStandardMaterial({ map: goldTex, roughness: 0.4, metalness: 0.7 })
    : gold;

  const roundPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 20), goldSurface);
  roundPlate.position.set(0.42, HEAD_Y + HEAD_RY * 0.72, -0.3);
  roundPlate.rotation.x = 0.2;
  registerPart(parts, roundPlate, [2.2, 1.4, -1.2], [0.9, 0, 0]);
  root.add(roundPlate);

  const squarePlate = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.024, 0.17), goldSurface);
  squarePlate.position.set(-0.44, HEAD_Y + HEAD_RY * 0.7, -0.3);
  squarePlate.rotation.x = 0.2;
  registerPart(parts, squarePlate, [-2.2, 1.4, -1.2], [0.9, 0, 0.6]);
  root.add(squarePlate);

  // [H8] connectors where the applicator cables plug into the head.
  [-1, 1].forEach((side, i) => {
    const shellPart = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.09, 14), darkTrim);
    shellPart.rotation.z = Math.PI / 2;
    shellPart.position.set(side * 0.3, HEAD_Y + 0.16, -HEAD_RX * 0.52);
    registerPart(parts, shellPart, [side * 2.0, 0.9, -2.0], [0, 0, 1.1]);
    root.add(shellPart);

    const contactRing = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), steelPin);
    contactRing.rotation.z = Math.PI / 2;
    contactRing.position.set(side * (0.3 + 0.055), HEAD_Y + 0.16, -HEAD_RX * 0.52);
    registerPart(parts, contactRing, [side * 2.4, 1.1 - i * 0.1, -2.3]);
    root.add(contactRing);
  });

  addIndicatorRow(root, parts, accent, { x: 0.02, y: HEAD_Y - 0.3, z: HEAD_RX * 0.66, count: 3, gap: 0.07 });

  // Trimmed into the shared ~4.2-unit camera envelope DeviceStage frames
  // every archetype in.
  root.scale.setScalar(0.95);
  root.position.y = 0.06;
  return { root, parts, screenMaterial: screenMat };
}

export const ARCHETYPES = {
  analyzer: createAnalyzer,
  laserCart: createLaserCart,
  rfPlatform: createRfPlatform,
  handheld: createHandheld,
  contourStation: createContourStation,
  angela: createAngela,
  primelase: createPrimelase,
  powershape2: createPowershape2,
  fourPlus: createFourPlus,
};

export function createDevice(variant = "analyzer", accent) {
  const builder = ARCHETYPES[variant] || ARCHETYPES.analyzer;
  return builder(accent);
}
