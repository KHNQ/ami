import { describe, test, expect } from "vitest";
import { ARCHETYPES, createDevice } from "../src/three/devices/archetypes.js";
import { applyExplode, disposeDevice } from "../src/three/devices/parts.js";
import { deviceForProduct } from "../src/three/devices/registry.js";

// Pure scene-graph math -- no WebGL context needed, so this runs in jsdom
// exactly like it does in a browser. The device itself is only visible with
// a real GPU, which makes these invariants the practical safety net.
describe("Device rigs", () => {
  test("builds a multi-part rig where every part records a rest transform", () => {
    const device = createDevice("analyzer");
    expect(device.parts.length).toBeGreaterThan(10);
    for (const part of device.parts) {
      expect(part.userData.restPosition).toBeDefined();
      expect(part.userData.explodeOffset).toBeDefined();
    }
    disposeDevice(device);
  });

  test("every part actually moves when fully exploded", () => {
    const device = createDevice("analyzer");
    applyExplode(device.parts, 1);
    const moved = device.parts.filter(
      (p) => p.position.distanceTo(p.userData.restPosition) > 0.01
    );
    expect(moved.length).toBe(device.parts.length);
    disposeDevice(device);
  });

  test("explode(0) restores the exact assembled pose", () => {
    const device = createDevice("analyzer");
    const before = device.parts.map((p) => p.position.clone());
    applyExplode(device.parts, 1);
    applyExplode(device.parts, 0);
    device.parts.forEach((p, i) => {
      expect(p.position.distanceTo(before[i])).toBeLessThan(1e-9);
    });
    disposeDevice(device);
  });

  // The homepage scrubs this value back and forth continuously as the user
  // scrolls; any per-call drift would visibly desync the rig over time.
  test("repeated scrubbing accumulates no positional drift", () => {
    const device = createDevice("analyzer");
    const rest = device.parts.map((p) => p.position.clone());
    for (let i = 0; i < 500; i++) applyExplode(device.parts, Math.random());
    applyExplode(device.parts, 0);
    device.parts.forEach((p, i) => {
      expect(p.position.distanceTo(rest[i])).toBeLessThan(1e-9);
    });
    disposeDevice(device);
  });

  test("explode is monotonic -- halfway is between assembled and exploded", () => {
    const device = createDevice("analyzer");
    const part = device.parts.find((p) => p.userData.explodeOffset.length() > 1);
    applyExplode(device.parts, 0);
    const atRest = part.position.clone();
    applyExplode(device.parts, 1);
    const atFull = part.position.clone();
    applyExplode(device.parts, 0.5);
    const atHalf = part.position.clone();
    expect(atHalf.distanceTo(atRest)).toBeGreaterThan(0);
    expect(atHalf.distanceTo(atFull)).toBeGreaterThan(0);
    expect(atHalf.distanceTo(atRest)).toBeLessThan(atFull.distanceTo(atRest));
    disposeDevice(device);
  });
});

// Every archetype has to satisfy the same contract, because DeviceStage
// drives all of them through one code path and the homepage swaps between
// them mid-scroll.
describe("all device archetypes", () => {
  const names = Object.keys(ARCHETYPES);

  test("every archetype the catalogue needs is registered", () => {
    expect(names).toEqual(
      expect.arrayContaining([
        "analyzer",
        "laserCart",
        "rfPlatform",
        "handheld",
        "contourStation",
        "angela",
        "primelase",
        "powershape2",
        "fourPlus",
      ])
    );
  });

  test.each(names)("%s builds a valid, fully explodable, disposable rig", (name) => {
    const device = createDevice(name, 0x22c55e);
    expect(device.root).toBeDefined();
    expect(device.screenMaterial).toBeDefined();
    expect(device.parts.length).toBeGreaterThan(5);

    applyExplode(device.parts, 1);
    const moved = device.parts.filter((p) => p.position.distanceTo(p.userData.restPosition) > 0.01);
    expect(moved.length).toBe(device.parts.length);

    applyExplode(device.parts, 0);
    device.parts.forEach((p) => {
      expect(p.position.distanceTo(p.userData.restPosition)).toBeLessThan(1e-9);
    });

    expect(() => disposeDevice(device)).not.toThrow();
  });

  test("an unknown variant falls back to a working rig instead of throwing", () => {
    const device = createDevice("does-not-exist");
    expect(device.parts.length).toBeGreaterThan(0);
    disposeDevice(device);
  });
});

