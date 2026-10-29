# Judging: isolation, deployment and threat model

Contestant code is **untrusted**. HackerForces never runs it in the web app,
in Vercel functions, or on any machine that holds application secrets. The app
talks to a judge only through the `JudgeProvider` interface
(`lib/server/judge/types.ts`). Two implementations exist:

| Provider | Where it runs | Executes code? | Use |
| --- | --- | --- | --- |
| `mock` (default) | in the app | **No.** The verdict is derived from the source text | Local development, tests, demos |
| `judge0` | a dedicated VM running Judge0 CE 1.13.1 ([infra/judge](../infra/judge)) | Yes, inside isolate sandboxes | Real contests |

Switching is configuration only: `JUDGE_PROVIDER=judge0`, `JUDGE0_URL=https://…`,
`JUDGE0_AUTH_TOKEN=…`. The environment validation refuses a non-HTTPS judge URL
except on localhost.

## How a submission is judged with Judge0

1. The judge queue worker (`lib/server/judge/worker.ts`) claims a job under a lease.
2. `Judge0Judge` creates **one Judge0 submission per hidden test**, in batches of 20.
   Each carries base64 source and stdin plus the problem's limits:
   - CPU time = the problem's limit;
   - wall time = 3 × CPU + 1 s (at most 20 s);
   - memory = the problem's limit;
   - at most 4 processes (Judge0 runs the binary through a shell wrapper);
   - 1 MB output files;
   - `enable_network: false`.
3. It polls `GET /submissions/batch` inside the job's time budget. Expected outputs
   never leave the application: the adapter compares stdout itself with a
   whitespace-token checker (`lib/server/judge/checker.ts`).
4. The first failing test, in ordinal order, decides the verdict, like a sequential
   judge. Judge0 statuses map as follows:
   - 3 → accepted, or wrong answer after comparison;
   - 5 → TLE;
   - 6 → CE;
   - 7–12 → RE, or MLE if memory reached 95% of the limit. On Judge0 CE 1.13.1 every
     crash arrives as 11 (NZEC), because the binary runs under a shell wrapper: an
     OOM kill is exit 137 with memory exactly at the limit, a segfault is exit 139;
   - 13/14, HTTP errors, bad JSON or timeouts → `JudgeUnavailableError`, which the
     queue retries with backoff and finally dead-letters as "judge error".
5. Errors and logs never include hidden test data. A test asserts this.

The adapter's contract is tested against a fake Judge0 server
(`tests/integration/judge0.test.ts`). `npm run judge:check` runs the real cases
(accepted, wrong answer, compile error, time limit, runtime error, memory limit,
network attempt)
against a provisioned instance.

## Threat model

**Assets:** hidden tests and reference solutions; the judge auth token; the
application database and its secrets; the availability of judging during a
contest.

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Sandbox escape from contestant code | Judge0 isolate sandboxes (namespaces, cgroups, seccomp-like limits) on a **dedicated VM** with no app secrets or data. Workers sit on a Docker network marked `internal` (no route out). Judge0 pinned to 1.13.1, which fixes the 2024 sandbox-escape and SSRF advisories (CVE-2024-28185, CVE-2024-28189, CVE-2024-29021) | Judge0 containers must run `privileged`. An escape gives root on the judge VM, which could expose hidden tests in flight and the Judge0 token. **Docker is not a security boundary on its own.** That is why the VM holds nothing else |
| Network abuse from submissions | `ENABLE_NETWORK=false`, `ALLOW_ENABLE_NETWORK=false`, internal Docker network for workers. `judge:check` verifies that outbound connects fail | Misconfiguration. Run `judge:check` after every change |
| Resource exhaustion (fork bombs, huge output, endless loops) | Per-run CPU, wall, memory, process and file-size limits with server-side caps in `judge0.conf`; queue size cap; app-side throttles (1 submission / 5 s, 3 pending per user) | A burst of heavy problems can queue up. Size workers for the expected peak |
| Stolen or guessed judge token | 256-bit random token, HTTPS only, sent only server-to-server. Caddy exposes only `/submissions/batch` and `/about` | Vercel egress IPs are not fixed (without paid Secure Compute), so an IP allowlist is not available by default. Rotate the token after any suspected leak |
| Hidden test leakage via the app | Tests are sent only to the judge. Contestants see only the verdict, counts and the failing ordinal. Compile output is truncated and comes from the compiler, not from tests | A program can print stdin, but the app never shows a contestant their program's output on hidden tests |
| Judge outage during a contest | Durable queue with leases, retries and dead-lettering; status polls and a cron restart stalled work; submissions are stored before judging | Verdicts are delayed, never lost. Admins see queue health on `/admin/ops` |
| Malicious Judge0 responses (if the judge VM is compromised) | Responses are schema-validated; unknown statuses are infrastructure errors | A compromised judge can return wrong verdicts. Treat a compromise as an incident and re-judge |

