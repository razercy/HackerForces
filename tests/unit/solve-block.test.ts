import { describe, expect, it } from "vitest";
import { solveBlock, type ContestPhase } from "@/lib/contest-phase";

const contest = (phase: ContestPhase, isRegistered = true, needsAcknowledgement = false) => ({ phase, isRegistered, needsAcknowledgement });

describe("problem page Solve section", () => {
  it("tells a registered, acknowledged user that an upcoming contest has not started (not to register)", () => {
    expect(solveBlock(true, contest("upcoming"))).toBe("not_started");
  });

  it("asks unregistered users to register, and registered users to acknowledge, before the start", () => {
    expect(solveBlock(true, contest("upcoming", false))).toBe("register");
    expect(solveBlock(true, contest("upcoming", true, true))).toBe("acknowledge");
  });

  it("distinguishes signed-out, ended, unregistered and unacknowledged viewers", () => {
    expect(solveBlock(false, contest("running"))).toBe("sign_in");
    expect(solveBlock(false, contest("upcoming", false))).toBe("sign_in");
    expect(solveBlock(true, contest("ended"))).toBe("ended");
    expect(solveBlock(true, contest("ended", false))).toBe("ended");
    expect(solveBlock(true, contest("running", false))).toBe("register");
    expect(solveBlock(true, contest("running", true, true))).toBe("acknowledge");
  });

  it("treats a draft contest (visible to managers only) as not open", () => {
    expect(solveBlock(true, contest("draft"))).toBe("not_started");
  });

  it("opens the editor exactly when the page's canSubmit rule allows it", () => {
    const phases: ContestPhase[] = ["draft", "upcoming", "running", "ended"];
    for (const signedIn of [false, true])
      for (const phase of phases)
        for (const isRegistered of [false, true])
          for (const needsAcknowledgement of [false, true]) {
            const canSubmit = signedIn && isRegistered && !needsAcknowledgement && phase === "running";
            expect(solveBlock(signedIn, { phase, isRegistered, needsAcknowledgement }) === null).toBe(canSubmit);
          }
  });
});
