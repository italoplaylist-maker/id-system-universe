"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { useCameraStore } from "@/store/camera-store";

interface UniverseCameraControllerProps {
  /** The HQ's current overview shot — read once per change into a ref, never applied to the camera automatically. Only an explicit reset() (or the very first mount) actually moves the camera to it. */
  overviewCenter: [number, number];
  overviewRadius: number;
}

// Same isometric-leaning direction used for the default overview shot and
// every "canned" focus shot (Project/Provider) — focusing something flies
// closer along the same angle instead of cutting to a different one.
const VIEW_DIRECTION = new THREE.Vector3(1.05, 0.8, 1.05).normalize();

const MIN_DISTANCE = 1.2;
const RESOURCE_DISTANCE = 2.2;
const PROJECT_DISTANCE_FACTOR = 1.7;
const KEY_ROTATE_SPEED = 1.4; // rad/s
const LERP_RATE = 6.5; // exponential approach rate, frame-rate independent (see damp())

// Module-level, not inline in JSX — a fresh object literal every render is
// otherwise reassigned onto the controls instance on every render for no
// reason (harmless on its own, but needless churn on the same hot path that
// had a real bug — see MapControls's onStart/onEnd/onChange below).
const MOUSE_BUTTONS = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE } as const;

type Shot = { position: THREE.Vector3; target: THREE.Vector3 };

function overviewShot(center: [number, number], radius: number): Shot {
  return {
    target: new THREE.Vector3(center[0], 0, center[1]),
    position: new THREE.Vector3(center[0], 0, center[1]).addScaledVector(VIEW_DIRECTION, radius * 1.05),
  };
}

/** Used for both Project and Provider focus — distance scales with the target's own footprint radius. */
function boundedShot(center: [number, number, number], radius: number): Shot {
  const distance = Math.max(radius * PROJECT_DISTANCE_FACTOR, 3.5);
  const target = new THREE.Vector3(center[0], center[1], center[2]);
  return { target, position: target.clone().addScaledVector(VIEW_DIRECTION, distance) };
}

function resourceShot(center: [number, number, number]): Shot {
  const target = new THREE.Vector3(center[0], center[1], center[2]);
  return { target, position: target.clone().addScaledVector(VIEW_DIRECTION, RESOURCE_DISTANCE) };
}

/** "Look here" — keeps the current camera-to-target offset (zoom level, angle), just slides both toward the new point. */
function pointShot(center: [number, number, number], currentPosition: THREE.Vector3, currentTarget: THREE.Vector3): Shot {
  const target = new THREE.Vector3(center[0], center[1], center[2]);
  const offset = currentPosition.clone().sub(currentTarget);
  return { target, position: target.clone().add(offset) };
}

