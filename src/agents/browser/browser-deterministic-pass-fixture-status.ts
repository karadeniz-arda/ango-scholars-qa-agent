import type { BrowserFixturePreparationResult } from "./fixtures/browser-fixture-types.js";
import type { BrowserRuntimeFixtureResolutionDispatchResult } from "./browser-runtime-fixture-resolution-dispatch.js";
import type { BrowserComposedRuntimePreparation } from "./browser-composed-runtime-preparation.js";
import type { BrowserPassRuntimeSignal } from "./browser-deterministic-pass-runtime-context.js";
import type { BrowserDeterministicPassRuntimePrerequisites } from "./browser-deterministic-pass-policy.js";

type FixtureStatus = BrowserDeterministicPassRuntimePrerequisites["fixtureStatus"];
const unavailable = (reason: string): BrowserPassRuntimeSignal<FixtureStatus> => ({ status: "UNAVAILABLE", reason });

/** Path-discriminated normalization; bypass never becomes NOT_REQUIRED by itself. */
export function normalizeBrowserDeterministicPassFixtureStatus(args:
  | { path: "PREPARATION"; result: BrowserFixturePreparationResult; fixtureRequired: boolean }
  | { path: "RUNTIME_RESOLUTION"; result: BrowserRuntimeFixtureResolutionDispatchResult }
  | { path: "COMPOSED"; result: BrowserComposedRuntimePreparation }
  | { path: "DISCOVERY_BYPASS"; fixtureRequired: boolean | null }
): BrowserPassRuntimeSignal<FixtureStatus> {
  if (args.path === "PREPARATION") {
    if (args.result.status === "READY") return { status: "AVAILABLE", value: "READY", source: "Browser fixture preparation completed READY." };
    if (args.result.status === "NOT_APPLICABLE" && !args.fixtureRequired) return { status: "AVAILABLE", value: "NOT_REQUIRED", source: "No fixture requirement and no fixture provider applied." };
    return unavailable("Fixture preparation did not prove ready or explicitly not required.");
  }
  if (args.path === "RUNTIME_RESOLUTION") {
    if (args.result.status === "READY") return { status: "AVAILABLE", value: "READY", source: "Runtime fixture resolution established the exact compatible fixture." };
    if (args.result.status === "NOT_REQUIRED") return { status: "AVAILABLE", value: "NOT_REQUIRED", source: "Runtime fixture dispatch explicitly found no standalone fixture requirement." };
    return unavailable("Runtime fixture resolution was blocked.");
  }
  if (args.path === "COMPOSED") {
    if (args.result.status === "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED" && args.result.runtimeReadyForInteraction && args.result.fixtureBinding) return { status: "AVAILABLE", value: "READY", source: "Composed runtime preparation confirmed its fixture binding." };
    return unavailable("Composed runtime preparation did not confirm a ready fixture binding.");
  }
  if (args.fixtureRequired === false) return { status: "AVAILABLE", value: "NOT_REQUIRED", source: "Discovery bypass has explicit no-fixture case authority." };
  return unavailable("Discovery fixture bypass did not prove fixture necessity absent.");
}