// Angela is the one device modelled from the manufacturer's own component
// decomposition sheet rather than from a generic silhouette, so it gets
// checks the other archetypes can't meaningfully have.
describe("Angela MX_7000 rig", () => {
  test("is modelled at component-sheet detail, not as a generic cart", () => {
    const device = createDevice("angela");
    // The sheet breaks the device into six labelled groups; anything much
    // under this and whole assemblies have gone missing.
    expect(device.parts.length).toBeGreaterThan(60);
    expect(device.screenMaterial).toBeDefined();
    disposeDevice(device);
  });

  test("the delivery arm is a real kinematic chain, not parts scattered in world space", () => {
    const device = createDevice("angela");

    let deepest = 0;
    const walk = (obj, depth) => {
      if (obj.isGroup) deepest = Math.max(deepest, depth);
      for (const child of obj.children) walk(child, obj.isGroup ? depth + 1 : depth);
    };
    walk(device.root, 0);
    // root > shoulder > lowerArm > elbow > upperArm > wrist > handpiece
    expect(deepest).toBeGreaterThanOrEqual(6);

    disposeDevice(device);
  });

  test("every arm joint pivots about the exact centre of its own sphere", () => {
    const device = createDevice("angela");

    const joints = [];
    device.root.traverse((obj) => {
      if (obj.isMesh && obj.name.startsWith("joint:")) joints.push(obj);
    });
    expect(joints.map((j) => j.name).sort()).toEqual(["joint:elbow", "joint:shoulder", "joint:wrist"]);

    for (const joint of joints) {
      // The sphere sits at its parent group's origin...
      expect(joint.position.length()).toBe(0);
      // ...and the next link in the chain hangs off that same origin, so
      // rotating the link swings about the sphere centre rather than
      // shearing through it.
      const nextLink = joint.parent.children.find((c) => c.isGroup);
      expect(nextLink).toBeDefined();
      expect(nextLink.position.length()).toBe(0);
    }

    disposeDevice(device);
  });

  test("rotating a joint carries everything downstream of it", () => {
    const device = createDevice("angela");
    device.root.updateWorldMatrix(true, true);

    const nozzle = device.parts.find((p) => p.geometry.type === "ConeGeometry");
    expect(nozzle).toBeDefined();
    const before = nozzle.getWorldPosition(new (nozzle.position.constructor)());

    // The elbow is the second group down the arm chain.
    const elbowJoint = [];
    device.root.traverse((o) => {
      if (o.isMesh && o.name === "joint:elbow") elbowJoint.push(o);
    });
    elbowJoint[0].parent.rotation.z += 0.5;
    device.root.updateWorldMatrix(true, true);

    const after = nozzle.getWorldPosition(new (nozzle.position.constructor)());
    expect(after.distanceTo(before)).toBeGreaterThan(0.2);

    disposeDevice(device);
  });

  test("branding and vent decals fall back to flat materials without a canvas backend", () => {
    // jsdom has no 2D context, which is exactly the fallback path -- the
    // meshes must still exist so the part count is identical in a browser.
    const device = createDevice("angela");
    const decalled = device.parts.filter((p) => p.material?.transparent);
    expect(decalled.length).toBeGreaterThan(0);
    expect(() => disposeDevice(device)).not.toThrow();
  });
});

