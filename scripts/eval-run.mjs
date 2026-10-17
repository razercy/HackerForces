// Runs the Python evaluation with the project venv (Windows or POSIX layout).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const candidates = ["ml/.venv/Scripts/python.exe", "ml/.venv/bin/python"];
const python = candidates.find((p) => existsSync(p));
if (!python) {
  console.error("Python venv not found. Create it with:\n  python -m venv ml/.venv && ml/.venv/<bin|Scripts>/python -m pip install -r ml/requirements.txt");
  process.exit(1);
}
const r = spawnSync(python, ["-m", "hackerforces_eval", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, PYTHONPATH: "ml", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
process.exit(r.status ?? 1);
