/**
 * Cinemática inversa de dois ossos no plano sagital (y para cima, z para a frente).
 * Convenção do rig: ângulo 0 = osso apontando para baixo; ângulo positivo gira o osso para trás
 * (z negativo). `elbow` é o ângulo do segundo osso RELATIVO ao primeiro.
 */
export function solveLimb(l1: number, l2: number, shoulderY: number, shoulderZ: number, targetY: number, targetZ: number): { upper: number; elbow: number } {
  let dy = targetY - shoulderY;
  let dz = targetZ - shoulderZ;
  let dist = Math.hypot(dy, dz);
  const max = l1 + l2 - 0.005;
  const min = Math.abs(l1 - l2) + 0.02;
  if (dist > max) {
    dy *= max / dist;
    dz *= max / dist;
    dist = max;
  } else if (dist < min) dist = min;
  const aLine = Math.atan2(-dz, -dy);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))));
  const upper = aLine + alpha;
  const elbowY = shoulderY - l1 * Math.cos(upper);
  const elbowZ = shoulderZ - l1 * Math.sin(upper);
  const forearm = Math.atan2(-(shoulderZ + dz - elbowZ), -(shoulderY + dy - elbowY));
  return { upper, elbow: forearm - upper };
}

/**
 * Perna: o joelho dobra PARA A FRENTE (o cotovelo dobra para trás), então resolve no espelho (z → -z)
 * e inverte os ângulos. Retorna a rotação em x da coxa e da canela.
 */
export function solveLeg(thigh: number, shin: number, hipY: number, footY: number, footZ: number): { thigh: number; knee: number } {
  const s = solveLimb(thigh, shin, hipY, 0, footY, -footZ);
  return { thigh: -s.upper, knee: -s.elbow };
}

/** Posição final do membro a partir dos ângulos (convenção do solveLimb) — usada para conferir a IK. */
export function limbEnd(l1: number, l2: number, shoulderY: number, shoulderZ: number, upper: number, elbow: number): { y: number; z: number } {
  const f = upper + elbow;
  return { y: shoulderY - l1 * Math.cos(upper) - l2 * Math.cos(f), z: shoulderZ - l1 * Math.sin(upper) - l2 * Math.sin(f) };
}
