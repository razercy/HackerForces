import "server-only";
import { getDb } from "@/lib/server/db";
import { serverEnv } from "@/lib/server/env";
import { createAuth, type Auth } from "./create-auth";

let auth: Auth | undefined;

export function getAuth(): Auth {
  if (auth) return auth;
  const env = serverEnv();
  auth = createAuth({ db: getDb(), secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL });
  return auth;
}
