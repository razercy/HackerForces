import { getAuth } from "@/lib/server/auth";

export const runtime = "nodejs";

const handle = (request: Request) => getAuth().handler(request);

export { handle as GET, handle as POST };
