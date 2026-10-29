import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tokensMatch } from "@/lib/server/judge/checker";
import { Judge0Judge } from "@/lib/server/judge/judge0";
import { JudgeUnavailableError, type JudgeRequest } from "@/lib/server/judge/types";

// ---------------------------------------------------------------- fake Judge0 CE
// Implements the subset of the Judge0 API the adapter uses, so its contract
// (requests sent, responses understood) is tested without a real sandbox.

type Outcome = { status: number; stdout?: string; time?: string; memory?: number; compile_output?: string };
type Program = (source: string, stdin: string) => Outcome;

const TOKEN = "t".repeat(40);
const b64 = (s: string) => Buffer.from(s).toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

let server: Server;
let baseUrl: string;
let program: Program;
let pollsBeforeDone = 1;
let forcedStatus: number | null = null;
let forcedBody: string | null = null;
let caps = { stack: 128_000, memory: 512_000 };
const requests: { method: string; url: string; headers: IncomingMessage["headers"]; body: unknown }[] = [];
const store = new Map<string, { outcome: Outcome; polls: number }>();

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const send = (code: number, payload: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };
      if (req.headers["x-auth-token"] !== TOKEN) return send(401, { error: "Authentication failed" });
      if (forcedStatus) return send(forcedStatus, { error: "boom" });
      if (forcedBody) return send(200, forcedBody);
      const url = new URL(req.url!, "http://x");
      if (url.pathname === "/about") return send(200, { version: "1.13.1" });
      if (req.method === "POST" && url.pathname === "/submissions/batch") {
        // Enforce stock Judge0 CE 1.13 ceilings like the real server (HTTP 422 per offending field).
        const errors = (body.submissions as Record<string, number>[]).map((s) => ({
          ...((s.stack_limit ?? 0) > caps.stack ? { stack_limit: [`must be less than or equal to ${caps.stack}`] } : {}),
          ...((s.memory_limit ?? 0) > caps.memory ? { memory_limit: [`must be less than or equal to ${caps.memory}`] } : {}),
        }));
        if (errors.some((e) => Object.keys(e).length)) return send(422, errors);
        const out = (body.submissions as { source_code: string; stdin: string }[]).map((s) => {
          const token = `tok-${store.size}`;
          store.set(token, { outcome: program(unb64(s.source_code), unb64(s.stdin)), polls: 0 });
          return { token };
        });
        return send(201, out);
      }
      if (req.method === "GET" && url.pathname === "/submissions/batch") {
        const tokens = url.searchParams.get("tokens")!.split(",");
        return send(200, {
          submissions: tokens.map((t) => {
            const s = store.get(t)!;
            s.polls++;
            if (s.polls <= pollsBeforeDone) return { token: t, status: { id: 2, description: "Processing" } };
            const o = s.outcome;
            return { token: t, status: { id: o.status }, time: o.time ?? "0.012", memory: o.memory ?? 3200, stdout: o.stdout != null ? b64(o.stdout) : null, compile_output: o.compile_output ? b64(o.compile_output) : null };
          }),
        });
      }
      send(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  requests.length = 0;
  store.clear();
  pollsBeforeDone = 1;
  forcedStatus = null;
  forcedBody = null;
  caps = { stack: 128_000, memory: 512_000 };
  // Default program: echoes a+b for "a b" input.
  program = (_src, stdin) => {
    const [a, b] = stdin.trim().split(/\s+/).map(Number);
    return { status: 3, stdout: `${a! + b!}\n` };
  };
});

const judge = (extra: Partial<ConstructorParameters<typeof Judge0Judge>[0]> = {}) =>
  new Judge0Judge({ baseUrl, authToken: TOKEN, cppLanguageId: 54, pollIntervalMs: 5, ...extra });

const SECRET = "HIDDEN-SECRET-INPUT";
const req = (tests: { input: string; expectedOutput: string }[], extra: Partial<JudgeRequest> = {}): JudgeRequest => ({
  submissionId: "s1",
  language: "cpp17",
  source: "int main(){}",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  tests: tests.map((t, i) => ({ ordinal: i + 1, ...t })),
  ...extra,
});
const run = (r: JudgeRequest, j = judge()) => j.judge(r, { signal: AbortSignal.timeout(5_000) });

describe("output checker", () => {
  it("compares whitespace-separated tokens", () => {
    expect(tokensMatch("3\n", "3")).toBe(true);
    expect(tokensMatch("1  2\r\n3 \n\n", "1 2\n3")).toBe(true);
    expect(tokensMatch("1 2", "12")).toBe(false);
    expect(tokensMatch("1 2 3", "1 2")).toBe(false);
    expect(tokensMatch("", "")).toBe(true);
  });
});

