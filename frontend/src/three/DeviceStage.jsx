import { useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { createDevice } from "./devices/archetypes.js";
import { applyExplode, disposeDevice } from "./devices/parts.js";
import { markThreeLoaded } from "../components/ui/DeviceLoader.jsx";

// Importing this module means three.js is now in the bundle graph and
// downloaded. Tell DeviceLoader, so subsequent route transitions can use the
// 3D loader without ever being the thing that triggers the download.
markThreeLoaded();

// Screen emissive colors per mood. Kept in sync with the brand tokens in
// index.css (--color-brand-green / --color-brand-blue).
const MOOD_COLORS = {
  idle: 0x22c55e,
  focus: 0x3b82f6,
  typing: 0x38bdf8,
  error: 0xef4444,
  success: 0x22c55e,
};

// Imperative WebGL stage for the InBody device. Rendered lazily (never on
// the server -- see the React.lazy call sites) and completely inert when
// reduced motion is requested or WebGL is unavailable, in which case the
// parent's `fallback` is shown instead.
//
// Exposes a ref API rather than props-per-frame so callers can drive it at
// animation rate (GSAP scrub on the homepage, input events on auth) without
// forcing a React re-render for every tick.
// Pointer travel (px) below which a press counts as a tap rather than a
// drag. Generous, because a thumb on a phone always smears a few pixels.
const DRAG_THRESHOLD = 7;

export function DeviceStage({
  ref,
  reducedMotion = false,
  autoSpin = true,
  initialExplode = 0,
  variant = "analyzer",
  accent,
  interactive = false,
  onReady,
  onInteract,
  className,
}) {
  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        // MSAA is worth its fill-rate cost at 1x, where stair-stepping on
        // these thin cylinders is obvious. At 2x the downsample is already
        // doing the same job, and skipping it is a straight saving on
        // exactly the devices (phones) where it costs the most.
        antialias: dpr < 2,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setFailed(true); // no WebGL (old device, headless browser, blocked GPU)
      return undefined;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.4, 9.2);

    // Clamp DPR: this is a decorative hero on a phone-width shell, and
    // rendering at a Retina 3x costs far more than it visibly returns.
    renderer.setPixelRatio(dpr);
    renderer.setSize(mount.clientWidth || 1, mount.clientHeight || 1, false);
    renderer.shadowMap.enabled = false; // soft key/fill/rim reads fine without the cost
    mount.appendChild(renderer.domElement);

    const device = createDevice(variant, accent);
    scene.add(device.root);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rimGreen = new THREE.DirectionalLight(0x22c55e, 1.1);
    rimGreen.position.set(-5, 1.5, -3);
    scene.add(rimGreen);
    const rimBlue = new THREE.DirectionalLight(0x3b82f6, 1.0);
    rimBlue.position.set(5, -1.5, -3);
    scene.add(rimBlue);

    // --- animation state driven by the imperative API ---
    const state = {
      explode: initialExplode,
      targetExplode: initialExplode,
      yaw: 0,
      targetYaw: 0,
      pitch: 0,
      targetPitch: 0,
      mood: "idle",
      moodColor: new THREE.Color(MOOD_COLORS.idle),
      targetEmissive: 0.55,
      shakeUntil: 0,
      visible: true,
      // Set once the user drags the model themselves. From then on their
      // chosen angle wins: scroll-driven look() and the idle drift both
      // back off rather than yanking the device out of their hands.
      manual: false,
      dragging: false,
      spinVelocity: 0,
      // The homepage mounts two of these at once. Rendering one that's
      // scrolled far off-screen is pure waste, so each stage tracks its
      // own visibility and skips the frame entirely when it isn't showing.
      onScreen: true,
    };
    applyExplode(device.parts, state.explode);

    // Each archetype authors its own resting height (they're different
    // shapes -- a chair, a benchtop box, a 3m laser tower). Float around
    // that, instead of overwriting it with one hard-coded value.
    const baseY = device.root.position.y;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Pause the loop when the tab is hidden -- a WebGL loop running behind
    // a backgrounded tab is pure battery burn.
    const onVisibility = () => {
      state.visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Margin so the device is already animating by the time it scrolls in,
    // rather than snapping to life at the viewport edge.
    const intersection = new IntersectionObserver(
      ([entry]) => {
        state.onScreen = entry.isIntersecting;
      },
      { rootMargin: "160px" }
    );
    intersection.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();

    const renderFrame = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const now = performance.now();

      // Ease everything toward its target so callers can set values
      // discretely and still get smooth motion.
      // Flick inertia: keep spinning after the finger lifts, decaying to a
      // stop, so a quick swipe sends the device turning.
      if (!state.dragging && Math.abs(state.spinVelocity) > 0.0002) {
        state.targetYaw += state.spinVelocity;
        state.spinVelocity *= 0.93;
      }

      const k = 1 - Math.exp(-dt * 6);
      state.explode += (state.targetExplode - state.explode) * k;
      state.yaw += (state.targetYaw - state.yaw) * k;
      state.pitch += (state.targetPitch - state.pitch) * k;

      applyExplode(device.parts, state.explode);

      let yaw = state.yaw;
      if (autoSpin && !reducedMotion && !state.manual) {
        yaw += Math.sin(now / 4200) * 0.16; // slow idle drift, never a full spin
      }
      if (now < state.shakeUntil) {
        const remaining = (state.shakeUntil - now) / 420;
        yaw += Math.sin(now / 24) * 0.09 * remaining;
      }
      device.root.rotation.y = yaw;
      device.root.rotation.x = state.pitch;
      if (!reducedMotion) {
        device.root.position.y = baseY + Math.sin(now / 2600) * 0.07; // gentle float
      }

      // Screen mood: lerp color + intensity, with a subtle "data flicker"
      // while typing so it reads as actively measuring.
      device.screenMaterial.emissive.lerp(state.moodColor, k);
      let intensity = state.targetEmissive;
      if (state.mood === "typing" && !reducedMotion) {
        intensity += Math.sin(now / 90) * 0.22;
      }
      device.screenMaterial.emissiveIntensity +=
        (intensity - device.screenMaterial.emissiveIntensity) * k;

      renderer.render(scene, camera);
    };

    // Nothing here is settling: no drag, no explode/rotation still easing,
    // no flick spinning down, no shake. What's left is the idle float and
    // drift, which move so slowly that halving their frame rate is not
    // perceptible -- whereas dragging at half rate very much is.
    const SETTLED_EPS = 1e-3;
    const isIdle = (now) =>
      !state.dragging &&
      now >= state.shakeUntil &&
      Math.abs(state.targetExplode - state.explode) < SETTLED_EPS &&
      Math.abs(state.targetYaw - state.yaw) < SETTLED_EPS &&
      Math.abs(state.targetPitch - state.pitch) < SETTLED_EPS &&
      Math.abs(state.spinVelocity) < SETTLED_EPS;

    const IDLE_FRAME_MS = 1000 / 30;
    let lastDrawAt = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      // Backgrounded tab or scrolled out of view: skip the work entirely.
      if (!state.visible || !state.onScreen) return;
      const now = performance.now();
      if (isIdle(now) && now - lastDrawAt < IDLE_FRAME_MS) return;
      lastDrawAt = now;
      renderFrame();
    };

    // Direct manipulation: drag to turn the device in your hand, tap to
    // blow it apart, tap again to reassemble. One gesture handler decides
    // which it was from how far the pointer travelled. The canvas is
    // pointer-events-none by default (it overlays form fields on the auth
    // pages), so this only binds when a caller opts in.
    const el = renderer.domElement;
    let onPointerDown = null;
    let onPointerMove = null;
    let onPointerUp = null;
    if (interactive) {
      el.style.pointerEvents = "auto";
      el.style.cursor = "grab";
      // Vertical page scrolling still has to work when the drag starts on
      // the canvas, so only horizontal gestures are claimed outright.
      el.style.touchAction = "pan-y";

      let travelled = 0;
      let lastX = 0;
      let lastY = 0;
      let activeId = null;

      onPointerDown = (e) => {
        activeId = e.pointerId;
        state.dragging = true;
        state.spinVelocity = 0;
        travelled = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        el.setPointerCapture?.(e.pointerId);
        el.style.cursor = "grabbing";
        onInteract?.();
      };

      onPointerMove = (e) => {
        if (!state.dragging || e.pointerId !== activeId) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        travelled += Math.abs(dx) + Math.abs(dy);
        if (travelled <= DRAG_THRESHOLD) return;
        state.manual = true;
        state.targetYaw += dx * 0.011;
        // Clamped: letting the pitch roll past vertical turns the device
        // upside down, which never looks intentional.
        state.targetPitch = Math.max(-0.55, Math.min(0.55, state.targetPitch + dy * 0.006));
        state.spinVelocity = dx * 0.011;
      };

      onPointerUp = (e) => {
        if (!state.dragging) return;
        state.dragging = false;
        el.releasePointerCapture?.(e.pointerId);
        el.style.cursor = "grab";
        // Barely moved => it was a tap, so toggle the explode instead.
        if (travelled <= DRAG_THRESHOLD) {
          state.spinVelocity = 0;
          state.targetExplode = state.targetExplode > 0.5 ? 0 : 1;
        }
      };

      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointercancel", onPointerUp);
    }

    if (reducedMotion) {
      // Draw exactly one frame: the device is still visible and correct,
      // it just never animates.
      renderFrame();
    } else {
      loop();
    }

    apiRef.current = {
      setExplode(t) {
        state.targetExplode = Math.max(0, Math.min(1, t));
      },
      // Immediate, non-eased -- for scroll scrubbing, where GSAP is already
      // doing the smoothing and a second ease would feel laggy.
      setExplodeImmediate(t) {
        state.targetExplode = state.explode = Math.max(0, Math.min(1, t));
        applyExplode(device.parts, state.explode);
      },
      // Scroll-driven framing. Yields permanently once the user has turned
      // the device themselves -- fighting a drag for control of the same
      // axis feels broken, and their angle is the more deliberate one.
      look(x, y) {
        if (state.manual) return;
        state.targetYaw = x * 0.5;
        state.targetPitch = y * 0.26;
      },
      isManual: () => state.manual,
      setMood(mood) {
        state.mood = mood;
        state.moodColor = new THREE.Color(MOOD_COLORS[mood] ?? MOOD_COLORS.idle);
        state.targetEmissive = mood === "success" ? 1.5 : mood === "error" ? 1.2 : mood === "idle" ? 0.55 : 0.9;
      },
      shake() {
        state.shakeUntil = performance.now() + 420;
      },
      renderOnce: renderFrame,
    };
    onReady?.(apiRef.current);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (onPointerDown) {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onPointerUp);
        el.removeEventListener("pointercancel", onPointerUp);
      }
      disposeDevice(device);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // autoSpin/initialExplode/onReady are read once at setup; re-running the
    // whole WebGL bootstrap on their identity change would be far worse than
    // the staleness. reducedMotion genuinely must rebuild the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, variant, accent, interactive]);

  useImperativeHandle(ref, () => ({
    setExplode: (t) => apiRef.current?.setExplode(t),
    setExplodeImmediate: (t) => apiRef.current?.setExplodeImmediate(t),
    look: (x, y) => apiRef.current?.look(x, y),
    setMood: (m) => apiRef.current?.setMood(m),
    shake: () => apiRef.current?.shake(),
    isManual: () => apiRef.current?.isManual() ?? false,
  }));

  if (failed) return null;
  return <div ref={mountRef} aria-hidden className={`device-stage ${className || ""}`} />;
}

export default DeviceStage;
