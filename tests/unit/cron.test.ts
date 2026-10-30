import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCron, unauthorizedCron } from "@/lib/server/cron";
import { serverEnv, type ServerEnv } from "@/lib/server/env";

vi.mock("@/lib/server/env", () => ({ serverEnv: vi.fn() }));

// A fixed test value, never a real secret. Assertions compare booleans only, so it is not printed.
const SECRET = "test-cron-secret-0123456789abcdef";

const withSecret = (secret: string | undefined) => vi.mocked(serverEnv).mockReturnValue({ CRON_SECRET: secret } as ServerEnv);
const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/judge", authorization === undefined ? {} : { headers: { Authorization: authorization } });

describe("cron authentication", () => {
  beforeEach(() => {
    withSecret(SECRET);
  });

  it("accepts exactly `Bearer <CRON_SECRET>`", () => {
    expect(isAuthorizedCron(request(`Bearer ${SECRET}`))).toBe(true);
  });

  it("rejects every request when CRON_SECRET is not configured", () => {
    withSecret(undefined);
    expect(isAuthorizedCron(request(`Bearer ${SECRET}`))).toBe(false);
    expect(isAuthorizedCron(request("Bearer undefined"))).toBe(false);
    expect(isAuthorizedCron(request("Bearer "))).toBe(false);
  });

  it("rejects a request without an Authorization header", () => {
    expect(isAuthorizedCron(request())).toBe(false);
  });

  it("rejects an incorrect bearer token, including one of the same length", () => {
    expect(isAuthorizedCron(request("Bearer wrong"))).toBe(false);
    expect(isAuthorizedCron(request(`Bearer ${"x".repeat(SECRET.length)}`))).toBe(false);
  });

  it("rejects malformed authorization headers", () => {
    for (const header of [SECRET, `bearer ${SECRET}`, `Basic ${SECRET}`, `Bearer  ${SECRET}`, `Bearer${SECRET}`, "Bearer", `Token ${SECRET}`]) {
      expect(isAuthorizedCron(request(header))).toBe(false);
    }
  });

  it("rejects the correct token with extra characters, or a prefix of it", () => {
    expect(isAuthorizedCron(request(`Bearer ${SECRET}x`))).toBe(false);
    expect(isAuthorizedCron(request(`Bearer ${SECRET},Bearer ${SECRET}`))).toBe(false);
    expect(isAuthorizedCron(request(`Bearer ${SECRET.slice(0, -1)}`))).toBe(false);
  });

  it("unauthorizedCron returns 401 with the standard JSON error", async () => {
    const res = unauthorizedCron();
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } });
  });
});
