import * as THREE from "three";

/** Etiquetas de mesa só aparecem quando a câmera está perto: na Visão Geral dezenas de nomes se sobrepõem e escondem a cena. */
const FULL_UNTIL = 19;
const GONE_AT = 30;

const tmp = new THREE.Vector3();

/** 1 = totalmente visível, 0 = oculta. `pinned` (selecionada/hover) ignora a distância. */
export function labelOpacity(camera: THREE.Camera, x: number, y: number, z: number, pinned: boolean): number {
  if (pinned) return 1;
  const d = camera.position.distanceTo(tmp.set(x, y, z));
  return THREE.MathUtils.clamp((GONE_AT - d) / (GONE_AT - FULL_UNTIL), 0, 1);
}

export function applyLabelFade(el: HTMLElement | null, opacity: number) {
  if (!el) return;
  const hidden = opacity < 0.02;
  const v = hidden ? "hidden" : "visible";
  if (el.style.visibility !== v) el.style.visibility = v;
  const o = String(Math.round(opacity * 100) / 100);
  if (el.style.opacity !== o) el.style.opacity = o;
}
