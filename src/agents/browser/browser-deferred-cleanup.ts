import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";

export type DeferredCleanupResult = {
  status: "PASS" | "FAIL";
  note: string;
};

export type DeferredCleanup = {
  label: string;

  /*
   * The resource profile owns the actual cleanup logic.
   * The generic executor only schedules and records it.
   */
  run: () => Promise<DeferredCleanupResult>;

  /*
   * Evidence metadata remains profile-owned so this
   * executor is not coupled to jobs or another resource.
   */
  evidenceAction:
    BrowserDeterministicEvidence["action"];

  expected?: string;
  notePrefix?: string;
};

export type DeferredCleanupExecutionResult = {
  ok: boolean;
  notes: string[];
  deterministicEvidence:
    BrowserDeterministicEvidence[];
};

export async function executeDeferredCleanups(
  cleanups: DeferredCleanup[]
): Promise<DeferredCleanupExecutionResult> {
  const notes: string[] = [];

  const deterministicEvidence:
    BrowserDeterministicEvidence[] = [];

  let ok = true;

  for (const cleanup of cleanups) {
    let result: DeferredCleanupResult;

    try {
      result = await cleanup.run();
    } catch (error: unknown) {
      result = {
        status: "FAIL",
        note:
          `Deferred cleanup threw for ` +
          `${cleanup.label}: ` +
          `${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
      };
    }

    const notePrefix =
      cleanup.notePrefix ??
      "Deferred cleanup";

    const note =
      `${notePrefix}: ` +
      `${result.status}: ${result.note}`;

    console.log(` ${note}`);
    notes.push(note);

    deterministicEvidence.push({
      stepIndex: 0,
      action: cleanup.evidenceAction,
      expected:
        cleanup.expected ??
        `Cleanup succeeds for ${cleanup.label}`,
      passed:
        result.status === "PASS",
      note,
    });

    if (result.status !== "PASS") {
      ok = false;
    }
  }

  return {
    ok,
    notes,
    deterministicEvidence,
  };
}
