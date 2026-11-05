import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { limbEnd, solveLeg, solveLimb } from "@/components/universe/hq/assets/rig-ik";

describe("Rig — cinemática inversa", () => {
  it("o braço alcança o alvo (dentro do alcance)", () => {
    for (const [ty, tz] of [[0.79, 0.5], [0.64, 0.3], [1.1, 0.25], [0.98, 0.3]]) {
      const s = solveLimb(0.29, 0.26, 0.96, 0.1, ty, tz);
      const end = limbEnd(0.29, 0.26, 0.96, 0.1, s.upper, s.elbow);
      assert.ok(Math.hypot(end.y - ty, end.z - tz) < 0.01, `alvo (${ty}, ${tz}) -> (${end.y.toFixed(3)}, ${end.z.toFixed(3)})`);
    }
  });

  it("a perna sentada reproduz a pose de cadeira: coxa ~horizontal para a frente, canela ~vertical", () => {
    const l = solveLeg(0.45, 0.42, 0.5, 0.07, 0.42);
    assert.ok(Math.abs(l.thigh - -Math.PI / 2) < 0.3, `coxa ${l.thigh.toFixed(2)}`);
    assert.ok(l.knee > 1.0 && l.knee < 1.9, `joelho ${l.knee.toFixed(2)}`);
  });

  it("a perna em pé fica esticada e o joelho nunca dobra para trás", () => {
    const l = solveLeg(0.45, 0.42, 0.93, 0.07, 0);
    assert.ok(Math.abs(l.thigh) < 0.25);
    assert.ok(l.knee >= 0, "joelho dobra para a frente (ângulo da canela positivo)");
    for (let z = -0.3; z <= 0.3; z += 0.1) {
      const s = solveLeg(0.45, 0.42, 0.92, 0.07 + Math.max(0, z) * 0.3, z);
      assert.ok(s.knee >= -0.01, `passada z=${z.toFixed(1)}: joelho ${s.knee.toFixed(2)}`);
    }
  });
});
