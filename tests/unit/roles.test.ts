import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, effectiveRoles, hasPermission, isElevatedRole, permissionsFor, PERMISSIONS } from "@/lib/auth/roles";

describe("role model", () => {
  it("every signed-in user is a contestant", () => {
    expect(effectiveRoles([])).toEqual(["contestant"]);
    expect(effectiveRoles(["reviewer", "reviewer"])).toEqual(["contestant", "reviewer"]);
  });

  it("contestants cannot see private integrity data or hidden tests", () => {
    const roles = effectiveRoles([]);
    expect(hasPermission(roles, "contest:participate")).toBe(true);
    expect(hasPermission(roles, "integrity:review")).toBe(false);
    expect(hasPermission(roles, "problem:read_hidden")).toBe(false);
    expect(hasPermission(roles, "role:manage")).toBe(false);
  });

  it("reviewers review but cannot manage contests, problems or roles", () => {
    const roles = effectiveRoles(["reviewer"]);
    expect(hasPermission(roles, "integrity:review")).toBe(true);
    expect(hasPermission(roles, "contest:manage")).toBe(false);
    expect(hasPermission(roles, "problem:read_hidden")).toBe(false);
    expect(hasPermission(roles, "role:manage")).toBe(false);
  });

  it("problem setters manage problems but cannot review integrity data", () => {
    const roles = effectiveRoles(["problem_setter"]);
    expect(hasPermission(roles, "problem:manage")).toBe(true);
    expect(hasPermission(roles, "problem:read_hidden")).toBe(true);
    expect(hasPermission(roles, "integrity:review")).toBe(false);
  });

  it("admins hold every permission", () => {
    expect([...permissionsFor(["admin"])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("permissions combine across roles", () => {
    const perms = permissionsFor(effectiveRoles(["reviewer", "problem_setter"]));
    expect(perms.has("integrity:review")).toBe(true);
    expect(perms.has("problem:manage")).toBe(true);
    expect(perms.has("role:manage")).toBe(false);
  });

  it("only known elevated roles are accepted", () => {
    expect(isElevatedRole("admin")).toBe(true);
    expect(isElevatedRole("contestant")).toBe(false);
    expect(isElevatedRole("superuser")).toBe(false);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(["admin", "contestant", "problem_setter", "reviewer"]);
  });
});