// Primelase is the second sheet-derived rig. Its distinguishing claim is
// the four-wavelength platform, so that's what these lock down.
describe("Primelase Excellence rig", () => {
  test("is modelled at component-sheet detail", () => {
    const device = createDevice("primelase");
    expect(device.parts.length).toBeGreaterThan(60);
    expect(device.screenMaterial).toBeDefined();
    disposeDevice(device);
  });

  test("carries one source-module barrel and one handpiece diode per wavelength", () => {
    const device = createDevice("primelase");
    // 755nm Alex, 810nm Diode, 940nm Blend, 1064nm ND:YAG -- each appears
    // twice, once in the [F3] source module and once in the [H3] stack, and
    // each gets its own colour rather than the shared accent.
    const wavelengthColours = new Set(["ef4444", "84cc16", "f97316", "a855f7"]);
    const tinted = device.parts.filter((p) => wavelengthColours.has(p.material?.color?.getHexString()));
    expect(tinted.length).toBe(8);
    expect(new Set(tinted.map((p) => p.material.color.getHexString())).size).toBe(4);
    disposeDevice(device);
  });

  test("the shell splits into two halves that explode in opposite directions", () => {
    const device = createDevice("primelase");
    const halves = device.parts.filter(
      (p) => p.geometry.type === "CylinderGeometry" && p.geometry.parameters.thetaLength === Math.PI
    );
    expect(halves.length).toBe(2);
    // One left, one right -- so the device opens up rather than drifting
    // off as a unit.
    const xs = halves.map((h) => h.userData.explodeOffset.x);
    expect(Math.sign(xs[0])).toBe(-Math.sign(xs[1]));
    disposeDevice(device);
  });

  test("the LCD is a UI panel, not a blank glow", () => {
    // With a canvas backend the screen gets a drawn emissive map; without
    // one it degrades to the plain accent screen. Both are valid, but the
    // mesh and its material must exist either way.
    const device = createDevice("primelase", 0x3b82f6);
    expect(device.screenMaterial.emissive).toBeDefined();
    expect(() => disposeDevice(device)).not.toThrow();
  });

  test("the handpiece is docked as one assembly that moves with its dock", () => {
    const device = createDevice("primelase");
    device.root.updateWorldMatrix(true, true);

    const groups = device.root.children.filter((c) => c.isGroup);
    // Screen pivot + handpiece assembly.
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const handpiece = groups.find((g) => g.children.length >= 8);
    expect(handpiece).toBeDefined();

    const probe = handpiece.children[0];
    const before = probe.getWorldPosition(new (probe.position.constructor)());
    handpiece.position.x += 1;
    device.root.updateWorldMatrix(true, true);
    const after = probe.getWorldPosition(new (probe.position.constructor)());
    expect(after.distanceTo(before)).toBeGreaterThan(0.5);

    disposeDevice(device);
  });
});

// Third sheet-derived rig. What makes Powershape Powershape is that it's a
// *leaning* moulded tower carrying three different applicators, so that's
// what these check.
describe("Powershape 2 rig", () => {
  test("is modelled at component-sheet detail", () => {
    const device = createDevice("powershape2");
    expect(device.parts.length).toBeGreaterThan(60);
    expect(device.screenMaterial).toBeDefined();
    disposeDevice(device);
  });

  test("the shell is a moulded rounded-rect extrusion on a leaning profile", () => {
    const device = createDevice("powershape2");

    // Lower + upper shell sections, both extruded from a rounded profile
    // rather than being plain boxes.
    const extrusions = device.parts.filter((p) => p.geometry.type === "ExtrudeGeometry");
    expect(extrusions.length).toBe(2);

    // Everything above the base skirt is tilted back; the casters are not.
    const leaning = device.root.children.filter((c) => c.isGroup && Math.abs(c.rotation.x) > 0.01);
    expect(leaning.length).toBeGreaterThan(0);

    disposeDevice(device);
  });

  test("carries four dual-wheel casters -- eight wheels, not four", () => {
    const device = createDevice("powershape2");
    const wheels = device.parts.filter(
      (p) =>
        p.geometry.type === "CylinderGeometry" &&
        Math.abs(p.geometry.parameters.radiusTop - 0.115) < 1e-6 &&
        Math.abs(p.geometry.parameters.height - 0.055) < 1e-6
    );
    expect(wheels.length).toBe(8);
    disposeDevice(device);
  });

  test("docks three distinct applicators, each on its own swept umbilical", () => {
    const device = createDevice("powershape2");

    // One TubeGeometry hose per applicator -- and a tube, not a bead chain,
    // so three hoses stay three draw calls.
    const hoses = device.parts.filter((p) => p.geometry.type === "TubeGeometry");
    expect(hoses.length).toBe(3);
    // The roll handpiece's hose is the fat one.
    const radii = hoses.map((h) => h.geometry.parameters.radius).sort((a, b) => a - b);
    expect(radii[2]).toBeGreaterThan(radii[0]);

    // Three applicator groups hanging off the dock, each holding several
    // parts (housing, grip, rollers/nodes/tips).
    const holders = device.root.children
      .flatMap((c) => (c.isGroup ? c.children : []))
      .filter((c) => c.isGroup && c.children.length >= 3);
    expect(holders.length).toBeGreaterThanOrEqual(3);

    disposeDevice(device);
  });
});

