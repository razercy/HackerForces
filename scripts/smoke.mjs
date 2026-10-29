// Post-deployment smoke test. Read-only: it never signs in or writes data.
//   node scripts/smoke.mjs https://your-app.vercel.app
//   npm run smoke -- http://localhost:3000
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const https = base.startsWith("https://");
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", ...init });

const health = await get("/api/health");
check("health endpoint reports ok (database reachable)", health.status === 200 && (await health.json()).status === "ok", `HTTP ${health.status}`);

const home = await get("/");
const csp = home.headers.get("content-security-policy") ?? "";
check("home page renders", home.status === 200, `HTTP ${home.status}`);
check("CSP: nonce-based scripts", /script-src[^;]*'nonce-[^']+'[^;]*'strict-dynamic'/.test(csp));
check("CSP: no unsafe-eval in production", !csp.includes("unsafe-eval"));
check("CSP: framing denied", csp.includes("frame-ancestors 'none'"));
const again = (await get("/")).headers.get("content-security-policy") ?? "";
check("CSP nonce is fresh per request", again !== csp && again.includes("nonce-"));
check("X-Content-Type-Options: nosniff", home.headers.get("x-content-type-options") === "nosniff");
check("Referrer-Policy set", !!home.headers.get("referrer-policy"));
check("Permissions-Policy denies clipboard-read", (home.headers.get("permissions-policy") ?? "").includes("clipboard-read=()"));
check("no X-Powered-By header", !home.headers.get("x-powered-by"));
if (https) check("HSTS enabled", (home.headers.get("strict-transport-security") ?? "").includes("max-age="));

check("public contests page", (await get("/contests")).status === 200);
check("API requires authentication", (await get("/api/me")).status === 401);
const review = await get("/review");
check("review area redirects anonymous users to sign-in", review.status >= 300 && review.status < 400 && (review.headers.get("location") ?? "").includes("/sign-in"), `HTTP ${review.status}`);
const csrf = await get("/api/telemetry/batches", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
check("cross-origin POST rejected", csrf.status === 403, `HTTP ${csrf.status}`);
check("cron endpoints require the secret", (await get("/api/cron/judge")).status === 401);
const api = await get("/api/me");
check("API responses are not cacheable", (api.headers.get("cache-control") ?? "").includes("no-store"));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
