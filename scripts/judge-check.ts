// Verifies a provisioned Judge0 instance end to end through the production adapter.
//   JUDGE0_URL=https://judge.example.com JUDGE0_AUTH_TOKEN=... npm run judge:check
// Expects: accepted, wrong answer, compilation error, time limit, runtime error, memory limit, no network.
import { existsSync } from "node:fs";
import { Judge0Judge } from "@/lib/server/judge/judge0";
import type { JudgeRequest } from "@/lib/server/judge/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.JUDGE0_URL;
const token = process.env.JUDGE0_AUTH_TOKEN;
if (!url || !token) {
  console.error("Set JUDGE0_URL and JUDGE0_AUTH_TOKEN (e.g. in .env.local).");
  process.exit(2);
}
const judge = new Judge0Judge({
  baseUrl: url,
  authToken: token,
  cppLanguageId: Number(process.env.JUDGE0_CPP_LANGUAGE_ID ?? 54),
  maxStackKb: process.env.JUDGE0_MAX_STACK_KB ? Number(process.env.JUDGE0_MAX_STACK_KB) : undefined,
  maxMemoryKb: process.env.JUDGE0_MAX_MEMORY_KB ? Number(process.env.JUDGE0_MAX_MEMORY_KB) : undefined,
});

const AB = "#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<\"\\n\";}\n";
const cases: { name: string; source: string; expect: string }[] = [
  { name: "accepted", source: AB, expect: "accepted" },
  { name: "wrong answer", source: AB.replace("a+b", "a-b"), expect: "wrong_answer" },
  { name: "compilation error", source: "int main( {", expect: "compilation_error" },
  { name: "time limit", source: "int main(){volatile unsigned long long x=0;for(;;)x++;}", expect: "time_limit_exceeded" },
  { name: "runtime error", source: "#include <cstdlib>\nint main(){std::abort();}", expect: "runtime_error" },
  // Touches 400 MB under a 256 MB limit; the cgroup OOM kill surfaces as NZEC at the memory limit.
  { name: "memory limit", source: "#include <vector>\n#include <cstdio>\nint main(){std::vector<char> v(400u<<20);for(size_t i=0;i<v.size();i+=4096)v[i]=1;printf(\"%d\\n\",v[12345]);}\n", expect: "memory_limit_exceeded" },
  { name: "no network", source: "#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <cstdio>\nint main(){int s=socket(AF_INET,SOCK_STREAM,0);sockaddr_in a{};a.sin_family=AF_INET;a.sin_port=htons(80);inet_pton(AF_INET,\"1.1.1.1\",&a.sin_addr);if(connect(s,(sockaddr*)&a,sizeof a)==0){puts(\"NETWORK\");}else{long long x,y;scanf(\"%lld %lld\",&x,&y);printf(\"%lld\\n\",x+y);}}\n", expect: "accepted" },
];

async function main() {
  console.log(`ping ${url}: ${(await judge.ping(AbortSignal.timeout(10_000))) ? "ok" : "FAILED"}`);
  let failures = 0;
  for (const c of cases) {
    const req: JudgeRequest = { submissionId: c.name, language: "cpp17", source: c.source, timeLimitMs: 1000, memoryLimitMb: 256, tests: [{ ordinal: 1, input: "2 3\n", expectedOutput: "5\n" }] };
    try {
      const r = await judge.judge(req, { signal: AbortSignal.timeout(60_000) });
      const ok = r.verdict === c.expect;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(18)} → ${r.verdict} (${r.timeMs ?? "-"} ms, ${r.memoryKb ?? "-"} KB)`);
    } catch (err) {
      failures++;
      console.log(`FAIL  ${c.name.padEnd(18)} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

main();
