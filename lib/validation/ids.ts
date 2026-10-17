import { z } from "zod";

/** Route params are untrusted; check UUID shape before it reaches Postgres (which would 500). */
export const isUuid = (s: string) => z.uuid().safeParse(s).success;
