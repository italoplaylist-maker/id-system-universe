"use client";

import { Component, Suspense, type ReactNode } from "react";
import { Clone, useGLTF } from "@react-three/drei";

interface GltfModelProps {
  path: string;
  scale: number;
  rotationY: number;
}

/** Loads and instances a GLB — `Clone` shares the parsed geometry/material across every placement instead of re-parsing the file per instance (briefing 60). */
function GltfModel({ path, scale, rotationY }: GltfModelProps) {
  const { scene } = useGLTF(path);
  return <Clone object={scene} scale={scale} rotation={[0, rotationY, 0]} />;
}

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/**
 * A GLB that fails to fetch or parse falls back procedurally instead of
 * taking the whole Canvas down with it (briefing 88) — class component
 * because error boundaries must be.
 */
class GltfErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[hq] GLB asset failed to load, using procedural fallback:", error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function GltfAsset({ path, scale, rotationY, fallback }: GltfModelProps & { fallback: ReactNode }) {
  return (
    <GltfErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GltfModel path={path} scale={scale} rotationY={rotationY} />
      </Suspense>
    </GltfErrorBoundary>
  );
}
