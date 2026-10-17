// SYNTHETIC DATA ONLY. Labelled behaviour scenarios for evaluating the
// integrity pipeline. Label 1 = *simulated* misconduct, 0 = legitimate.
// These describe plausible editor behaviour; they are not observations of
// real contestants, and results on them are not real-world accuracy.

import { TEMPLATES, solutionOf, type Problem, type TemplateName } from "./corpus";
import { type TimelineBuilder, type TypingStyle } from "./builder";

export type Profile = {
  style: TypingStyle;
  /** Templates this contestant registered before the contest. */
  registered: TemplateName[];
  /** Registered a personal template equal to (most of) a full solution, per problem id. */
  libraryFor: Set<string>;
};

export type ScenarioContext = { b: TimelineBuilder; p: Problem; profile: Profile; rand: () => number };
export type ScenarioResult = {
  /** Earlier attempts before the final submission (relative order only). */
  priorAttempts: ("sample_run" | "wrong_answer" | "compilation_error")[];
  /** Personal templates registered before the contest (sources). */
  personalTemplates: { name: string; source: string }[];
};

export type Scenario = {
  id: string;
  label: 0 | 1;
  description: string;
  /** Whether it can be used for this contestant/problem. */
  eligible?: (p: Problem, profile: Profile) => boolean;
  build: (ctx: ScenarioContext) => ScenarioResult;
};

const pick = <T,>(rand: () => number, xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);
const registeredTemplates = (profile: Profile) => profile.registered.map((t) => ({ name: t, source: TEMPLATES[t] }));
const none = (): ScenarioResult => ({ priorAttempts: [], personalTemplates: [] });

/** Types code line by line with occasional revisions and heartbeats. */
export function typeCode(b: TimelineBuilder, code: string, style: Partial<TypingStyle>, rand: () => number) {
  let sinceBeat = 0;
  for (const line of code.split(/(?<=\n)/)) {
    const before = b.now.getTime();
    b.type(line, style);
    if (rand() < 0.06 && line.length > 6) {
      const k = 2 + Math.floor(rand() * Math.min(10, line.length - 2));
      b.wait(400 + rand() * 1500).backspace(k).type(line.slice(line.length - k), style);
    }
    sinceBeat += b.now.getTime() - before;
    if (sinceBeat > 30_000) {
      b.heartbeat();
      sinceBeat = 0;
    }
  }
}

/** Splits a solution into (registered-template part, rest) for this contestant. */
function templateSplit(p: Problem, profile: Profile) {
  const used = p.uses.filter((t) => profile.registered.includes(t));
  const rest = p.uses.filter((t) => !profile.registered.includes(t));
  return { used, restCode: rest.map((t) => TEMPLATES[t]).join("\n") + (rest.length ? "\n" : "") + p.body };
}

