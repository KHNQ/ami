import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";

// The 404 scene: a slowly drifting field of instanced cubes with a hollow
// "404" carved out of it, lit in the brand ramp and reacting to the pointer.
//
// Written directly against three.js rather than through the app's
// DeviceStage, which models specific machines and has nothing to say here.
// three is imported dynamically so a 404 -- the one page a visitor never
// intended to load -- does not pull ~550KB into the initial bundle.
//
// Everything is one InstancedMesh. A few thousand separate meshes would be a
// few thousand draw calls; instanced, it is one, which is what makes this
// smooth on a phone.

// 5x7 bitmap per glyph. Cheaper and more legible at this scale than
// tessellating a font, and it keeps the whole scene dependency-free.
const GLYPHS = {
  4: ["0001 0", "00110", "01010", "10010", "11111", "00010", "00010"].map((r) => r.replace(/ /g, "")),
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
};

function digitCells(digit) {
  const rows = GLYPHS[digit] || GLYPHS[0];
  const cells = [];
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === "1") cells.push([x, y]);
    });
  });
  return cells;
}

export function NotFoundScene({ className, onReady }) {
  const mountRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    let cleanup = () => {};

    import("three").then((THREE) => {
      if (disposed) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 26);

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return; // no WebGL -- the static fallback underneath stands
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      // setSize(w, h, false) below sizes the drawing buffer but deliberately
      // leaves the canvas's CSS alone, which means the canvas is laid out at
      // its intrinsic size: buffer pixels, taken as CSS pixels. On a 2x
      // display that is twice the width and height of the band it is meant to
      // fill, so it overflowed down and to the right and the "404" appeared
      // pushed off-centre -- invisible on a 1x screen, which is why it went
      // unnoticed. Pinning the CSS size to the mount keeps the buffer sharp
      // and the picture exactly where the band is.
      const canvas = renderer.domElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      mount.appendChild(canvas);

      // --- build the "404" out of cubes ---------------------------------
      const digits = [4, 0, 4];
      const cellSize = 1.0;
      const glyphW = 5;
      const gap = 1.5;
      const totalW = digits.length * glyphW + (digits.length - 1) * gap;

      const positions = [];
      digits.forEach((d, di) => {
        const offsetX = di * (glyphW + gap) - totalW / 2 + glyphW / 2;
        for (const [x, y] of digitCells(d)) {
          positions.push([
            (x - (glyphW - 1) / 2) * cellSize + offsetX,
            ((7 - 1) / 2 - y) * cellSize,
            0,
          ]);
        }
      });

      const geometry = new THREE.BoxGeometry(0.82, 0.82, 0.82);
      const material = new THREE.MeshStandardMaterial({
        roughness: 0.35,
        metalness: 0.15,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const green = new THREE.Color(0x16a34a);
      const blue = new THREE.Color(0x2563eb);
      const colour = new THREE.Color();
      positions.forEach(([x], i) => {
        // Ramp across the glyphs so the brand gradient runs left to right.
        colour.copy(green).lerp(blue, (x + totalW / 2) / totalW);
        mesh.setColorAt(i, colour);
      });

      scene.add(mesh);
      scene.add(new THREE.AmbientLight(0xffffff, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(6, 8, 10);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x2563eb, 1.4);
      rim.position.set(-8, -4, 6);
      scene.add(rim);

      const dummy = new THREE.Object3D();
      const pointer = { x: 0, y: 0 };
      const target = { x: 0, y: 0 };

      const onPointer = (e) => {
        const rect = mount.getBoundingClientRect();
        target.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        target.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      mount.addEventListener("pointermove", onPointer);

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = mount;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // Pull the camera back on narrow viewports so the glyphs always fit.
        // Framed so the three glyphs fill the band at every width --
        // they are the subject of this page, not a backdrop.
        camera.position.z = w < 640 ? 34 : w < 1024 ? 27 : 22;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(mount);

      let raf = 0;
      const start = performance.now();
      const render = (now) => {
        const t = (now - start) / 1000;
        // Ease toward the pointer rather than tracking it exactly: the lag
        // is what makes the field feel like it has mass.
        pointer.x += (target.x - pointer.x) * 0.05;
        pointer.y += (target.y - pointer.y) * 0.05;

        positions.forEach(([x, y, z], i) => {
          // Each cube bobs on a wave phase-shifted by its position, so the
          // whole field ripples instead of pulsing as one.
          const wave = Math.sin(t * 1.6 + x * 0.55 + y * 0.4) * 0.28;
          dummy.position.set(x, y + wave, z + wave * 1.6);
          dummy.rotation.set(wave * 0.5 + pointer.y * 0.3, t * 0.25 + pointer.x * 0.5, 0);
          const s = 0.9 + Math.sin(t * 2 + x * 0.4) * 0.08;
          dummy.scale.setScalar(s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;

        mesh.rotation.y = pointer.x * 0.35;
        mesh.rotation.x = pointer.y * 0.22;

        renderer.render(scene, camera);
        raf = requestAnimationFrame(render);
      };
      raf = requestAnimationFrame(render);
      onReady?.();

      cleanup = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        mount.removeEventListener("pointermove", onPointer);
        geometry.dispose();
        material.dispose();
        mesh.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [reduced, onReady]);

  return <div ref={mountRef} aria-hidden className={className} />;
}
