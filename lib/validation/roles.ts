import { z } from "zod";
import { ELEVATED_ROLES } from "@/lib/auth/roles";

export const roleChangeSchema = z.object({ role: z.enum(ELEVATED_ROLES) }).strict();
export type RoleChangeInput = z.infer<typeof roleChangeSchema>;