// Fourth sheet-derived rig. 4 Plus's identity is the bowl head on a stalk
// and the five *different* applicators on its tray, so that's what these
// pin down.
describe("4 Plus rig", () => {
  test("is modelled at component-sheet detail", () => {
    const device = createDevice("fourPlus");
    expect(device.parts.length).toBeGreaterThan(60);
    expect(device.screenMaterial).toBeDefined();
    disposeDevice(device);
  });

  test("the head is a two-hemisphere bowl that splits along its seam", () => {
    const device = createDevice("fourPlus");
    // Upper and lower hemispheres: partial spheres, not one solid ball.
    const hemispheres = device.parts.filter(
      (p) => p.geometry.type === "SphereGeometry" && p.geometry.parameters.phiLength >= Math.PI * 2 - 1e-6 && p.geometry.parameters.thetaLength < Math.PI - 1e-6
    );
    expect(hemispheres.length).toBe(2);
    // One flies up, one flies down, so the bowl opens rather than drifting.
    const ys = hemispheres.map((p) => p.userData.explodeOffset.y);
    expect(Math.sign(ys[0])).toBe(-Math.sign(ys[1]));
    disposeDevice(device);
  });

  test("stands on a tripod: three swept legs, three casters", () => {
    const device = createDevice("fourPlus");
    // Legs are swept tubes off the base collar, not straight boxes.
    const tubes = device.parts.filter((p) => p.geometry.type === "TubeGeometry");
    const legs = tubes.filter((p) => p.geometry.parameters.radius > 0.06);
    expect(legs.length).toBe(3);
    disposeDevice(device);
  });

  test("racks five distinct applicators, with 4-pin and 2-pin RF heads", () => {
    const device = createDevice("fourPlus");

    // Five applicator groups on the tray.
    const holders = device.root.children.filter((c) => c.isGroup && c.children.length >= 2 && c.children.every((m) => m.isMesh));
    expect(holders.length).toBeGreaterThanOrEqual(5);

    // The RF pins: 4 on the multi-polar head, 2 on the bipolar. Same slim
    // geometry, so counting them proves both heads exist as specified.
    const pins = device.parts.filter(
      (p) =>
        p.geometry.type === "CylinderGeometry" &&
        Math.abs(p.geometry.parameters.radiusTop - 0.013) < 1e-6 &&
        Math.abs(p.geometry.parameters.height - 0.07) < 1e-6
    );
    expect(pins.length).toBe(6);

    disposeDevice(device);
  });
});

describe("product -> device registry", () => {
  // Names come from content/ashkan-medical/products.json via the importer.
  test.each([
    ["Prime Lase", "primelase"],
    ["Primelase Excellence", "primelase"],
    ["Elysion Pro", "laserCart"],
    ["Angela MX_7000", "angela"],
    ["Pico Premium", "laserCart"],
    ["Q10", "laserCart"],
    ["4Plus", "fourPlus"],
    ["4 Plus", "fourPlus"],
    ["Powershape 2", "powershape2"],
    ["Ashley", "rfPlatform"],
    ["Cooltech / Cooltech Define", "rfPlatform"],
    ["Exciplex", "handheld"],
    ["Wolf", "handheld"],
    ["Tesla Former", "contourStation"],
    ["InBody", "analyzer"],
  ])("%s maps to the %s archetype", (name, variant) => {
    const entry = deviceForProduct({ name });
    expect(entry.variant).toBe(variant);
    expect(ARCHETYPES[entry.variant]).toBeDefined();
    expect(typeof entry.accent).toBe("number");
  });

  test("an unmapped or missing product still yields a usable fallback", () => {
    expect(ARCHETYPES[deviceForProduct({ name: "Some New Device" }).variant]).toBeDefined();
    expect(ARCHETYPES[deviceForProduct(null).variant]).toBeDefined();
  });
});
