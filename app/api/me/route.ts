import { permissionsFor } from "@/lib/auth/roles";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({
      id: user.userId,
      name: user.name,
      email: user.email,
      roles: user.roles,
      permissions: [...permissionsFor(user.roles)],
    });
  } catch (err) {
    return errorResponse(err);
  }
}
