// Role and permission model. Pure and client-safe: the UI may use it to decide
// what to *show*, but every sensitive operation re-checks on the server.

/** Elevated roles stored in `user_role`. Every signed-in user is implicitly a contestant. */
export const ELEVATED_ROLES = ["admin", "problem_setter", "reviewer"] as const;
export type ElevatedRole = (typeof ELEVATED_ROLES)[number];
export type Role = "contestant" | ElevatedRole;

export const PERMISSIONS = [
  "contest:participate",
  "submission:read_own",
  "contest:manage",
  "problem:manage",
  "problem:read_hidden", // hidden tests, reference solutions
  "integrity:review", // telemetry, snapshots, assessments, review cases
  "integrity:confirm", // second-person confirmation of violation decisions (admins)
  "role:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CONTESTANT: readonly Permission[] = ["contest:participate", "submission:read_own"];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  contestant: CONTESTANT,
  problem_setter: [...CONTESTANT, "contest:manage", "problem:manage", "problem:read_hidden"],
  // Reviewers see private telemetry but cannot edit contests or problems.
  reviewer: [...CONTESTANT, "integrity:review"],
  admin: [...PERMISSIONS],
};

export function isElevatedRole(value: string): value is ElevatedRole {
  return (ELEVATED_ROLES as readonly string[]).includes(value);
}

/** Effective roles for a signed-in user, given their stored elevated roles. */
export function effectiveRoles(stored: readonly ElevatedRole[]): Role[] {
  return ["contestant", ...new Set(stored)];
}

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}
