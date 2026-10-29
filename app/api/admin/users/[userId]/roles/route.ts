import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/server/authz";
import { getDb } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { assertSameOrigin } from "@/lib/server/origin";
import { getRoles, grantRole, revokeRole } from "@/lib/server/services/roles";
import { roleChangeSchema } from "@/lib/validation/roles";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/admin/users/[userId]/roles">;

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("role:manage");
    const { userId } = await ctx.params;
    return Response.json({ roles: await getRoles(getDb(), userId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const actor = await requirePermission("role:manage");
    const { userId } = await ctx.params;
    const { role } = roleChangeSchema.parse(await req.json());
    await grantRole(getDb(), actor, userId, role);
    return Response.json({ roles: await getRoles(getDb(), userId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const actor = await requirePermission("role:manage");
    const { userId } = await ctx.params;
    const { role } = roleChangeSchema.parse(await req.json());
    await revokeRole(getDb(), actor, userId, role);
    return Response.json({ roles: await getRoles(getDb(), userId) });
  } catch (err) {
    return errorResponse(err);
  }
}
