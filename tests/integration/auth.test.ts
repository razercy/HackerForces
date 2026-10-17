import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type Auth } from "@/lib/server/auth/create-auth";
import type { Db } from "@/lib/server/db";
import { account, user, userRole } from "@/lib/server/db/schema";
import { getRoles } from "@/lib/server/services/roles";
import { createTestDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
let auth: Auth;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth({ db, secret: "test-secret-test-secret-test-secret-123", baseURL: "http://localhost:3000" });
});
afterAll(async () => close());

async function signUp(email: string, extra: Record<string, unknown> = {}) {
  return auth.api.signUpEmail({ body: { email, password: "correct horse battery", name: "Tester", ...extra } as never });
}

describe("authentication", () => {
  it("sign-up creates a contestant with a hashed password", async () => {
    const res = await signUp("alice@example.test");
    expect(res.user.email).toBe("alice@example.test");
    expect(await getRoles(db, res.user.id)).toEqual(["contestant"]);

    const [cred] = await db.select().from(account).where(eq(account.userId, res.user.id));
    expect(cred?.providerId).toBe("credential");
    expect(cred?.password).toBeTruthy();
    expect(cred?.password).not.toContain("correct horse battery");
  });

  it("sign-up cannot escalate privileges via extra body fields", async () => {
    const res = await signUp("mallory@example.test", { role: "admin", roles: ["admin"], emailVerified: true });
    expect(await getRoles(db, res.user.id)).toEqual(["contestant"]);
    expect(await db.select().from(userRole).where(eq(userRole.userId, res.user.id))).toHaveLength(0);
    const [row] = await db.select().from(user).where(eq(user.id, res.user.id));
    expect(row?.emailVerified).toBe(false);
  });

  it("rejects short passwords and duplicate emails", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "short@example.test", password: "short", name: "x" } }),
    ).rejects.toThrow();
    await signUp("dup@example.test");
    await expect(signUp("dup@example.test")).rejects.toThrow();
  });

  it("sign-in issues a session that resolves back to the user; wrong password fails", async () => {
    const { user: created } = await signUp("bob@example.test");
    const res = await auth.api.signInEmail({
      body: { email: "bob@example.test", password: "correct horse battery" },
      asResponse: true,
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(/better-auth\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const cookie = setCookie!.split(";")[0]!;
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(created.id);

    await expect(
      auth.api.signInEmail({ body: { email: "bob@example.test", password: "wrong password!!" } }),
    ).rejects.toThrow();
  });

  it("a forged session cookie resolves to no session", async () => {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: "better-auth.session_token=forged.value" }),
    });
    expect(session).toBeNull();
  });
});