## Provisioning checklist (manual, done by an operator)

1. **Create a VM** used only for judging (Ubuntu 22.04 LTS, 2+ vCPU, 4 GB+). Give it no
   cloud credentials and no access to the app database.
2. **Enable cgroup v1**, which Judge0 1.13 requires. On Ubuntu 22.04+, add
   `systemd.unified_cgroup_hierarchy=0` to `GRUB_CMDLINE_LINUX` in `/etc/default/grub`,
   run `update-grub`, and reboot. Check that `/sys/fs/cgroup/memory` exists. Follow
   Judge0's own deployment notes for the exact current steps.
3. **Install Docker Engine**, then run `infra/judge/firewall.sh` with `ADMIN_IP` set.
4. **Set up Judge0.** Point a DNS name at the VM, then
   `cp judge0.conf.example judge0.conf`, fill in the secrets with `openssl rand -hex 32`,
   and run `JUDGE_DOMAIN=judge.example.com docker compose up -d`.
5. **Match the limit ceilings.** Judge0 rejects any submission whose limits exceed
   `MAX_STACK_LIMIT` or `MAX_MEMORY_LIMIT` in `judge0.conf` (HTTP 422, which the
   app reports as "Judge0 rejected parameters (422): stack_limit"). The adapter
   clamps requests to `JUDGE0_MAX_STACK_KB` and `JUDGE0_MAX_MEMORY_KB`, which default
   to stock Judge0 (128000 and 512000 KB). If you use this repo's
   `judge0.conf.example`, set them to 262144 and 1048576 to match. Problems whose
   memory limit is above the ceiling run with the ceiling.
6. **Check the language id.** Confirm the C++ language id with `GET /languages`
   (54 = "C++ (GCC 9.2.0)" on 1.13.1). Set `JUDGE0_CPP_LANGUAGE_ID` if it differs.
7. **Verify.** From your machine, run `npm run judge:check` with `JUDGE0_URL` and
   `JUDGE0_AUTH_TOKEN` set. All seven cases must pass.
8. **Switch the app.** In Vercel, set `JUDGE_PROVIDER=judge0`, `JUDGE0_URL`,
   `JUDGE0_AUTH_TOKEN` (Production and Preview separately), then redeploy.
9. **Keep it current.** Watch Judge0's security advisories, apply OS updates, and
   rotate `AUTHN_TOKEN` periodically.

## Not done yet

- No re-judge tool for problems whose tests change after submissions exist.
- No distribution of work across several judge VMs.
- One judgement must finish within `JUDGE_TIMEOUT_MS` (45 s), or it is retried from
  scratch. Each failing test can take up to the wall limit (3 × CPU + 1 s), so a
  problem with many tests whose solutions time out can exceed it on a small VM.
  Size the Judge0 workers for it, or stop at the first failing test.
- Output-limit kills (SIGXFSZ, exit 153) are reported as runtime errors.
