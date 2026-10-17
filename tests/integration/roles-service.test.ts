import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { auditLog, user, userRole } from "@/lib/server/db/schema";
import { AppError } from "@/lib/server/errors";
import { SYSTEM, getRoles, grantRole, revokeRole, type Principal } from "@/lib/server/services/roles";
import { createTestDb, insertUser } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const asPrincipal = async (userId: string): Promise<Principal> => ({ userId, roles: await getRoles(db, userId) });

describe("role service", () => {
  it("SYSTEM can bootstrap an admin, and the grant is audited with a null actor", async () => {
    const u = await insertUser(db);
    await grantRole(db, SYSTEM, u.id, "admin");
    expect(await getRoles(db, u.id)).toEqual(["contestant", "admin"]);

    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, u.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: null, action: "role.grant", targetType: "user", metadata: { role: "admin" } });
  });

  it("an admin can grant roles; re-granting is idempotent and not re-audited", async () => {
    const admin = await insertUser(db);
    await grantRole(db, SYSTEM, admin.id, "admin");
    const target = await insertUser(db);

    const actor = await asPrincipal(admin.id);
    await grantRole(db, actor, target.id, "reviewer");
    await grantRole(db, actor, target.id, "reviewer");

    expect(await getRoles(db, target.id)).toEqual(["contestant", "reviewer"]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, target.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(admin.id);
  });

  it("non-admins cannot grant roles, including to themselves", async () => {
    const reviewer = await insertUser(db);
    await grantRole(db, SYSTEM, reviewer.id, "reviewer");
    const actor = await asPrincipal(reviewer.id);

    await expect(grantRole(db, actor, reviewer.id, "admin")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    const contestant = await insertUser(db);
    await expect(grantRole(db, await asPrincipal(contestant.id), contestant.id, "reviewer")).rejects.toBeInstanceOf(AppError);
    expect(await getRoles(db, reviewer.id)).toEqual(["contestant", "reviewer"]);
  });

  it("granting to a missing user is a 404, not a FK crash", async () => {
    await expect(grantRole(db, SYSTEM, "does-not-exist", "reviewer")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("revocation is audited and the last admin cannot be removed", async () => {
    // Isolated database so the admin count is known.
    const isolated = await createTestDb();
    try {
      const a = await insertUser(isolated.db);
      const b = await insertUser(isolated.db);
      await grantRole(isolated.db, SYSTEM, a.id, "admin");
      await grantRole(isolated.db, SYSTEM, b.id, "admin");
      const actorA = { userId: a.id, roles: await getRoles(isolated.db, a.id) };

      await revokeRole(isolated.db, actorA, b.id, "admin");
      expect(await getRoles(isolated.db, b.id)).toEqual(["contestant"]);

      await expect(revokeRole(isolated.db, actorA, a.id, "admin")).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await getRoles(isolated.db, a.id)).toEqual(["contestant", "admin"]);

      const actions = (await isolated.db.select({ action: auditLog.action }).from(auditLog)).map((r) => r.action);
      expect(actions.sort()).toEqual(["role.grant", "role.grant", "role.revoke"]);
    } finally {
      await isolated.close();
    }
  });
});

// Drizzle wraps driver errors; the trigger's message is on `cause`.
const rejectedByGuard = (err: unknown) =>
  err instanceof Error && /append-only/.test(String((err.cause as Error | undefined)?.message));

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const u = await insertUser(db);
    await grantRole(db, SYSTEM, u.id, "reviewer");

    await expect(db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.targetId, u.id))).rejects.toSatisfy(
      rejectedByGuard,
    );
    await expect(db.delete(auditLog).where(eq(auditLog.targetId, u.id))).rejects.toSatisfy(rejectedByGuard);
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, u.id))).toHaveLength(1);
  });

  it("still allows deleting a user account (actor is nulled, history kept)", async () => {
    const admin = await insertUser(db);
    await grantRole(db, SYSTEM, admin.id, "admin");
    const target = await insertUser(db);
    await grantRole(db, await asPrincipal(admin.id), target.id, "reviewer");

    await db.delete(user).where(eq(user.id, admin.id));

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.targetId, target.id));
    expect(entry?.actorId).toBeNull();
    expect(entry?.action).toBe("role.grant");
    expect(await db.select().from(userRole).where(eq(userRole.userId, admin.id))).toHaveLength(0);
  });
});