describe("Judge0 adapter: requests", () => {
  it("sends authenticated, base64, network-disabled submissions with the problem's limits", async () => {
    await run(req([{ input: "1 2\n", expectedOutput: "3\n" }], { timeLimitMs: 2000, memoryLimitMb: 128 }));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.url).toContain("base64_encoded=true");
    expect(post.headers["x-auth-token"]).toBe(TOKEN);
    const s = (post.body as { submissions: Record<string, unknown>[] }).submissions[0]!;
    expect(s).toMatchObject({ language_id: 54, cpu_time_limit: 2, memory_limit: 128 * 1024, enable_network: false, compiler_options: "-std=c++17 -O2 -pipe" });
    expect(unb64(s.stdin as string)).toBe("1 2\n");
    expect(unb64(s.source_code as string)).toBe("int main(){}");
    // Expected outputs never leave the application: comparison happens here.
    expect(s).not.toHaveProperty("expected_output");
  });

  it("clamps stack and memory to the instance's ceilings (stock Judge0 defaults)", async () => {
    // A 1024 MB problem against a stock instance: would be a 422 without clamping.
    expect((await run(req([{ input: "1 2", expectedOutput: "3" }], { memoryLimitMb: 1024 }))).verdict).toBe("accepted");
    const s = (requests.find((r) => r.method === "POST")!.body as { submissions: Record<string, number>[] }).submissions[0]!;
    expect(s.stack_limit).toBe(128_000);
    expect(s.memory_limit).toBe(512_000);
  });

  it("uses raised ceilings when the instance is configured for them", async () => {
    caps = { stack: 262_144, memory: 1_048_576 };
    await run(req([{ input: "1 2", expectedOutput: "3" }], { memoryLimitMb: 256 }), judge({ maxStackKb: 262_144, maxMemoryKb: 1_048_576 }));
    const s = (requests.find((r) => r.method === "POST")!.body as { submissions: Record<string, number>[] }).submissions[0]!;
    expect(s).toMatchObject({ stack_limit: 256 * 1024, memory_limit: 256 * 1024 });
  });

  it("reports which parameters a misconfigured ceiling rejected, without echoing request data", async () => {
    // The adapter thinks the instance allows more stack than it does.
    const err = await run(req([{ input: SECRET, expectedOutput: "x" }]), judge({ maxStackKb: 262_144 })).catch((e: Error) => e);
    expect(err).toBeInstanceOf(JudgeUnavailableError);
    expect((err as Error).message).toBe("Judge0 rejected parameters (422): stack_limit");
    expect((err as Error).message).not.toContain(SECRET);
  });

  it("splits large test sets into batches", async () => {
    const tests = Array.from({ length: 25 }, (_, i) => ({ input: `${i} 1`, expectedOutput: `${i + 1}` }));
    const r = await run(req(tests), judge({ batchSize: 10 }));
    expect(r).toMatchObject({ verdict: "accepted", passedTests: 25, totalTests: 25 });
    expect(requests.filter((x) => x.method === "POST")).toHaveLength(3);
  });
});

