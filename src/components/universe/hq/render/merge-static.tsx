"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Assinatura visual de um material: dois materiais com a mesma assinatura se desenham igual e podem compartilhar a malha fundida. */
function materialSignature(mat: THREE.Material): string {
  const m = mat as THREE.MeshPhysicalMaterial;
  const tex = (t: THREE.Texture | null | undefined) => (t ? t.uuid : "-");
  return [
    m.type,
    m.color?.getHexString(),
    m.emissive?.getHexString(),
    m.emissiveIntensity,
    m.roughness,
    m.metalness,
    m.opacity,
    m.envMapIntensity,
    m.side,
    m.flatShading ? 1 : 0,
    m.toneMapped ? 1 : 0,
    m.clearcoat ?? 0,
    m.transmission ?? 0,
    m.reflectivity ?? 0,
    tex(m.map),
    tex(m.normalMap),
    tex(m.roughnessMap),
    tex(m.bumpMap),
    m.bumpScale ?? 0,
    m.normalScale ? `${m.normalScale.x}` : "-",
  ].join(",");
}

type R3fInstance = { props?: Record<string, unknown> } | undefined;

/** Malha mesclável: opaca, estática, sem eventos, sem pele/instâncias/morph e com um único material. */
function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (!m.visible || m.userData.noMerge || Object.keys(m.userData).some((k) => k.endsWith("Click"))) return false;
  const mat = m.material;
  if (Array.isArray(mat) || !mat) return false;
  const std = mat as THREE.MeshStandardMaterial;
  if (std.transparent || std.vertexColors || std.alphaTest > 0 || std.wireframe) return false;
  if (!m.geometry?.attributes.position || m.geometry.morphAttributes.position) return false;
  const inst = (m as unknown as { __r3f?: R3fInstance }).__r3f;
  if (inst?.props && Object.keys(inst.props).some((k) => /^on[A-Z]/.test(k))) return false;
  return true;
}

/**
 * Funde as malhas estáticas e opacas da subárvore: uma só draw call por (aparência do material × sombra). Materiais com a mesma assinatura visual (cor, brilho, texturas…) compartilham a malha fundida; como o material usado é o da primeira malha, mudanças de material em runtime exigem refundir (mude a `key`). As originais
 * ficam invisíveis, mas continuam existindo — cliques e hover do R3F seguem funcionando como antes.
 *
 * Só para árvores que não se movem nem trocam de forma. Malhas que entram depois (Suspense) ou que têm
 * evento/transparência/animação simplesmente não entram na fusão e continuam sendo desenhadas normalmente.
 * `enabled=false` (nível Baixo/depuração) deixa a árvore intacta. Mude a `key` para refundir.
 */
export function MergeStatic({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const group = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    const root = group.current;
    if (!root || !enabled) return;
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    type Bucket = { material: THREE.Material; cast: boolean; receive: boolean; indexed: boolean; geos: THREE.BufferGeometry[]; sources: THREE.Mesh[] };
    const buckets = new Map<string, Bucket>();
    root.traverse((o) => {
      if (!mergeable(o)) return;
      const g = o.geometry as THREE.BufferGeometry;
      const key = [materialSignature(o.material as THREE.Material), o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, g.index ? 1 : 0, ["position", "normal", "uv"].map((a) => (g.attributes[a] ? 1 : 0)).join("")].join("|");
      let b = buckets.get(key);
      if (!b) {
        b = { material: o.material as THREE.Material, cast: o.castShadow, receive: o.receiveShadow, indexed: !!g.index, geos: [], sources: [] };
        buckets.set(key, b);
      }
      o.updateWorldMatrix(true, false);
      const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const clone = g.clone();
      // só os atributos comuns entram (evita incompatibilidade na fusão)
      for (const name of Object.keys(clone.attributes)) if (!["position", "normal", "uv"].includes(name)) clone.deleteAttribute(name);
      clone.applyMatrix4(rel);
      b.geos.push(clone);
      b.sources.push(o);
    });

    const created: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    for (const b of buckets.values()) {
      if (b.geos.length < 2) {
        b.geos.forEach((g) => g.dispose());
        continue;
      }
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.raycast = () => {}; // os cliques continuam nas malhas originais (invisíveis)
      mesh.userData.noMerge = true;
      root.add(mesh);
      created.push(mesh);
      for (const src of b.sources) {
        src.visible = false;
        hidden.push(src);
      }
    }
    return () => {
      for (const m of created) {
        root.remove(m);
        m.geometry.dispose(); // o material é das originais: não descartar aqui
      }
      for (const src of hidden) src.visible = true;
    };
  }, [enabled]);

  return <group ref={group}>{children}</group>;
}