/** Exponential ease toward `target`, frame-rate independent (Vector3 equivalent of the standard `damp()` trick). */
function dampVector3(current: THREE.Vector3, target: THREE.Vector3, rate: number, dt: number) {
  const t = 1 - Math.exp(-rate * dt);
  current.lerp(target, t);
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * The one authority over the camera (briefing: "NÃO crie dois controladores
 * brigando"). Everything else dispatches semantic commands through
 * useCameraStore (focusProject/focusResource/focusProvider/focusPoint/reset)
 * — nothing outside this file ever touches camera.position or a controls
 * target directly.
 *
 * Built on drei's MapControls (not OrbitControls): its defaults already are
 * exactly the requested mapping — LEFT drag = pan across the ground plane,
 * RIGHT drag = orbit around the current target, `screenSpacePanning=false`
 * confines panning to the ground plane instead of drifting in Y. Zoom uses
 * three.js's own built-in `zoomToCursor` (verified in three-stdlib source:
 * it raycasts toward the cursor and re-derives the target by intersecting a
 * ground-height plane) rather than a hand-rolled raycaster — it already does
 * exactly what was asked and is far better tested.
 *
 * The target is never a fixed point (briefing's core rule): MapControls'
 * own `target` is whatever pan/orbit/zoom last left it at, and a focus
 * command only ever *nudges* it via an animated transition — nothing here
 * ever calls `target.set(centerX, 0, centerZ)` as a standing rule.
 */
export function UniverseCameraController({ overviewCenter, overviewRadius }: UniverseCameraControllerProps) {
  const { camera } = useThree();
  const controlsRef = useRef<MapControlsImpl>(null);

  const overviewCenterRef = useRef<[number, number]>(overviewCenter);
  const overviewRadiusRef = useRef(overviewRadius);
  useEffect(() => {
    overviewCenterRef.current = overviewCenter;
    overviewRadiusRef.current = overviewRadius;
  }, [overviewCenter, overviewRadius]);

  const desiredPosition = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const transitioning = useRef(false);
  const lastAppliedToken = useRef(0);
  const userGestureActive = useRef(false);

  // Initial camera pose, set exactly once, the first moment the controls
  // instance genuinely exists. This deliberately does NOT use a reactive
  // `position` prop on <PerspectiveCamera> — r3f re-applies a declarative
  // prop on every value change, and overviewCenter/overviewRadius change on
  // every layout recompute (including background polling). A reactive
  // position prop would fight MapControls for ownership of camera.position
  // every time that happens — precisely the "camera resets on polling" bug
  // class this rewrite exists to eliminate.
  //
  // This does NOT live in a mount-only `useEffect`: an empty-deps effect can
  // fire before MapControls has actually constructed its underlying
  // controls instance and bound it to a resolved default camera (a real
  // ordering race between sibling <PerspectiveCamera makeDefault> and
  // <MapControls>), in which case controlsRef.current is either still null
  // or bound to a camera at its raw post-construction position/target
  // (both (0,0,0)) — the observed symptom was every session opening with
  // the camera clamped to MIN_DISTANCE along a degenerate direction instead
  // of the real overview shot. Doing it as a one-shot inside useFrame
  // instead guarantees the render loop (and therefore a live, bound
  // controls instance) has actually started.
  const initialized = useRef(false);

  const command = useCameraStore((s) => s.command);
  const setFree = useCameraStore((s) => s.setFree);

  // Stable across renders on purpose (empty deps — only refs and
  // useCameraStore.getState() inside, never a reactive selector value). drei's
  // <MapControls> tears down and re-attaches EVERY pointer/wheel/touch
  // listener in a useEffect keyed on [onChange, onStart, onEnd, ...] — an
  // inline arrow prop here is a new reference every render, and HqScene
  // re-renders on every TanStack Query poll (applications/projects refetch
  // every few seconds), so that was disconnecting and reconnecting the
  // controls constantly, including mid-gesture. Symptom in production:
  // mouse dragging felt broken/stuck, touch was far worse (more frequent
  // relative re-renders, and a torn-down listener mid-touch is more
  // disruptive than mid-mouse-drag). This is the actual fix for that.
  const handleStart = useCallback(() => {
    userGestureActive.current = true;
  }, []);
  const handleEnd = useCallback(() => {
    userGestureActive.current = false;
  }, []);
  const handleChange = useCallback(() => {
    // Only a real user gesture (drag/wheel) should cancel a transition and
    // drop into free mode — our own transition lerp also mutates
    // position/target every frame, which would otherwise re-trigger this
    // same "change" event and immediately cancel itself.
    if (!userGestureActive.current) return;
    transitioning.current = false;
    useCameraStore.getState().setFree();
  }, []);

  // Apply a new command the moment its token changes — never re-applies the
  // same command twice (e.g. on an unrelated re-render).
  useEffect(() => {
    if (!command || command.token === lastAppliedToken.current) return;
    lastAppliedToken.current = command.token;
    const controls = controlsRef.current;
    if (!controls) return;

    let shot: Shot;
    if (command.kind === "reset") shot = overviewShot(overviewCenterRef.current, overviewRadiusRef.current);
    else if (command.kind === "resource") shot = resourceShot(command.center);
    else if (command.kind === "point") shot = pointShot(command.center, controls.object.position, controls.target);
    else shot = boundedShot(command.center, command.radius ?? 4);

    desiredPosition.current.copy(shot.position);
    desiredTarget.current.copy(shot.target);
    transitioning.current = true;
  }, [command]);

  // Keyboard: WASD/arrows pan across the ground plane relative to where the
  // camera is actually looking (never world-fixed axes), Q/E orbit, F
  // re-focuses whatever's currently selected is out of this controller's
  // scope (left to the caller — see hq-view.tsx), Home resets.
  const pressedKeys = useRef(new Set<string>());
  useEffect(() => {
    const keys = pressedKeys.current;
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if (key === "home") {
        useCameraStore.getState().reset();
        return;
      }
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        keys.add(key);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      keys.clear();
    };
  }, []);

  useFrame((_, rawDelta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const dt = Math.min(rawDelta, 1 / 20);

    if (!initialized.current) {
      initialized.current = true;
      const shot = overviewShot(overviewCenterRef.current, overviewRadiusRef.current);
      controls.object.position.copy(shot.position);
      controls.target.copy(shot.target);
      controls.update();
      return;
    }

    // Keyboard navigation — direction is derived from the camera's own
    // current orientation, projected onto the ground plane, so "forward"
    // always means "where I'm looking," never a fixed world axis.
    const keys = pressedKeys.current;
    if (keys.size > 0) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      right.y = 0;
      right.normalize();

      const distance = controls.object.position.distanceTo(controls.target);
      const moveSpeed = THREE.MathUtils.clamp(distance * 0.9, 2, 40);
      const step = new THREE.Vector3();
      if (keys.has("w") || keys.has("arrowup")) step.add(forward);
      if (keys.has("s") || keys.has("arrowdown")) step.sub(forward);
      if (keys.has("d") || keys.has("arrowright")) step.add(right);
      if (keys.has("a") || keys.has("arrowleft")) step.sub(right);

      if (step.lengthSq() > 0) {
        step.normalize().multiplyScalar(moveSpeed * dt);
        controls.object.position.add(step);
        controls.target.add(step);
        transitioning.current = false;
        setFree();
      }

      if (keys.has("q") || keys.has("e")) {
        const angle = (keys.has("q") ? 1 : -1) * KEY_ROTATE_SPEED * dt;
        const offset = controls.object.position.clone().sub(controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        controls.object.position.copy(controls.target).add(offset);
        transitioning.current = false;
        setFree();
      }
    }

    // Animated focus/reset transition — eases both position and target
    // toward the desired shot, then hands full control back to MapControls
    // (no more auto-adjustment fighting the user once it settles).
    if (transitioning.current) {
      dampVector3(controls.object.position, desiredPosition.current, LERP_RATE, dt);
      dampVector3(controls.target, desiredTarget.current, LERP_RATE, dt);
      if (controls.object.position.distanceTo(desiredPosition.current) < 0.03 && controls.target.distanceTo(desiredTarget.current) < 0.03) {
        transitioning.current = false;
      }
    }

    // Keep the camera from ever dipping through the floor, regardless of
    // how it got there (orbit limits already discourage this, this is the
    // hard floor).
    if (controls.object.position.y < 0.15) controls.object.position.y = 0.15;
  });

  const maxDistance = Math.max(overviewRadius * 3, 20);
  const far = Math.max(overviewRadius * 6, 100);

  return (
    <>
      {/* No `position` prop: r3f would re-apply it reactively on every
          overviewCenter/overviewRadius change (every layout recompute,
          including background polling), fighting MapControls for ownership
          of camera.position. Initial pose is set once, imperatively, above. */}
      <PerspectiveCamera makeDefault fov={45} near={0.05} far={far} />
      <MapControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        screenSpacePanning={false}
        enablePan
        panSpeed={1}
        enableRotate
        rotateSpeed={0.55}
        enableZoom
        zoomToCursor
        zoomSpeed={1.1}
        minDistance={MIN_DISTANCE}
        maxDistance={maxDistance}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2.05}
        mouseButtons={MOUSE_BUTTONS}
        onStart={handleStart}
        onEnd={handleEnd}
        onChange={handleChange}
      />
      <CameraDebugOverlay controlsRef={controlsRef} />
    </>
  );
}

/**
 * `?debugCamera=true` shows the current orbit target as a small sphere
 * (invisible by default), and exposes the live position/target/distance as
 * `window.__cameraDebug()` — the same flag, just also readable from outside
 * the page (browser console, an automated test) instead of only by eye.
 */
function CameraDebugOverlay({ controlsRef }: { controlsRef: React.RefObject<MapControlsImpl | null> }) {
  const [enabled] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugCamera") === "true");
  const sphereRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!enabled) return;
    (window as unknown as Record<string, unknown>).__cameraDebug = () => {
      const controls = controlsRef.current;
      if (!controls) return null;
      return {
        position: controls.object.position.toArray(),
        target: controls.target.toArray(),
        distance: controls.object.position.distanceTo(controls.target),
      };
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__cameraDebug;
    };
  }, [enabled, controlsRef]);

  useFrame(() => {
    if (!enabled) return;
    const controls = controlsRef.current;
    const sphere = sphereRef.current;
    if (!controls || !sphere) return;
    sphere.position.copy(controls.target);
  });

  if (!enabled) return null;
  return (
    <mesh ref={sphereRef}>
      <sphereGeometry args={[0.12, 16, 16]} />
      <meshBasicMaterial color="#ff2ea6" />
    </mesh>
  );
}