export const SCENARIOS: Scenario[] = [
  // ------------------------------------------------------------ legitimate
  {
    id: "L_typed",
    label: 0,
    description: "Ordinary typing of the whole solution with typos and small revisions.",
    build: ({ b, p, profile, rand }) => {
      typeCode(b, solutionOf(p), profile.style, rand);
      return { priorAttempts: rand() < 0.3 ? ["sample_run"] : [], personalTemplates: registeredTemplates(profile) };
    },
  },
  {
    id: "L_templates",
    label: 0,
    description: "Pastes registered templates (I/O, data structures), types the rest.",
    eligible: (p, profile) => p.uses.some((t) => profile.registered.includes(t)),
    build: ({ b, p, profile, rand }) => {
      const { used, restCode } = templateSplit(p, profile);
      for (const t of used) b.paste(TEMPLATES[t] + "\n").wait(1_000 + rand() * 4_000);
      typeCode(b, restCode, profile.style, rand);
      return { priorAttempts: rand() < 0.3 ? ["sample_run"] : [], personalTemplates: registeredTemplates(profile) };
    },
  },
  {
    id: "L_library",
    label: 0,
    description: "Pastes a full routine from the contestant's own registered library, then adapts it by typing.",
    eligible: (p, profile) => profile.libraryFor.has(p.id),
    build: ({ b, p, profile, rand }) => {
      const sol = solutionOf(p);
      const cut = sol.lastIndexOf("\n", sol.length - 2);
      const libraryVersion = sol.slice(0, cut + 1) + "    // TODO adapt output\n}\n";
      b.paste(libraryVersion).wait(5_000 + rand() * 20_000).backspace(libraryVersion.length - cut - 1);
      typeCode(b, sol.slice(cut + 1), profile.style, rand);
      return { priorAttempts: [], personalTemplates: [...registeredTemplates(profile), { name: `library-${p.id}`, source: libraryVersion }] };
    },
  },
  {
    id: "L_debug",
    label: 0,
    description: "Types the solution, runs examples, gets a wrong answer, debugs and resubmits.",
    build: ({ b, p, profile, rand }) => {
      const sol = solutionOf(p);
      typeCode(b, sol, profile.style, rand);
      b.run().wait(20_000 + rand() * 60_000);
      const tail = Math.min(sol.length - 1, 30 + Math.floor(rand() * 80));
      b.backspace(tail).wait(10_000);
      typeCode(b, sol.slice(sol.length - tail), profile.style, rand);
      b.run();
      return { priorAttempts: ["sample_run", "wrong_answer", ...(rand() < 0.4 ? (["compilation_error"] as const) : []), "sample_run"], personalTemplates: registeredTemplates(profile) };
    },
  },
  {
    id: "L_fast",
    label: 0,
    description: "A fast, accurate expert: quick, fairly regular typing, few errors, short time.",
    build: ({ b, p, rand }) => {
      typeCode(b, solutionOf(p), { meanMs: between(rand, 55, 85), jitter: between(rand, 0.3, 0.45), typoRate: 0.008, pauseRate: 0.008 }, rand);
      return none();
    },
  },
  {
    id: "L_autocomplete",
    label: 0,
    description: "Relies on editor auto-completion for long identifiers.",
    build: ({ b, p, profile, rand }) => {
      const sol = solutionOf(p);
      let last = 0;
      for (const m of sol.matchAll(/[A-Za-z_]\w{5,}/g)) {
        typeCode(b, sol.slice(last, m.index! + 2), profile.style, rand);
        b.complete(m[0].slice(2));
        last = m.index! + m[0].length;
      }
      typeCode(b, sol.slice(last), profile.style, rand);
      return none();
    },
  },
  {
    id: "L_reading",
    label: 0,
    description: "Leaves the editor often (reading the statement, permitted tools such as CP Helper), but types everything.",
    build: ({ b, p, profile, rand }) => {
      const lines = solutionOf(p).split(/(?<=\n)/);
      lines.forEach((line, i) => {
        if (i % 4 === 0) {
          if (rand() < 0.5) b.blur().wait(5_000 + rand() * 30_000).focus();
          else b.hidden(10_000 + rand() * 60_000);
        }
        typeCode(b, line, profile.style, rand);
      });
      return none();
    },
  },
  {
    id: "L_snippets",
    label: 0,
    description: "Pastes a couple of its own small unregistered snippets, types the rest.",
    eligible: (p) => p.uses.length > 1,
    build: ({ b, p, profile, rand }) => {
      for (const t of p.uses.filter((x) => x !== "fastio")) b.paste(TEMPLATES[t] + "\n").wait(2_000);
      typeCode(b, (p.uses.includes("fastio") ? TEMPLATES.fastio + "\n" : "") + p.body, profile.style, rand);
      return none();
    },
  },
  {
    id: "L_offline_draft",
    label: 0,
    description: "HARD NEGATIVE: drafted offline in a local IDE and pasted whole, without registering it. Legitimate but indistinguishable from M_paste_all in editor telemetry.",
    build: ({ b, p, profile, rand }) => {
      b.hidden(60_000 + rand() * 600_000).paste(solutionOf(p)).wait(5_000);
      typeCode(b, "// checked locally\n", profile.style, rand);
      return none();
    },
  },
  // ------------------------------------------------------------ simulated misconduct
  {
    id: "M_paste_all",
    label: 1,
    description: "Leaves the editor, then pastes a complete solution obtained elsewhere.",
    build: ({ b, p, profile, rand }) => {
      typeCode(b, "#include <bits/stdc++.h>\n", profile.style, rand);
      b.blur().wait(20_000 + rand() * 120_000).focus().paste(solutionOf(p).replace("#include <bits/stdc++.h>\n", ""));
      return none();
    },
  },
  {
    id: "M_partial",
    label: 1,
    description: "Types boilerplate and the start of main, pastes the core algorithm.",
    build: ({ b, p, profile, rand }) => {
      const sol = solutionOf(p);
      const split = Math.floor(sol.length * between(rand, 0.25, 0.45));
      typeCode(b, sol.slice(0, split), profile.style, rand);
      b.hidden(15_000 + rand() * 60_000).paste(sol.slice(split));
      return none();
    },
  },
  {
    id: "M_robotic",
    label: 1,
    description: "Copied code retyped by an auto-typer at a near-constant rhythm.",
    build: ({ b, p, rand }) => {
      b.typeRobotically(solutionOf(p), Math.round(between(rand, 45, 95)), Math.round(between(rand, 1, 6)));
      return none();
    },
  },
  {
    id: "M_inject",
    label: 1,
    description: "Code inserted by a script without any user-input annotation.",
    build: ({ b, p, rand }) => {
      const sol = solutionOf(p);
      const chunks = 1 + Math.floor(rand() * 3);
      const size = Math.ceil(sol.length / chunks);
      for (let i = 0; i < sol.length; i += size) b.inject(sol.slice(i, i + size)).wait(500 + rand() * 3_000);
      return none();
    },
  },
  {
    id: "M_paste_edit",
    label: 1,
    description: "Pastes a complete solution, then disguises it with small typed edits.",
    build: ({ b, p, profile, rand }) => {
      b.paste(solutionOf(p));
      for (let i = 0; i < 4 + Math.floor(rand() * 6); i++) {
        b.wait(3_000 + rand() * 10_000).backspace(3 + Math.floor(rand() * 15));
        typeCode(b, pick(rand, ["  // note\n", "}\n", " ", "  int tmp = 0;\n"]), profile.style, rand);
      }
      return none();
    },
  },
  {
    id: "M_humanlike",
    label: 1,
    description: "ADVERSARIAL: copied code retyped by hand with a natural rhythm. Expected to evade editor telemetry by design.",
    build: ({ b, p, profile, rand }) => {
      typeCode(b, solutionOf(p), profile.style, rand);
      return none();
    },
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));
