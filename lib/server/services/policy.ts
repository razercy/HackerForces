import "server-only";
import { hasPermission } from "@/lib/auth/roles";
import type { Principal } from "./roles";

// Object-level rules: a role grants the capability, ownership scopes it.
// Admins manage everything; problem setters manage what they created.

export function canManageProblem(actor: Principal, problem: { authorId: string }): boolean {
  if (!hasPermission(actor.roles, "problem:manage")) return false;
  return actor.roles.includes("admin") || problem.authorId === actor.userId;
}

export function canManageContest(actor: Principal, contest: { createdBy: string }): boolean {
  if (!hasPermission(actor.roles, "contest:manage")) return false;
  return actor.roles.includes("admin") || contest.createdBy === actor.userId;
}