describe("Judge0 adapter: verdicts", () => {
  it("accepts when every output matches, reporting max time and memory", async () => {
    program = (_s, stdin) => ({ status: 3, stdout: String(stdin.split(" ").map(Number).reduce((a, b) => a + b, 0)), time: stdin.startsWith("5") ? "0.250" : "0.010", memory: 4000 });
    const r = await run(req([{ input: "1 2", expectedOutput: "3" }, { input: "5 5", expectedOutput: "10" }]));
    expect(r).toEqual({ verdict: "accepted", timeMs: 250, memoryKb: 4000, passedTests: 2, totalTests: 2, failedTest: null, compileOutput: null });
  });

  it("reports the first failing test in ordinal order (wrong answer)", async () => {
    program = (_s, stdin) => ({ status: 3, stdout: stdin.startsWith("2") ? "999" : "ok" });
    const r = await run(req([{ input: "1", expectedOutput: "ok" }, { input: "2", expectedOutput: "ok" }, { input: "3", expectedOutput: "nope" }]));
    expect(r).toMatchObject({ verdict: "wrong_answer", failedTest: 2, passedTests: 1, totalTests: 3 });
  });

  it("maps time limit, runtime error and memory limit", async () => {
    program = () => ({ status: 5 });
    expect((await run(req([{ input: "1", expectedOutput: "x" }]))).verdict).toBe("time_limit_exceeded");
    program = () => ({ status: 11, memory: 1000 }); // NZEC
    expect((await run(req([{ input: "1", expectedOutput: "x" }]))).verdict).toBe("runtime_error");
    program = () => ({ status: 7, memory: 256 * 1024 }); // SIGSEGV at the memory limit
    expect((await run(req([{ input: "1", expectedOutput: "x" }]))).verdict).toBe("memory_limit_exceeded");
  });

  // Observed on a real Judge0 CE 1.13.1: the shell wrapper turns every crash into NZEC (status 11),
  // and a cgroup OOM kill reports memory exactly at the (clamped) limit.
  it("classifies real Judge0 NZEC results by memory usage", async () => {
    program = () => ({ status: 11, memory: 256 * 1024 }); // OOM kill, exit 137
    expect(await run(req([{ input: "1", expectedOutput: "x" }]))).toMatchObject({ verdict: "memory_limit_exceeded", memoryKb: 256 * 1024, failedTest: 1 });
    program = () => ({ status: 11, memory: 512_000 }); // 1024 MB problem clamped to the 512000 KB ceiling
    expect((await run(req([{ input: "1", expectedOutput: "x" }], { memoryLimitMb: 1024 }))).verdict).toBe("memory_limit_exceeded");
    program = () => ({ status: 11, memory: 129_280 }); // stack overflow (SIGSEGV, exit 139) well under the limit
    expect((await run(req([{ input: "1", expectedOutput: "x" }]))).verdict).toBe("runtime_error");
    program = () => ({ status: 3, stdout: "5", memory: 206_264 }); // 200 MB used legitimately
    expect((await run(req([{ input: "2 3", expectedOutput: "5" }]))).verdict).toBe("accepted");
  });

  it("treats unknown Judge0 statuses as infrastructure errors, not verdicts", async () => {
    program = () => ({ status: 42 });
    await expect(run(req([{ input: "1", expectedOutput: "x" }]))).rejects.toThrow("Judge0 unexpected status 42");
    program = () => ({ status: 14 });
    await expect(run(req([{ input: "1", expectedOutput: "x" }]))).rejects.toThrow("Judge0 internal status 14");
  });

  it("returns compiler diagnostics for a compilation error, without runtime stats", async () => {
    program = () => ({ status: 6, compile_output: "main.cpp:1:1: error: expected ';'" });
    const r = await run(req([{ input: "1", expectedOutput: "1" }]));
    expect(r).toMatchObject({ verdict: "compilation_error", timeMs: null, memoryKb: null, compileOutput: "main.cpp:1:1: error: expected ';'" });
  });

  it("keeps polling while submissions are queued or processing", async () => {
    pollsBeforeDone = 3;
    expect((await run(req([{ input: "1 2", expectedOutput: "3" }]))).verdict).toBe("accepted");
    expect(requests.filter((r) => r.method === "GET").length).toBeGreaterThanOrEqual(4);
  });

  it("does not accumulate abort listeners across many polls", async () => {
    pollsBeforeDone = 30;
    const signal = AbortSignal.timeout(10_000);
    const added: unknown[] = [];
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, fn: EventListener, opts?: AddEventListenerOptions) => (added.push(fn), add(type, fn, opts))) as typeof signal.addEventListener;
    signal.removeEventListener = ((type: string, fn: EventListener) => (added.splice(added.indexOf(fn), 1), remove(type, fn))) as typeof signal.removeEventListener;
    // Count only the adapter's own listeners: fetch (undici) manages its own, so it gets no signal here.
    const noSignalFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: undefined });
    expect((await judge({ fetch: noSignalFetch }).judge(req([{ input: "1 2", expectedOutput: "3" }]), { signal })).verdict).toBe("accepted");
    expect(added).toHaveLength(0);
  });
});

describe("Judge0 adapter: failures become retryable infrastructure errors", () => {
  const one = () => req([{ input: SECRET, expectedOutput: "x" }]);

  it("bad credentials", async () => {
    await expect(run(one(), judge({ authToken: "wrong".repeat(10) }))).rejects.toBeInstanceOf(JudgeUnavailableError);
  });

  it("server errors, malformed responses and Judge0 internal errors", async () => {
    forcedStatus = 503;
    await expect(run(one())).rejects.toBeInstanceOf(JudgeUnavailableError);
    forcedStatus = null;
    forcedBody = "not json";
    await expect(run(one())).rejects.toBeInstanceOf(JudgeUnavailableError);
    forcedBody = JSON.stringify({ unexpected: true });
    await expect(run(one())).rejects.toBeInstanceOf(JudgeUnavailableError);
    forcedBody = null;
    program = () => ({ status: 13 });
    await expect(run(one())).rejects.toBeInstanceOf(JudgeUnavailableError);
  });

  it("an unreachable host, and running out of time", async () => {
    await expect(run(one(), judge({ baseUrl: "http://127.0.0.1:1" }))).rejects.toBeInstanceOf(JudgeUnavailableError);
    pollsBeforeDone = 1_000_000;
    await expect(judge().judge(one(), { signal: AbortSignal.timeout(100) })).rejects.toThrow();
  });

  it("never puts hidden test data in error messages", async () => {
    forcedStatus = 500;
    const err = await run(one()).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain(SECRET);
    expect(JSON.stringify(err)).not.toContain(SECRET);
  });

  it("ping reports reachability and credentials without throwing", async () => {
    expect(await judge().ping(AbortSignal.timeout(1_000))).toBe(true);
    expect(await judge({ authToken: "x".repeat(40) }).ping(AbortSignal.timeout(1_000))).toBe(false);
  });
});
