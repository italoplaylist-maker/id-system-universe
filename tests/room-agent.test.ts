import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roomAgentToSession } from "../src/lib/room-agent";
import type { RoomAgentView } from "../src/server/orchestrator/service";

const base: RoomAgentView = {
  id: "ag1", name: "Backend", specialty: "API", cwd: "/srv/app", projectId: null, model: null, permissionMode: "default", paused: false, hasSession: true,
  state: "AVAILABLE", currentTask: null, activity: null, queued: 0, approval: null, lastFinishedAt: null, lastError: null, position: 0,
};

describe("funcionário permanente → cena", () => {
  it("existe sempre, com nome e identidade estáveis, em qualquer estado", () => {
    for (const state of ["AVAILABLE", "RECEIVING", "RUNNING", "WAITING", "DONE", "ERROR", "PAUSED"] as const) {
      const s = roomAgentToSession({ ...base, state });
      assert.equal(s.id, "ag1");
      assert.equal(s.profile?.title, "Backend");
      assert.equal(s.profile?.roomState, state);
    }
  });

  it("a animação só representa o estado real: disponível/concluído/pausado não digitam; executando e recebendo sim", () => {
    const st = (state: RoomAgentView["state"]) => roomAgentToSession({ ...base, state }).state;
    assert.equal(st("AVAILABLE"), "IDLE");
    assert.equal(st("DONE"), "IDLE");
    assert.equal(st("PAUSED"), "IDLE");
    assert.equal(st("RUNNING"), "WORKING");
    assert.equal(st("RECEIVING"), "WORKING");
    assert.equal(st("WAITING"), "APPROVAL");
    assert.equal(st("ERROR"), "ERROR");
  });

  it("o pedido de aprovação e a fila chegam à mesa", () => {
    const s = roomAgentToSession({ ...base, state: "WAITING", queued: 2, approval: { id: "ap1", taskId: "t1", tool: "Bash", detail: "npm test" } });
    assert.equal(s.approval?.tool, "Bash");
    assert.equal(s.profile?.queued, 2);
  });
});
