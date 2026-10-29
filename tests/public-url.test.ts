import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAppOrigin, isSafeInternalPath, redirectToPath } from "@/server/http/public-url";

const env = (APP_URL?: string): Record<string, string | undefined> => ({ APP_URL });

describe("URL pública e redirects", () => {
  it("usa APP_URL (só a origem) e rejeita valores perigosos", () => {
    assert.equal(getAppOrigin(env("https://universe.exemplo.com/qualquer/coisa")), "https://universe.exemplo.com");
    assert.equal(getAppOrigin(env("http://localhost:3000")), "http://localhost:3000");
    assert.equal(getAppOrigin(env("https://0.0.0.0:3000")), null);
    assert.equal(getAppOrigin(env("javascript:alert(1)")), null);
    assert.equal(getAppOrigin(env("isto não é url")), null);
    assert.equal(getAppOrigin(env(undefined)), null);
  });

  it("redirect absoluto com APP_URL e relativo sem ela — nunca 0.0.0.0", () => {
    const withUrl = redirectToPath("/settings/integrations?github=connected", 307, env("https://universe.exemplo.com"));
    assert.equal(withUrl.headers.get("location"), "https://universe.exemplo.com/settings/integrations?github=connected");
    const without = redirectToPath("/settings/integrations?github=connected", 307, env(undefined));
    assert.equal(without.headers.get("location"), "/settings/integrations?github=connected");
    const bad = redirectToPath("/x", 307, env("https://0.0.0.0:3000"));
    assert.equal(bad.headers.get("location"), "/x");
  });

  it("bloqueia open redirect", () => {
    for (const evil of ["//evil.com", "/\\evil.com", "https://evil.com", "evil", "/ok\r\nSet-Cookie: x=1"]) {
      assert.equal(isSafeInternalPath(evil), false, evil);
      assert.throws(() => redirectToPath(evil, 307, env(undefined)));
    }
    assert.equal(isSafeInternalPath("/settings/integrations?github=connected"), true);
  });
});
