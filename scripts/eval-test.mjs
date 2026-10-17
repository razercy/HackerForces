// Runs the Python evaluation unit tests with the project venv.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const python = ["ml/.venv/Scripts/python.exe", "ml/.venv/bin/python"].find((p) => existsSync(p));
if (!python) {
  console.error("Python venv not found; see docs/evaluation-setup in README.");
  process.exit(1);
}
const r = spawnSync(python, ["-m", "unittest", "discover", "-s", "ml/tests", "-t", "ml", "-v"], {
  stdio: "inherit",
  env: { ...process.env, PYTHONPATH: "ml", PYTHONUTF8: "1" },
});
process.exit(r.status ?? 1);
