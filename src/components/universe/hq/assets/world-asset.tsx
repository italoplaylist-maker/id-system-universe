"use client";

import type { ReactNode } from "react";
import { ASSET_MANIFEST } from "./asset-manifest";
import type { AssetKey } from "./asset-keys";
import { GltfAsset } from "./gltf-asset";

interface WorldAssetProps {
  asset: AssetKey;
  /** The procedural placeholder to render — used directly while the manifest entry is disabled, and again if the GLB fails to load once enabled. */
  fallback: ReactNode;
  position?: [number, number, number];
  rotation?: number;
}

/**
 * The one place that decides GLB vs. procedural fallback. Everything else in
 * the HQ asks for a key and a fallback element; swapping a placeholder for a
 * real model later is a one-line flip in asset-manifest.ts, never a change
 * here or in the room components.
 */
export function WorldAsset({ asset, fallback, position = [0, 0, 0], rotation = 0 }: WorldAssetProps) {
  const entry = ASSET_MANIFEST[asset];
  const useGlb = entry.enabled;

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {useGlb ? <GltfAsset path={entry.path} scale={entry.scale} rotationY={entry.rotationY} fallback={fallback} /> : fallback}
    </group>
  );
}
