import fs from "node:fs";
import yaml from "yaml";
import type {
  BrowserStep,
  TestPlan,
} from "../../planner/types.js";
import { readExecutionTestPlan } from "../../planner/compiled-test-plan.js";
import type {
  RuntimeContextsByPersona,
} from "../../runtime/runtime-context.js";
import type { Page } from "playwright";
import {
  resolveBrowserRouteCandidates,
} from "./browser-route-resolver.js";
import {
  probeBrowserRouteCandidates,
} from "./browser-route-probe.js";
import {
  buildGenericBrowserAssertionHandoffCase,
} from "./browser-agent-assertion-handoff.js";
import {
  reviewBrowserEvidence,
  type BrowserEvidenceCheckpoint,
  type BrowserDeterministicEvidence,
  type BrowserEvidenceIdentity,
} from "./evidence-review.js";
import {
  reviewBrowserVideoEvidence,
  shouldRunVideoEvidenceReview,
} from "./video-evidence-review.js";
import type {
  BrowserEvidenceSummary,
  BrowserStepResult,
} from "./browser-execution-types.js";
import {
  buildEvidenceReviewCase,
  getBrowserManualAcceptanceCoverageGapReason,
  getBrowserPassSemanticGuardReason,
  reconcileBrowserResultFromEvidence,
} from "./browser-result-reconciliation.js";
import {
  buildSuccessSignal,
  buildTraceFromBrowserRun,
  formatTrace,
} from "./browser-trace.js";
import {
  getBrowserCaseText,
  inferBrowserCaseArea,
} from "./browser-case-relevance.js";
import {
  formatBrowserHumanReadableQaResult,
  presentBrowserHumanReadableQaResult,
} from "./browser-human-readable-result.js";
import {
  getRuntimeDeepRouteBinding,
} from "./browser-deep-route-binding-context.js";
import {
  cancelAssessmentEditIfOpen,
  ensureAssessmentLanguageEditorNavigationStep,
  ensureAssessmentLanguageReadOnlyNavigationStep,
  isAssessmentLanguageCase,
  logVisibleAssessmentControls,
  prepareAssessmentLanguageModal,
} from "./browser-assessment-language-flow.js";
import {
  createBrowserRuntimeSession,
  detectAuthWall,
  signInAsPersona,
  type BrowserPersona,
} from "./browser-session-manager.js";
import {
  prepareComposedRuntimeCase, composedPreparationAllowsInteraction,
  blockedComposedPreparation, type BrowserComposedRuntimePreparation,
} from "./browser-composed-runtime-preparation.js";
import {
  runGenericBrowserSteps,
} from "./browser-step-executor.js";
import {
  beginBrowserCaseRuntimeAudit,
} from "./browser-case-runtime-audit.js";
import {
  deriveBrowserCaseRuntimeSafetySignals,
  deriveBrowserDeterministicProofRuntimeSignals,
  buildBrowserDeterministicPassRuntimeContext,
} from "./browser-deterministic-pass-runtime-context.js";
import { normalizeBrowserDeterministicPassFixtureStatus } from "./browser-deterministic-pass-fixture-status.js";
import { attemptDeterministicBrowserPass } from "./browser-deterministic-pass-attempt.js";
import {
  applyBrowserCaseVerdict,
  deriveBrowserCaseVerdict,
  isOperationalDiscoverySupportUnit,
  materializeBrowserRuntimeExecutionContract,
} from "./browser-case-verdict.js";
import { createValidatedBrowserRuntimeExecutionBinding } from "./browser-runtime-execution-binding.js";
import {
  getBrowserBlockReason,
  getBrowserBlockReasonCategory,
} from "./browser-case-blocking-policy.js";
import {
  executeDeferredCleanups,
  type DeferredCleanup,
} from "./browser-deferred-cleanup.js";
import {
  prepareBrowserFixture,
  shouldPrepareBrowserFixture,
  resolveBrowserFixtureEntryRoute,
} from "./fixtures/browser-fixture-lifecycle.js";
import type { BrowserFixturePreparationResult } from "./fixtures/browser-fixture-types.js";
import {
  runGenericBrowserShadow,
  type BrowserShadowAction,
} from "./browser-agent-shadow.js";
import type {
  BrowserObservation,
} from "./browser-observation.js";
import {
  observeBrowserPage,
} from "./browser-observation.js";
import {
  resolveBrowserExecutionSurfacePrerequisite,
} from "./browser-execution-surface-prerequisite.js";

import {
  aggregateGenericBrowserUsefulness,
  summarizeGenericBrowserUsefulness,
  type GenericBrowserUsefulnessEvent,
} from "./generic-browser-usefulness-telemetry.js";
import {
  buildGenericBrowserUsefulnessExecutionProfile,
} from "./generic-browser-usefulness-execution-profile.js";
import {
  summarizeBrowserOperationalCapabilities,
} from "./browser-capability-evaluation.js";
import type {
  BrowserStandardRunCapabilityRecognition,
} from "./browser-standard-run-capability-recognition.js";
import {
  discoverFrontendVisibleFieldProvenance,
} from "../../discovery/frontend-visible-field-provenance.js";
import {
  buildCollectionFilterRequirements,
} from "./browser-grounded-search-proof.js";
import {
  executeBrowserEvidenceContractProofs,
  summarizeBrowserEvidenceContractProofCoverage,
  type BrowserEvidenceContractProofResult,
} from "./browser-evidence-contract-proof.js";
import {
  allocateBrowserRuntimeSourceAssertions,
  browserSourceBoundAssertionPathOf,
  buildBrowserSourceBoundAssertionSetRequirements,
  collectBrowserSourceBoundAssertionSetTelemetry,
  evaluateBrowserSourceBoundAssertionSet,
  evaluateBrowserSourceBoundAssertionSetDischarge,
  observeBrowserSourceDerivedButtonCarriers,
  SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_MARKER,
  summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry,
} from "./browser-source-bound-assertion-set-proof.js";
import {
  auditBrowserCaseProofReadiness,
} from "./browser-local-state-obligation-discharge.js";
import {
  buildBrowserSourceBoundStructuralControlPresenceRequirements,
  evaluateBrowserSourceBoundStructuralControlPresence,
} from "./browser-source-bound-structural-control-presence-proof.js";
import {
  selectMaterializedBrowserRuntimeCases,
} from "./browser-execution-case-selection.js";

import {
  applyBrowserSkillsRuntime,
} from "./browser-skills-runtime.js";
import {
  prepareTimesheetContractConfigFixture,
} from "./fixtures/timesheet-contract-config-fixture-runtime.js";
import {
  runGenericBrowserRuntimeAttempt,
} from "./generic-browser-runtime-attempt.js";
import {
  dispatchBrowserRuntimeFixtureResolution,
  mergeRuntimeFixturePreparations,
} from "./browser-runtime-fixture-resolution-dispatch.js";





export type BrowserRunOptions = {
  runtimeContexts?:
    RuntimeContextsByPersona;
  /** Read-only execution input for an archived compiled plan; never writes it. */
  planPath?: string;
};




async function collectKeyVisibleTexts(page: Page): Promise<string[]> {
  const candidates = [
    "Project",
    "Job Title",
    "Job Description",
    "Skills",
    "All",
    "Continue to Scholars",
    "Continue",
    "Email",
    "Select a project",
    "Newest",
    "Latest",
    "Oldest",
    "Filters",
    "Processed By",
    "Paid On",
    "Work Period",
    "Submit By",
    "Approved By",
    "undefined",
    "null",
  ];

  const visibleTexts: string[] = [];

  for (const text of candidates) {
    const visible = await page
      .getByText(text, { exact: false })
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (visible) visibleTexts.push(text);
  }

  return visibleTexts;
}







function ensureTalentProfileLanguageNavigationStep(
  testCase: any
): void {
  const persona = String(
    testCase?.persona || ""
  ).toLowerCase();

  const caseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
    JSON.stringify(
      testCase?.steps ?? []
    ),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  const isTalentProfileLanguageCase =
    persona === "talent" &&
    [
      "talent profile",
      "scholar profile",
      "profile language",
      "language section",
    ].some((term) =>
      caseText.includes(term)
    ) &&
    [
      "language",
      "listening",
      "speaking",
      "writing",
      "reading",
      "proficiency",
    ].some((term) =>
      caseText.includes(term)
    );

  if (!isTalentProfileLanguageCase) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const alreadyNavigates =
    steps.some(
      (step: any) =>
        step?.action === "clickTopTab" &&
        /^skills\s*&\s*languages$/i.test(
          String(
            step?.text || ""
          ).trim()
        )
    );

  if (alreadyNavigates) {
    return;
  }

  testCase.steps = [
    {
      action: "clickTopTab",
      text: "Skills & Languages",
    },
    ...steps,
  ];

  console.log(
    ` Talent profile language navigation ` +
      `added for ${testCase.id}: ` +
      `Skills & Languages`
  );
}

function ensureJobWizardEmptyStateControlStep(
  testCase: any
): void {
  const caseText =
    getBrowserCaseText(testCase);

  if (
    !caseText.includes("job wizard")
  ) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const emptyStateStep = steps.find(
    (step: any) =>
      step?.action ===
        "assertTextVisible" &&
      /^no\s+.+?\s+found$/i.test(
        String(step?.text || "").trim()
      )
  );

  if (!emptyStateStep) {
    return;
  }

  const emptyStateMatch =
    String(emptyStateStep.text)
      .trim()
      .match(
        /^no\s+(.+?)\s+found$/i
      );

  const entityText =
    emptyStateMatch?.[1]?.trim();

  if (!entityText) {
    return;
  }

  const controlTarget =
    `Search ${entityText}`;

  const alreadyOpensControl =
    steps.some(
      (step: any) =>
        step?.action ===
          "openRuntimeControl" &&
        String(
          step?.target || ""
        )
          .trim()
          .toLowerCase() ===
        controlTarget.toLowerCase()
    );

  if (alreadyOpensControl) {
    return;
  }

  const entityNavigationIndex =
    steps.findIndex(
      (step: any) =>
        step?.action ===
          "clickText" &&
        String(step?.text || "")
          .trim()
          .toLowerCase() ===
        entityText.toLowerCase()
    );

if (
  entityNavigationIndex < 0
) {
  testCase.steps = [
    {
      action: "clickText",
      text: entityText,
    },
    {
      action: "openRuntimeControl",
      target: controlTarget,
    },
    ...steps,
  ];
} else {
  testCase.steps = [
    ...steps.slice(
      0,
      entityNavigationIndex + 1
    ),
    {
      action: "openRuntimeControl",
      target: controlTarget,
    },
    ...steps.slice(
      entityNavigationIndex + 1
    ),
  ];
}

  console.log(
    ` Job wizard empty-state control ` +
      `navigation added for ` +
      `${testCase.id}: ${controlTarget}`
  );
}








function cleanJsonFileContent(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}



export async function runBrowserCases(
  options: BrowserRunOptions = {}
) {
  console.log("\nSmoke Chrome Test starting...");

  const runtimeContexts =
    options.runtimeContexts ?? {};

  const receivedPersonas =
    Object.keys(runtimeContexts);

  if (receivedPersonas.length > 0) {
    console.log(
      ` Browser runtime handoff received for: ` +
        receivedPersonas.join(", ")
    );
  }
  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const baseUrl = String(
    process.env.QA_BASE_URL ?? config.environments.staging.url
  ).replace(/\/$/, "");

  const plan: TestPlan = readExecutionTestPlan(
    options.planPath ? { path: options.planPath } : {}
  ).plan;
  const browserExecutionSelection =
    selectMaterializedBrowserRuntimeCases(plan);
  const executionBrowserCases =
    browserExecutionSelection.cases;

  const diagnosticFilter =
    browserExecutionSelection
      .diagnosticExecutionFilter;

  console.log(
    diagnosticFilter.enabled
      ? " Browser case diagnostic filter: " +
        `requested=${diagnosticFilter.requestedCaseId}; ` +
        `matched=${diagnosticFilter.postFilterCount}.`
      : " Browser case diagnostic filter: disabled."
  );

  console.log(
    " Browser runtime admission: " +
      `materialized=${browserExecutionSelection.materializedBrowserRuntimeUnitCount}, ` +
      `selected=${browserExecutionSelection.browserExecutionSelectedCount}, ` +
      `source/proof-rich diagnostic lane=${browserExecutionSelection.sourceProofRichDiagnosticLaneCount}, ` +
      `discovery/support diagnostic lane=${browserExecutionSelection.discoverySupportDiagnosticLaneCount}.`
  );

  /*
   * GROUNDED_SEARCH_FILTER_LEGACY_REQUIREMENT_ADAPTER_V0
   *
   * Frozen plans predate structured collection-filter requirements. Upgrade
   * only source-authorized, fully specified legacy coverage in memory. This
   * adapter creates requirements, never proof, evidence or a verdict.
   */
  for (const browserCase of plan.browserCases ?? []) {
    const existing = browserCase.acceptanceScope
      ?.collectionFilterRequirements ?? [];
    if (existing.length > 0) continue;
    const requirements = buildCollectionFilterRequirements({
      testCase: browserCase,
      ...(plan.acceptanceSourceLedger
        ? { acceptanceSourceLedger: plan.acceptanceSourceLedger }
        : {}),
    });
    if (requirements.length === 0) continue;
    browserCase.acceptanceScope = {
      ...(browserCase.acceptanceScope ?? {
        requiresBehaviorProof: false,
        behaviorClaims: [],
      }),
      requiresBehaviorProof: true,
      behaviorClaims: [
        ...new Set([
          ...(browserCase.acceptanceScope?.behaviorClaims ?? []),
          ...requirements.map((requirement) => requirement.sourceClaim),
        ]),
      ],
      collectionFilterRequirements: requirements,
    };
  }
  const results: any[] = [];
  const runProofBindings = (plan.browserCases ?? []).flatMap(
    (testCase) => testCase.deterministicProofBindings ?? []
  );
  const runProofResults: BrowserEvidenceContractProofResult[] = [];
  const visibleFieldProvenance =
    discoverFrontendVisibleFieldProvenance();

  console.log(
    ` Frontend visible-field provenance: ` +
      `${visibleFieldProvenance.length} bounded ` +
      `authoritative column declaration(s) discovered.`
  );

  const genericBrowserUsefulnessCaseRecords:
    Array<{
      issueKey: string;
      caseId: string;
      events:
        GenericBrowserUsefulnessEvent[];
      summary:
        ReturnType<
          typeof summarizeGenericBrowserUsefulness
        >;
      capabilityRecognitions:
        BrowserStandardRunCapabilityRecognition[];
      capabilityTelemetry:
        ReturnType<
          typeof summarizeBrowserOperationalCapabilities
        >;
      capabilityTelemetryByFamily:
        Record<
          string,
          ReturnType<
            typeof summarizeBrowserOperationalCapabilities
          >
        >;
    }> = [];


const pendingEvidenceReviews: Array<{
  testCase: any;
  evidenceReviewCase: any;
    currentStatus:
      | "PASS"
      | "FAIL"
      | "MANUAL_REQUIRED";
    currentReasonCategory: string;
    screenshotPath: string;
    checkpointEvidence:
      BrowserEvidenceCheckpoint[];
    deterministicEvidence:
      BrowserDeterministicEvidence[];
    currentUrl: string;
    notes: string[];
  }> = [];

  fs.mkdirSync("qa-results", { recursive: true });
  fs.mkdirSync("qa-results/evidence", { recursive: true });
  fs.mkdirSync("qa-results/videos", { recursive: true });
  if (
    executionBrowserCases.length === 0
  ) {
    console.log("\nNo browser cases were generated.");
    return results;
  }


  const {
    stagehand,
    browser,
    context,
    page: initialPage,
  } = await createBrowserRuntimeSession(baseUrl);

  let page = initialPage;

  let signedInPersona: BrowserPersona | null = null;

  /*
   * Keep browser authentication stable by grouping route
   * probing cases by persona. This prevents sequences such
   * as talent -> company_admin -> talent.
   */
  const personaOrder: Record<
    BrowserPersona,
    number
  > = {
    talent: 0,
    company_admin: 1,
  };

  const runtimeCases = executionBrowserCases.map(testCase =>
    testCase.composedRuntimeResolution ? structuredClone(testCase) : testCase);
  const composedPreparations = new Map<string, BrowserComposedRuntimePreparation>();
  const probeCases = [
    ...(runtimeCases as any[]),
  ].sort((left, right) => {
    const leftPersona =
      String(left?.persona || "") as BrowserPersona;

    const rightPersona =
      String(right?.persona || "") as BrowserPersona;

    return (
      (personaOrder[leftPersona] ?? 99) -
      (personaOrder[rightPersona] ?? 99)
    );
  });

  /*
   * Cases that share the same persona and candidate route
   * list also share the same feature entry route.
   * Probe that entry route only once.
   */
  const runtimeRouteProbeCache =
    new Map<string, string>();

  /*
   * Runtime route-discovery pass:
   * - sign in with the correct persona;
   * - rank up to three codebase/runtime candidates;
   * - navigate to each candidate;
   * - accept only a route whose live page matches the
   *   intended feature area.
   */
  for (const testCase of probeCases) {
    const persona =
      String(testCase.persona || "") as BrowserPersona;

    if (
      !["company_admin", "talent"].includes(
        persona
      )
    ) {
      continue;
    }

    if (testCase.composedRuntimeResolution) {
      try {
        if (signedInPersona !== persona) {
          await context.clearCookies();
          await signInAsPersona(page, baseUrl, persona);
          signedInPersona = persona;
        }
        composedPreparations.set(testCase.id, await prepareComposedRuntimeCase({
          testCase, actualPersona: signedInPersona,
        }));
      } catch {
        composedPreparations.set(testCase.id,
          blockedComposedPreparation(testCase, "COMPOSED_SESSION_PREPARATION_FAILED"));
      }
      // Linked cases never independently invoke legacy navigation/fixture selection.
      continue;
    }

    const runtimeResourceContext =
      runtimeContexts[persona];

    if (runtimeResourceContext) {
      testCase.runtimeResourceContext =
        runtimeResourceContext;

      console.log(
        ` Browser runtime handoff attached to ` +
          `${testCase.id} (${persona}):`,
        runtimeResourceContext
      );
    }

    const skillsRuntimeResult =
      applyBrowserSkillsRuntime(
        plan,
        testCase,
        runtimeResourceContext
      );

    if (
      skillsRuntimeResult.status ===
      "BLOCKED"
    ) {
      testCase.runtimeFixtureResolutionFailure =
        skillsRuntimeResult.reason;
    } else if (
      skillsRuntimeResult.status ===
      "READY"
    ) {
      delete testCase
        .runtimeFixtureResolutionFailure;

      console.log(
        " Browser selected-skill runtime handoff " +
          `prepared ${skillsRuntimeResult.skillLabels.length} ` +
          "existing record(s)."
      );
    }

    const timesheetFixtureResult =
      await prepareTimesheetContractConfigFixture({
        testCase,
        persona,
        ...(runtimeResourceContext
          ? { runtimeContext: runtimeResourceContext }
          : {}),
      });

    if (
      timesheetFixtureResult.status !==
      "NOT_APPLICABLE"
    ) {
      console.log(
        ` Timesheet/contract-config fixture resolver: ` +
          `status=${timesheetFixtureResult.status}; ` +
          `reason=${timesheetFixtureResult.reasonCode}; ` +
          `candidates=${timesheetFixtureResult.candidateCount}.`
      );
    }

    try {
      if (signedInPersona !== persona) {
        console.log(
          ` Runtime route probing persona: ` +
            `${signedInPersona ?? "none"} -> ${persona}`
        );

        await context.clearCookies();
        await signInAsPersona(
          page,
          baseUrl,
          persona
        );

        signedInPersona = persona;
      }

      const resolvedCandidates =
        await resolveBrowserRouteCandidates(
          plan,
          testCase,
          3
        );

      const explicitStartRoute =
        String(
          testCase.startRoute || ""
        ).trim();

      const hasConcreteExplicitStartRoute =
        explicitStartRoute.startsWith("/") &&
        explicitStartRoute.toUpperCase() !==
          "UNKNOWN" &&
        !/{[^}]+}/.test(
          explicitStartRoute
        );

      /*
       * READ_ONLY_JOB_WIZARD_ROUTE_PRIORITY_V1
       *
       * A jobs-list startRoute may be a discovery entry
       * point rather than the actual surface required by
       * a read-only job-wizard case.
       *
       * When the runtime resolver has safely selected the
       * non-mutating wizard route, do not let the broad
       * jobs-list entry route override that result.
       */
      const routeSelectionCaseText = [
        String(testCase?.goal || ""),
        String(
          testCase?.successCriteria || ""
        ),
        JSON.stringify(
          testCase?.steps ?? []
        ),
      ]
        .join(" ")
        .toLowerCase()
        .replace(/[-_]+/g, " ");

      const hasDedicatedJobMutationStep =
        Array.isArray(testCase?.steps) &&
        testCase.steps.some(
          (step: any) =>
            step?.action ===
            "createDraftJobAndVerifyRedirect"
        );

      const explicitRouteIsJobsList =
        new Set([
          "/company/jobs",
          "/company/all-jobs",
        ]).has(
          explicitStartRoute.replace(
            /\/$/,
            ""
          )
        );

const resolverSelectedReadOnlyWizard =
  resolvedCandidates[0] ===
  "/company/jobs/create";

const explicitRouteIsAssessmentsList =
  persona === "company_admin" &&
  explicitStartRoute.replace(
    /\/$/,
    ""
  ) === "/company/assessments";

const runtimeAssessmentDetailRoute =
  resolvedCandidates.find(
    (route) =>
      /^\/company\/assessments\/[^/?#]+(?:\?.*)?$/i.test(
        route
      )
  );

const shouldPreferRuntimeAssessmentDetailRoute =
  persona === "company_admin" &&
  isAssessmentLanguageCase(testCase) &&
  explicitRouteIsAssessmentsList &&
  Boolean(runtimeAssessmentDetailRoute);

const isReadOnlyJobWizardCase =
        persona === "company_admin" &&
        routeSelectionCaseText.includes(
          "job wizard"
        ) &&
        !hasDedicatedJobMutationStep;

const shouldPinExplicitStartRoute =
  hasConcreteExplicitStartRoute &&
  !(
    (
      isReadOnlyJobWizardCase &&
      explicitRouteIsJobsList &&
      resolverSelectedReadOnlyWizard
    ) ||
    shouldPreferRuntimeAssessmentDetailRoute
  );

      /*
       * A concrete route supplied by the plan or a
       * focused canary is an execution constraint,
       * not a weak discovery hint.
       *
       * It is still live-probed, but it must be
       * attempted before inferred catalog routes.
       */
const candidates =
  shouldPinExplicitStartRoute
    ? [
        explicitStartRoute,
        ...resolvedCandidates.filter(
          (route) =>
            route !==
            explicitStartRoute
        ),
      ]
    : shouldPreferRuntimeAssessmentDetailRoute &&
        runtimeAssessmentDetailRoute
      ? [
          runtimeAssessmentDetailRoute,
          ...resolvedCandidates.filter(
            (route) =>
              route !==
              runtimeAssessmentDetailRoute
          ),
        ]
      : resolvedCandidates;

      if (
        shouldPinExplicitStartRoute
      ) {
        console.log(
          ` Runtime route candidates pinned ` +
            `explicit startRoute for ` +
            `${testCase.id}: ` +
            `${explicitStartRoute}`
        );

      } else if (
  shouldPreferRuntimeAssessmentDetailRoute &&
  runtimeAssessmentDetailRoute
) {
  console.log(
    ` Runtime route candidates preferred ` +
      `assessment detail route for ` +
      `${testCase.id}: ` +
      `${explicitStartRoute} -> ` +
      `${runtimeAssessmentDetailRoute}`
  );
      } else if (
        hasConcreteExplicitStartRoute &&
        isReadOnlyJobWizardCase &&
        explicitRouteIsJobsList &&
        resolverSelectedReadOnlyWizard
      ) {
        console.log(
          ` Runtime route candidates preferred ` +
            `read-only job wizard route for ` +
            `${testCase.id}: ` +
            `${explicitStartRoute} -> ` +
            `/company/jobs/create`
        );
      }

      const probeCacheKey = [
        persona,
        inferBrowserCaseArea(testCase) ??
          "unknown",
        ...candidates,
      ].join("|");

      const cachedRoute =
        runtimeRouteProbeCache.get(
          probeCacheKey
        );

      if (cachedRoute) {
        const previousRoute =
          String(
            testCase.startRoute ||
              "UNKNOWN"
          );

        testCase.startRoute =
          cachedRoute;

        delete testCase
          .runtimeRouteDiscoveryFailure;

        console.log(
          ` Runtime browser route cache hit for ` +
            `${testCase.id}: ${previousRoute} -> ` +
            `${cachedRoute}`
        );

        continue;
      }

      const probeResult =
        await probeBrowserRouteCandidates(
          page,
          baseUrl,
          testCase,
          candidates
        );

      if (probeResult.acceptedRoute) {
        runtimeRouteProbeCache.set(
          probeCacheKey,
          probeResult.acceptedRoute
        );

        const previousRoute =
          String(testCase.startRoute || "UNKNOWN");

        testCase.startRoute =
          probeResult.acceptedRoute;

        delete testCase.runtimeRouteDiscoveryFailure;

        console.log(
          ` Runtime browser route selected for ` +
            `${testCase.id}: ${previousRoute} -> ` +
            `${probeResult.acceptedRoute}`
        );
      } else {
        testCase.startRoute = "UNKNOWN";

        const attempts = probeResult.attempts
          .map(
            (attempt) =>
              `${attempt.route}: ${attempt.reason}`
          )
          .join(" | ");

        testCase.runtimeRouteDiscoveryFailure =
          "Runtime browser route discovery exhausted. " +
          (
            attempts
              ? `Attempts: ${attempts}`
              : "No concrete route candidates were available."
          );

        console.log(
          ` Runtime browser route discovery exhausted ` +
            `for ${testCase.id}.`
        );
      }
    } catch (error: any) {
      testCase.startRoute = "UNKNOWN";
      testCase.runtimeRouteDiscoveryFailure =
        "Runtime browser route discovery exhausted. " +
        `Probe error: ${String(
          error?.message || error
        )}`;

      console.log(
        ` Runtime browser route probing error for ` +
          `${testCase.id}: ${String(
            error?.message || error
          )}`
      );
    }
  }

  /*
   * Execute the persona that is already authenticated first.
   * JavaScript sort is stable, so case order inside each
   * persona group is preserved.
   */
  const executionCases = [
    ...(runtimeCases as any[]),
  ].sort((left, right) => {
    const leftIsCurrent =
      String(left?.persona || "") ===
      signedInPersona;

    const rightIsCurrent =
      String(right?.persona || "") ===
      signedInPersona;

    return Number(rightIsCurrent) -
      Number(leftIsCurrent);
  });

  console.log(
    ` Browser execution starts with authenticated persona: ` +
      `${signedInPersona ?? "none"}`
  );

for (const testCase of executionCases) {
  console.log(`\nTaking photo: [${testCase.id}] - ${testCase.goal}`);

  if (testCase.composedRuntimeResolution) {
    const prepared = composedPreparations.get(testCase.id);
    if (!composedPreparationAllowsInteraction(testCase, prepared, testCase.persona)) {
      const censusEvidence = prepared?.candidatePredicateCensus
        ? `Runtime candidate census: ${JSON.stringify(
            prepared.candidatePredicateCensus
          )}`
        : "";
      results.push({ id: testCase.id, status: "BLOCKED", reasonCategory: "TEST_DATA_ISSUE",
        startRoute: "UNKNOWN", successSignalReached: false,
        evidence: [
          prepared?.failureReason ?? "COMPOSED_PREPARATION_MISSING",
          censusEvidence,
        ].filter(Boolean).join(" | "),
        composedRuntimePreparation: prepared ?? blockedComposedPreparation(testCase, "COMPOSED_PREPARATION_MISSING") });
      continue;
    }
    testCase.startRoute = prepared!.navigationBinding!.concreteRoute;
  }

  const fixtureMatchContext = {
    issueKey: String(
      plan.issueKey || ""
    ),
    testCase,
  };

  const fixturePreparationPlanned =
    !testCase.composedRuntimeResolution && shouldPrepareBrowserFixture(
      fixtureMatchContext
    );

  const plannedStartRoute =
    String(
      testCase.startRoute || ""
    ).trim();

  const plannedStartRouteReady =
    plannedStartRoute.startsWith("/") &&
    !plannedStartRoute.startsWith("//") &&
    !plannedStartRoute
      .toUpperCase()
      .startsWith("UNKNOWN");

  const fixtureEntryRoute =
    fixturePreparationPlanned &&
    !plannedStartRouteReady
      ? resolveBrowserFixtureEntryRoute(
          fixtureMatchContext
        )
      : null;

  if (fixtureEntryRoute) {
    testCase.startRoute =
      fixtureEntryRoute;

    console.log(
      ` Browser fixture entry route selected ` +
        `for ${testCase.id}: ` +
        `${fixtureEntryRoute}`
    );
  }

  const executionStartRoute =
    String(
      testCase.startRoute || ""
    ).trim();

  const executionRouteReady =
    executionStartRoute.startsWith("/") &&
    !executionStartRoute.startsWith("//") &&
    !executionStartRoute
      .toUpperCase()
      .startsWith("UNKNOWN");

    /*
 * GENERIC_BROWSER_PRE_ADAPTER_CASE_V1
 *
 * Preserve the planner-authored case before feature-specific
 * compatibility adapters add runtime navigation steps.
 *
 * The generic browser agent must reason from the acceptance
 * intent and original planned steps, not from navigation
 * answers injected later by a feature adapter.
 */
const genericBrowserTestCase = {
  ...testCase,
  steps: Array.isArray(testCase.steps)
    ? [...testCase.steps]
    : testCase.steps,
};

  ensureAssessmentLanguageReadOnlyNavigationStep(
    testCase
  );

  if (!fixturePreparationPlanned) {
    ensureTalentProfileLanguageNavigationStep(
      testCase
    );
  } else {
    console.log(
      ` Browser fixture provider owns ` +
        `the talent-language surface ` +
        `preparation for ${testCase.id}.`
    );
  }

  ensureAssessmentLanguageEditorNavigationStep(
    testCase
  );

  ensureJobWizardEmptyStateControlStep(
    testCase
  );

  const successSignal =
    buildSuccessSignal(testCase);

  const blockReason =
    getBrowserBlockReason(testCase);

  const fixtureBlockDeferred =
    Boolean(blockReason) &&
    fixturePreparationPlanned &&
    executionRouteReady;

  if (
    !blockReason &&
    !executionRouteReady
  ) {
    const routeReason =
      "No concrete browser route or registered " +
      "fixture-provider entry route was available.";

    results.push({
      id: testCase.id,
      status: "BLOCKED",
      reasonCategory:
        "MISSING_BROWSER_ROUTE",
      startRoute: testCase.startRoute,
      evidence: [
        routeReason,
        `Success signal: ${successSignal}`,
        "Success signal reached: false",
      ].join(" | "),
      successSignal,
      successSignalReached: false,
      evidenceSummary: {
        successSignal,
        successSignalReached: false,
        authWallDetected: false,
        pagesVisited: [],
        keyVisibleTexts: [],
      },
      trace: [
        {
          index: 1,
          action:
            "fixture-entry-route",
          status: "BLOCKED",
          note: routeReason,
        },
      ],
    });

    console.log(
      ` Result: BLOCKED (` +
        `${routeReason})`
    );

    continue;
  }

    if (
      blockReason &&
      !fixtureBlockDeferred
    ) {
      results.push({
        id: testCase.id,
        status: "BLOCKED",
        reasonCategory:
  getBrowserBlockReasonCategory(blockReason),
        startRoute: testCase.startRoute,
        evidence: [
          blockReason,
          `Success signal: ${successSignal}`,
          "Success signal reached: false",
        ].join(" | "),
        successSignal,
        successSignalReached: false,
        evidenceSummary: {
          successSignal,
          successSignalReached: false,
          authWallDetected: false,
          pagesVisited: [],
          keyVisibleTexts: [],
        },
        trace: [
          {
            index: 1,
            action: "block-reason",
            status: "BLOCKED",
            note: blockReason,
          },
        ],
      });

      console.log(` Result: BLOCKED (${blockReason})`);
      continue;
    }

    if (
      blockReason &&
      fixtureBlockDeferred
    ) {
      console.log(
        ` Browser fixture lifecycle deferred ` +
          `the early fixture block for ` +
          `${testCase.id}.`
      );
    }

const deferredCleanups:
  DeferredCleanup[] = [];

    let deferredCleanupExecuted =
      false;

        if (page.isClosed()) {
      page = await context.newPage();
    }

    try {
      await page.setViewportSize({ width: 1280, height: 720 });

const persona = testCase.persona as BrowserPersona;

if (signedInPersona !== persona) {
  console.log(
    ` Switching browser persona: ${signedInPersona ?? "none"} -> ${persona}`
  );

  await context.clearCookies();
  await signInAsPersona(page, baseUrl, persona);

  signedInPersona = persona;
} else {
  console.log(` Reusing browser session for persona: ${persona}`);
}

      if (testCase.composedRuntimeResolution && !composedPreparationAllowsInteraction(
        testCase, composedPreparations.get(testCase.id), signedInPersona
      )) {
        results.push({ id: testCase.id, status: "BLOCKED", reasonCategory: "TEST_DATA_ISSUE",
          successSignalReached: false, evidence: "COMPOSED_PREPARATION_SESSION_MISMATCH" });
        continue;
      }

      const targetUrl =
        `${baseUrl}${executionStartRoute}`;

      let authenticatedRouteReached =
        false;

      for (
        let authAttempt = 1;
        authAttempt <= 3;
        authAttempt += 1
      ) {
        await page.goto(
          targetUrl,
          {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }
        );

        await page.waitForTimeout(1000);

        /*
         * DOMContentLoaded is not enough for React Query /
         * async table data. Wait briefly for pending network
         * requests, without failing the case if the app keeps
         * a long-lived request open.
         */
        await page
          .waitForLoadState(
            "networkidle",
            {
              timeout: 5000,
            }
          )
          .catch(() => {});

        const currentUrl =
          page.url().toLowerCase();

        const redirectedToLogin =
          currentUrl.includes(
            "/account/login"
          ) ||
          currentUrl.endsWith("/login") ||
          currentUrl.includes(
            "/login?"
          );

        if (!redirectedToLogin) {
          authenticatedRouteReached =
            true;

          break;
        }

        console.log(
          ` Auth retry for ${testCase.id}: ` +
            `protected route redirected to login ` +
            `(attempt ${authAttempt}/3).`
        );

        if (authAttempt < 3) {
          await signInAsPersona(
            page,
            baseUrl,
            persona
          );

          signedInPersona = persona;

          await page.waitForTimeout(1000);
        }
      }

      if (!authenticatedRouteReached) {
        throw new Error(
          `Authentication session was not ready for ` +
            `${testCase.id}. Protected route kept ` +
            `redirecting to login after 3 attempts.`
        );
      }

      const executionSurfaceContract =
        testCase.executionSurfacePrerequisiteContract;
      if (executionSurfaceContract) {
        const surfacePreparation =
          resolveBrowserExecutionSurfacePrerequisite({
            contract: executionSurfaceContract,
            observation: await observeBrowserPage(page),
            actualPersona: persona,
          });
        if (surfacePreparation.status === "BLOCKED") {
          results.push({
            id: testCase.id,
            status: "BLOCKED",
            reasonCategory: "AUTOMATION_LIMITATION",
            startRoute: testCase.startRoute,
            successSignalReached: false,
            evidence:
              `Execution surface prerequisite blocked: ` +
              `${surfacePreparation.reason}; ` +
              `candidates=${surfacePreparation.candidateCount}.`,
            executionSurfacePreparation: surfacePreparation,
          });
          continue;
        }
        console.log(
          ` Browser execution surface prepared for ${testCase.id}: ` +
            `${surfacePreparation.binding.kind} ` +
            `${surfacePreparation.binding.role}.`
        );
      }

      const preGenericFixtureDispatch =
        await dispatchBrowserRuntimeFixtureResolution({
          page,
          testCase,
          actualPersona: persona,
        });

      if (preGenericFixtureDispatch.status === "BLOCKED") {
        results.push({
          id: testCase.id,
          status: "BLOCKED",
          reasonCategory: "TEST_DATA_ISSUE",
          startRoute: testCase.startRoute,
          successSignalReached: false,
          evidence: preGenericFixtureDispatch.note,
          runtimeFixturePreparations:
            preGenericFixtureDispatch.preparations,
        });
        continue;
      }

/*
 * GENERIC_BROWSER_BOUNDED_NAVIGATION_V1
 *
 * The generic browser agent is intentionally allowed to make
 * more than one safe read-only decision.
 *
 * Each successful state-changing action is followed by a fresh
 * observation and a new proposal. The loop is bounded so an LLM
 * cannot wander indefinitely.
 *
 * Feature-specific navigation remains only as a compatibility
 * fallback after this loop.
 */
/*
 * GENERIC_BROWSER_VERIFIED_EXECUTION_BUDGET_V1
 *
 * Keep the conservative six-action base fuse.
 *
 * One bounded extension is earned only after six actions have
 * already satisfied the runner's existing verified execution
 * contract: EXECUTED + executed=true + stateChanged=true.
 *
 * Failed, unchanged, unsafe or repeated actions still terminate
 * before additional budget can be earned.
 */
const caseRuntimeAudit =
  beginBrowserCaseRuntimeAudit({
    caseId: String(testCase.id || ""),
    page,
    productOrigin: baseUrl,
  });

/* The typed fixture-resolution dispatch completed for this case. */
if (
  preGenericFixtureDispatch.status === "NOT_REQUIRED" ||
  preGenericFixtureDispatch.status === "READY"
) {
  caseRuntimeAudit.recordTestData("CLEAR");
}

const genericBrowserAttempt =
  await runGenericBrowserRuntimeAttempt({
    page,
    issueKey: String(plan.issueKey || ""),
    testCase: genericBrowserTestCase,
    policy: {
      allowActionExecution: true,
    },
    recordSafetyEvaluation:
      (evaluation) =>
        caseRuntimeAudit.recordSafetyEvaluation(
          evaluation
        ),
  });

const genericBrowserExecutedSteps =
  genericBrowserAttempt.verifiedStateChangingActionCount;

const genericBrowserStopReason =
  genericBrowserAttempt.stopReason;

const genericBrowserUsefulnessEvents =
  genericBrowserAttempt.events;

const genericBrowserCapabilityRecognitions =
  genericBrowserAttempt.capabilityRecognitions;

const genericBrowserGoalIteration =
  genericBrowserAttempt.goalIteration;

const genericBrowserGoalObservation =
  genericBrowserAttempt.goalObservation;

const genericBrowserBudgetExhausted =
  genericBrowserAttempt.budgetExhausted;

/*
 * GENERIC_BROWSER_PROOF_GATED_OWNERSHIP_V1
 *
 * Autonomous navigation is an additive migration path.
 *
 * GOAL_ALREADY_SATISFIED is only permission to attempt
 * canonical deterministic verification. It is not proof
 * and does not by itself grant ownership of the current
 * browser state.
 *
 * Partial navigation is disposable immediately. A terminal
 * autonomous state is also disposable if its canonical
 * deterministic handoff does not PASS.
 *
 * Compatibility execution always resumes from a fresh
 * authenticated page rather than replaying against a
 * partially changed autonomous state.
 */
const genericBrowserReachedGoal =
  genericBrowserStopReason ===
  "GOAL_ALREADY_SATISFIED";

const genericBrowserHandoffAcceptedRoutePath =
  browserSourceBoundAssertionPathOf(page.url());
const genericBrowserHandoffSourceRequirements =
  genericBrowserReachedGoal
    ? buildBrowserSourceBoundAssertionSetRequirements({
        testCase,
        assertionSourceCase: genericBrowserTestCase,
        obligationLedger: plan.acceptanceObligationLedger,
        sourceLedger: plan.acceptanceSourceLedger,
        acceptedRoutePath: genericBrowserHandoffAcceptedRoutePath,
      })
    : [];

const genericBrowserAssertionHandoffCase =
  genericBrowserReachedGoal
    ? buildGenericBrowserAssertionHandoffCase(
        genericBrowserTestCase,
        genericBrowserGoalObservation,
        genericBrowserHandoffSourceRequirements
      )
    : null;

const genericBrowserHasAssertionHandoff =
  genericBrowserAssertionHandoffCase !== null;

if (
  genericBrowserGoalIteration !==
  null
) {
  genericBrowserUsefulnessEvents.push({
    kind:
      "HANDOFF_ELIGIBILITY_RECORDED",
    iteration:
      genericBrowserGoalIteration,
    eligible:
      genericBrowserHasAssertionHandoff,
  });
}

/*
 * DISCOVERY_ONLY_ASSERTION_PROBE_V1
 *
 * Discovery-only execution may run the existing canonical deterministic
 * assertion handoff after GOAL_ALREADY_SATISFIED so runtime usefulness can be
 * measured beyond navigation.
 *
 * The assertion handoff remains authority-neutral until the shared
 * deterministic PASS policy independently revalidates its typed proof:
 * - no fixture authority is created;
 * - no planner authority is created;
 * - source-bound proof, discharge, readiness, and runtime context must all
 *   be complete before the common deterministic PASS attempt can promote it.
 *
 * This probes whether the reached runtime state is deterministically
 * verifiable without promoting discovery observations into proof authority.
 */
if (testCase.executionPolicy?.lane === "DISCOVERY_ONLY") {
  let discoveryAssertionHandoffStatus:
    string | null = null;
  let discoveryAssertionHandoffResult:
    BrowserStepResult | null = null;

  if (genericBrowserAssertionHandoffCase) {
    const handoffResult =
      await runGenericBrowserSteps(
        page,
        genericBrowserAssertionHandoffCase,
        undefined,
        undefined,
        {
          visibleFieldProvenance,
          executionPersona: persona,
        }
      );

    discoveryAssertionHandoffResult = handoffResult;
    discoveryAssertionHandoffStatus =
      handoffResult.status;

    if (
      genericBrowserGoalIteration !==
      null
    ) {
      genericBrowserUsefulnessEvents.push({
        kind:
          "HANDOFF_RESULT_RECORDED",
        iteration:
          genericBrowserGoalIteration,
        attempted: true,
        passed:
          handoffResult.status ===
          "PASS",
      });
    }

    console.log(
      ` Discovery-only deterministic assertion probe for ` +
        `${testCase.id}: ${handoffResult.status}.`
    );
  }

  const genericBrowserUsefulnessSummary =
    summarizeGenericBrowserUsefulness(
      genericBrowserUsefulnessEvents
    );

  const capabilityEvaluations =
    genericBrowserCapabilityRecognitions.map(
      (recognition) =>
        recognition.evaluation
    );

  const genericBrowserCapabilityTelemetry =
    summarizeBrowserOperationalCapabilities(
      capabilityEvaluations
    );

  const discoveryAcceptedRoutePath =
    browserSourceBoundAssertionPathOf(page.url());
  const discoveryButtonCarrierObservation =
    discoveryAssertionHandoffResult
      ? observeBrowserPage(page)
      : null;
  const discoveryButtonCarrierObservations =
    discoveryButtonCarrierObservation && discoveryAssertionHandoffResult
      ? observeBrowserSourceDerivedButtonCarriers({
          requirements: buildBrowserSourceBoundAssertionSetRequirements({
            testCase,
            assertionSourceCase: genericBrowserAssertionHandoffCase,
            obligationLedger: plan.acceptanceObligationLedger,
            sourceLedger: plan.acceptanceSourceLedger,
            acceptedRoutePath: discoveryAcceptedRoutePath,
          }),
          observation: await discoveryButtonCarrierObservation,
          targetContextGrounded:
            genericBrowserReachedGoal &&
            discoveryAssertionHandoffResult.status === "PASS",
        })
      : [];
  const discoverySourceBoundTelemetry =
    discoveryAssertionHandoffResult
      ? collectBrowserSourceBoundAssertionSetTelemetry({
          testCase,
          assertionSourceCase:
            genericBrowserAssertionHandoffCase,
          allCases: executionCases,
          obligationLedger:
            plan.acceptanceObligationLedger,
          sourceLedger:
            plan.acceptanceSourceLedger,
          browserObligationBindings:
            plan.browserObligationBindings,
          acceptedRoutePath:
            discoveryAcceptedRoutePath,
          deterministicEvidence:
            discoveryAssertionHandoffResult
              .deterministicEvidence ?? [],
          actualPersona: persona,
          freshObservation:
            genericBrowserReachedGoal &&
            discoveryAssertionHandoffResult.status ===
              "PASS",
          buttonCarrierObservations:
            discoveryButtonCarrierObservations,
        })
      : null;

  const discoveryStructuralControlPresenceRequirements =
    genericBrowserReachedGoal
      ? buildBrowserSourceBoundStructuralControlPresenceRequirements({
          testCase,
          executionObligationIds:
            testCase.executionIntentAuthority?.executionObligationIds ??
            testCase.executionVerdictScope?.executionObligationIds ??
            [],
          obligationLedger: plan.acceptanceObligationLedger,
          sourceLedger: plan.acceptanceSourceLedger,
          acceptedRoutePath: discoveryAcceptedRoutePath,
        })
      : [];
  const discoveryStructuralControlPresenceObservation =
    discoveryStructuralControlPresenceRequirements.length > 0
      ? await observeBrowserPage(page)
      : null;
  const discoveryStructuralControlPresenceEvidence =
    discoveryStructuralControlPresenceObservation
      ? discoveryStructuralControlPresenceRequirements.map((requirement) =>
          evaluateBrowserSourceBoundStructuralControlPresence({
            requirement,
            observation: discoveryStructuralControlPresenceObservation,
            actualPersona: persona,
            actualRoutePath: discoveryAcceptedRoutePath,
            freshObservation: true,
          })
        )
      : [];

  if (discoverySourceBoundTelemetry) {
    console.log(
      `${SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_MARKER} ` +
      JSON.stringify(
        summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry({
          caseId: testCase.id,
          persona,
          acceptedRoutePath: discoveryAcceptedRoutePath,
          telemetry: discoverySourceBoundTelemetry,
        })
      )
    );
  }

  genericBrowserUsefulnessCaseRecords.push({
    issueKey:
      String(plan.issueKey || ""),
    caseId:
      String(testCase.id || ""),
    events:
      [...genericBrowserUsefulnessEvents],
    summary:
      genericBrowserUsefulnessSummary,
    capabilityRecognitions:
      [...genericBrowserCapabilityRecognitions],
    capabilityTelemetry:
      genericBrowserCapabilityTelemetry,
    capabilityTelemetryByFamily: {},
  });

  caseRuntimeAudit.completeSafetyAccounting();
  const discoveryFinalizedRuntimeAudit = caseRuntimeAudit.finish();
  const discoveryRuntimeAuditSignals =
    deriveBrowserCaseRuntimeSafetySignals(
      discoveryFinalizedRuntimeAudit
    );
  console.log(
    "BROWSER_DETERMINISTIC_PASS_RUNTIME_AUDIT_V1 " +
      JSON.stringify({
        caseId: testCase.id,
        safetyViolation: discoveryRuntimeAuditSignals.safetyViolation,
        productNonGetCount: discoveryRuntimeAuditSignals.productNonGetCount,
        persistenceViolation: discoveryRuntimeAuditSignals.persistenceViolation,
        testDataIssue: discoveryRuntimeAuditSignals.testDataIssue,
      })
  );

  const discoveryPassProofs = discoverySourceBoundTelemetry
    ? discoverySourceBoundTelemetry.requirements.flatMap((requirement, index) => {
        const allocation = discoverySourceBoundTelemetry.allocations.find((candidate) => candidate.obligationId === requirement.obligationId);
        return allocation ? [{ kind: "SOURCE_BOUND_ASSERTION_SET" as const, requirement, evidence: discoverySourceBoundTelemetry.evidence[index]!, allocation }] : [];
      })
      : [];
  const discoveryStructuralPassProofs =
    discoveryStructuralControlPresenceRequirements.flatMap((requirement, index) =>
      discoveryStructuralControlPresenceEvidence[index]
        ? [{
            kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE" as const,
            requirement,
            evidence: discoveryStructuralControlPresenceEvidence[index]!,
          }]
        : []
    );
  const discoveryRoute = discoveryAcceptedRoutePath;
  /*
   * SOURCE_AUTHORIZED_DISCOVERY_FIXTURE_REQUIREMENT_V1
   *
   * Planner fixture prose is operational guidance, not fixture authority.
   * Only immutable source-authorized fixture references may make a discovery
   * execution fixture-required for canonical case verdict purposes.
   */
  const discoveryFixtureStatus = normalizeBrowserDeterministicPassFixtureStatus({
    path: "DISCOVERY_BYPASS",
    fixtureRequired: testCase.executionIntentAuthority
      ? testCase.executionIntentAuthority.fixtureRequirementRefs.length > 0
      : null,
  });
  const discoveryBindingExecutionId = `browser-runtime:${testCase.id}`;
  const discoveryBindingStateIdentity = [
    testCase.id,
    genericBrowserGoalIteration ?? "none",
    discoveryRoute,
  ].join("\u0000");
  const discoveryBindingAttempt = testCase.executionIntentAuthority &&
      genericBrowserGoalObservation
    ? createValidatedBrowserRuntimeExecutionBinding({
        intent: testCase.executionIntentAuthority,
        actualPersona: persona,
        resolvedRoute: discoveryRoute ?? "UNKNOWN",
        observation: genericBrowserGoalObservation,
        matchedTarget: genericBrowserAttempt.goalMatchedTarget,
        executionId: discoveryBindingExecutionId,
        stateIdentity: discoveryBindingStateIdentity,
        observedMutationClass: genericBrowserExecutedSteps === 0
          ? "READ_ONLY"
          : "TRANSIENT_REVERSIBLE",
        observationId: `${discoveryBindingExecutionId}:goal:${genericBrowserGoalIteration ?? "none"}`,
      })
    : null;
  const discoveryProofSignals = deriveBrowserDeterministicProofRuntimeSignals({
    testCase,
    ...(plan.acceptanceObligationLedger ? { obligationLedger: plan.acceptanceObligationLedger } : {}),
    ...(plan.browserObligationBindings ? { browserObligationBindings: plan.browserObligationBindings } : {}),
    localStateProofs: [],
    sourceBoundAssertionSetProofs: discoveryPassProofs,
    structuralControlPresenceProofs: discoveryStructuralPassProofs,
    deterministicObligationDischarges: discoverySourceBoundTelemetry?.discharges ?? [],
    ...(discoverySourceBoundTelemetry ? { caseProofReadiness: discoverySourceBoundTelemetry.caseProofReadiness } : {}),
    acceptedRoutePath: discoveryRoute,
    actualPersona: persona,
  });
  const discoveryDeterministicPassRuntimeContext = buildBrowserDeterministicPassRuntimeContext({
    fixtureStatus: discoveryFixtureStatus,
    ...(discoveryRoute ? { acceptedRoutePath: { status: "AVAILABLE" as const, value: discoveryRoute, source: "Final accepted discovery route." } } : {}),
    ...discoveryProofSignals,
    ...discoveryRuntimeAuditSignals,
  });
  const discoveryResult: BrowserStepResult = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
    notes: [],
    deterministicPassRuntimeContext: discoveryDeterministicPassRuntimeContext,
    ...(discoveryBindingAttempt?.status === "VALID"
      ? { runtimeExecutionBinding: discoveryBindingAttempt.binding }
      : discoveryBindingAttempt
        ? { runtimeExecutionBindingRejectionReason: discoveryBindingAttempt.reason }
        : {}),
    sourceBoundAssertionSetPassProofs: discoveryPassProofs,
    structuralControlPresenceRequirements:
      discoveryStructuralControlPresenceRequirements,
    structuralControlPresenceEvidence:
      discoveryStructuralControlPresenceEvidence,
    deterministicObligationDischarges:
      discoverySourceBoundTelemetry?.discharges ?? [],
    ...(
      discoverySourceBoundTelemetry
        ? { caseProofReadiness: discoverySourceBoundTelemetry.caseProofReadiness }
        : {}
    ),
  };
  const discoveryVerdictContract =
    materializeBrowserRuntimeExecutionContract({
      testCase,
      executionCheckContract:
        testCase.executionCheckContract,
      acceptedRoutePath: discoveryRoute,
      sourceBoundAssertionSetRequirements:
        discoverySourceBoundTelemetry
          ?.requirements ?? [],
      structuralControlPresenceRequirements:
        discoveryStructuralControlPresenceRequirements,
    });

  if (isOperationalDiscoverySupportUnit(testCase)) {
    discoveryResult.operationalExecution = { kind: "DISCOVERY_ONLY_SUPPORT" };
    discoveryResult.reasonCategory = "OPERATIONAL_DISCOVERY_SUPPORT";
  } else {
    const discoveryCaseVerdict = deriveBrowserCaseVerdict({
    testCase:
      discoveryVerdictContract.testCase,
    ...(
      discoveryVerdictContract
        .executionCheckContract
        ? {
            executionCheckContract:
              discoveryVerdictContract
                .executionCheckContract,
          }
        : {}
    ),
    executionAuthority: {
      actualPersona: {
        status: "AVAILABLE",
        value: persona,
        source: "Final authenticated discovery persona.",
      },
      ...(discoveryRoute
        ? {
            acceptedRoutePath: {
              status: "AVAILABLE" as const,
              value: discoveryRoute,
              source: "Final accepted discovery route.",
            },
          }
        : {
            acceptedRoutePath: {
              status: "UNAVAILABLE" as const,
              reason: "No accepted discovery route was finalized.",
            },
          }),
      targetVerified: discoveryProofSignals.targetVerified,
      fixtureStatus: discoveryFixtureStatus,
    },
    runtimeAudit: discoveryFinalizedRuntimeAudit,
    runnerStatus: discoveryResult.status,
    sourceBoundAssertionSetRequirements:
      discoverySourceBoundTelemetry?.requirements ?? [],
    sourceBoundAssertionSetEvidence:
      discoverySourceBoundTelemetry?.evidence ?? [],
    structuralControlPresenceRequirements:
      discoveryStructuralControlPresenceRequirements,
    structuralControlPresenceEvidence:
      discoveryStructuralControlPresenceEvidence,
    deterministicEvidence:
      discoveryAssertionHandoffResult?.deterministicEvidence ?? [],
  });
    applyBrowserCaseVerdict(discoveryResult, discoveryCaseVerdict);
    attemptDeterministicBrowserPass({
    testCase,
    obligationLedger: plan.acceptanceObligationLedger,
    browserObligationBindings: plan.browserObligationBindings,
    currentResult: discoveryResult,
    localStatePassProofs: [],
    sourceBoundAssertionSetPassProofs: discoveryPassProofs,
    deterministicPassRuntimeContext: discoveryDeterministicPassRuntimeContext,
    });
  }

  results.push({
    id:
      testCase.id,
    status:
      discoveryResult.status,
    reasonCategory:
      discoveryResult.reasonCategory,
    startRoute:
      testCase.startRoute,
    successSignalReached:
      discoveryResult.status === "PASS",
    deterministicPassRuntimeContext: discoveryDeterministicPassRuntimeContext,
    caseVerdict: discoveryResult.caseVerdict,
    structuralControlPresenceRequirements:
      discoveryStructuralControlPresenceRequirements,
    structuralControlPresenceEvidence:
      discoveryStructuralControlPresenceEvidence,
    ...(discoveryResult.operationalExecution
      ? { operationalExecution: discoveryResult.operationalExecution }
      : {}),
    ...(discoveryResult.runtimeExecutionBinding
      ? { runtimeExecutionBinding: discoveryResult.runtimeExecutionBinding }
      : {}),
    ...(discoveryResult.runtimeExecutionBindingRejectionReason
      ? { runtimeExecutionBindingRejectionReason: discoveryResult.runtimeExecutionBindingRejectionReason }
      : {}),
    evidence: [
      "DISCOVERY_ONLY execution completed; deterministic PASS is evaluated only from typed proof authority.",
      `Generic navigation stop: ${
        genericBrowserStopReason ||
        "NO_SAFE_ACTION"
      }`,
      genericBrowserAssertionHandoffCase
        ? `Canonical deterministic assertion probe: ${
            discoveryAssertionHandoffStatus ||
            "UNKNOWN"
          }`
        : "Canonical deterministic assertion probe: unavailable.",
    ].join(" | "),
    sourceBoundAssertionSetRequirements:
      discoverySourceBoundTelemetry?.requirements ?? [],
    sourceBoundAssertionSetEvidence:
      discoverySourceBoundTelemetry?.evidence ?? [],
    runtimeSourceAssertionAllocations:
      discoverySourceBoundTelemetry?.allocations ?? [],
    sourceBoundAssertionSetPassProofs: discoveryPassProofs,
    deterministicObligationDischarges:
      discoverySourceBoundTelemetry?.discharges ?? [],
    ...(
      discoverySourceBoundTelemetry
        ? {
            caseProofReadiness:
              discoverySourceBoundTelemetry
                .caseProofReadiness,
          }
        : {}
    ),
    ...(
      discoveryResult.deterministicPassEligibility
        ? { deterministicPassEligibility: discoveryResult.deterministicPassEligibility }
        : {}
    ),
    ...(
      discoveryResult.deterministicPassValidationContext
        ? { deterministicPassValidationContext: discoveryResult.deterministicPassValidationContext }
        : {}
    ),
  });

  console.log(
    ` Discovery-only execution finalized deterministic verdict evaluation for ${testCase.id}.`
  );

  continue;
}

const restoreFreshCompatibilityPage =
  async (
    reason: string
  ): Promise<void> => {
    const discardedPage = page;
    const discardedVideo =
      discardedPage.video();

    await discardedPage
      .close()
      .catch(() => {});

    const discardedVideoPath =
      discardedVideo
        ? await discardedVideo
            .path()
            .catch(() => null)
        : null;

    if (
      discardedVideoPath &&
      fs.existsSync(discardedVideoPath)
    ) {
      fs.rmSync(
        discardedVideoPath,
        { force: true }
      );
    }

    /*
     * Browser storage and transient page state from the
     * speculative attempt must not leak into compatibility
     * execution.
     */
    await context.clearCookies();

    page = await context.newPage();

    await page.setViewportSize({
      width: 1280,
      height: 720,
    });

    await signInAsPersona(
      page,
      baseUrl,
      persona
    );

    signedInPersona = persona;

    await page.goto(
      targetUrl,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }
    );

    await page.waitForTimeout(1000);

    await page
      .waitForLoadState(
        "networkidle",
        { timeout: 5000 }
      )
      .catch(() => {});

    if (await detectAuthWall(page)) {
      throw new Error(
        `Compatibility fallback could not restore ` +
          `an authenticated fresh browser state for ` +
          `${testCase.id}.`
      );
    }

    console.log(
      ` Generic browser attempt discarded: ` +
        `${reason}; compatibility execution restored ` +
        `from a fresh authenticated page at ` +
        `${page.url()}.`
    );
  };

const genericBrowserNeedsFreshCompatibilityFallback =
  genericBrowserExecutedSteps > 0 &&
  !genericBrowserHasAssertionHandoff;

if (genericBrowserHasAssertionHandoff) {
  console.log(
    ` Generic browser navigation reached the ` +
      `deterministic handoff candidate after ` +
      `${genericBrowserExecutedSteps} verified ` +
      `state-changing action(s); compatibility ` +
      `fallback remains available until canonical ` +
      `deterministic verification passes.`
  );
} else {
  if (
    genericBrowserNeedsFreshCompatibilityFallback
  ) {
    await restoreFreshCompatibilityPage(
      genericBrowserStopReason ||
        "autonomous navigation stopped before deterministic handoff"
    );
  }

  await logVisibleAssessmentControls(
    page,
    testCase
  );

  await prepareAssessmentLanguageModal(
    page,
    testCase
  );
}

/*
 * This flag now means only that the deterministic handoff
 * gets first attempt. A non-PASS handoff falls through to
 * fresh compatibility execution below.
 */
const genericBrowserLegacyReplaySuppressed =
  genericBrowserHasAssertionHandoff;

      const pagesVisited = new Set<string>();
    pagesVisited.add(page.url());

    const authWallDetected = await detectAuthWall(page);

    if (authWallDetected) {
      const screenshotPath = `qa-results/evidence/${testCase.id}-auth-wall.png`;

      await page.screenshot({ path: screenshotPath, fullPage: true });

      const keyVisibleTexts = await collectKeyVisibleTexts(page);

      const trace = buildTraceFromBrowserRun({
        targetUrl,
        finalUrl: page.url(),
        notes: [
          "Authentication wall detected. Browser reached a login/auth page instead of the protected feature route.",
        ],
        screenshotPath,
        finalStatus: "BLOCKED",
      });



      const evidenceSummary: BrowserEvidenceSummary = {
        successSignal,
        successSignalReached: false,
        authWallDetected: true,
        pagesVisited: Array.from(pagesVisited),
        keyVisibleTexts,
      };

      results.push({
        id: testCase.id,
        status: "BLOCKED",
        reasonCategory:
          getBrowserBlockReasonCategory(blockReason!),
        startRoute: testCase.startRoute,
        evidence: [
          screenshotPath,
          "Authentication wall detected",
          `Success signal: ${successSignal}`,
          "Success signal reached: false",
          `Pages visited: ${evidenceSummary.pagesVisited.join(", ") || "none"}`,
          `Key visible texts: ${evidenceSummary.keyVisibleTexts.join(", ") || "none"}`,
          `Trace: ${formatTrace(trace)}`,
        ].join(" | "),
        successSignal,
        successSignalReached: false,
        evidenceSummary,
        trace,
      });

      console.log(" Result: BLOCKED (Authentication wall detected)");
      console.log(` Screenshot Taken: ${screenshotPath}`);
      continue;
    }

      const checkpointEvidence:
        BrowserEvidenceCheckpoint[] = [];

      const checkpointDirectory =
        `qa-results/evidence/` +
        `${testCase.id}-checkpoints`;

      fs.rmSync(
        checkpointDirectory,
        {
          recursive: true,
          force: true,
        }
      );

      fs.mkdirSync(
        checkpointDirectory,
        { recursive: true }
      );

      let fixtureCheckpointCounter = 0;

      const fixturePreparation: BrowserFixturePreparationResult =
        testCase.composedRuntimeResolution
        ? { status: "NOT_APPLICABLE", providerId: null, notes: [],
            deterministicEvidence: [], cleanups: [] }
        : await prepareBrowserFixture({
          issueKey: String(
            plan.issueKey || ""
          ),
          page,
          testCase,
          persona,
          baseUrl,
          ...(
            testCase
              .runtimeResourceContext
              ? {
                  runtimeResourceContext:
                    testCase
                      .runtimeResourceContext,
                }
              : {}
          ),
          registerCleanup: (
            cleanup
          ) => {
            if (
              !deferredCleanups.includes(
                cleanup
              )
            ) {
              deferredCleanups.push(
                cleanup
              );
            }
          },
          captureCheckpoint: async ({
            phase,
            label,
            note,
            fullPage = false,
          }) => {
            fixtureCheckpointCounter += 1;

            const safeLabel = label
              .trim()
              .toLowerCase()
              .replace(
                /[^a-z0-9]+/g,
                "-"
              )
              .replace(
                /^-+|-+$/g,
                ""
              )
              .slice(0, 48);

            const checkpointPath =
              `${checkpointDirectory}/` +
              `${String(
                fixtureCheckpointCounter
              ).padStart(2, "0")}-` +
              `fixture-${phase}-` +
              `${safeLabel || "checkpoint"}.png`;

            await page.screenshot({
              path: checkpointPath,
              fullPage,
            });

            checkpointEvidence.push({
              stepIndex: 0,
              action:
                `fixture-${phase}`,
              label:
                `fixture ${phase} ${label}`,
              note,
              screenshotPath:
                checkpointPath,
              url: page.url(),
            });

            console.log(
              ` Browser fixture checkpoint ` +
                `captured: phase=${phase}, ` +
                `label=${label}, ` +
                `path=${checkpointPath}`
            );
          },
        });

      for (
        const cleanup of
        fixturePreparation.cleanups
      ) {
        if (
          !deferredCleanups.includes(
            cleanup
          )
        ) {
          deferredCleanups.push(
            cleanup
          );
        }
      }

      let stepResult:
        BrowserStepResult | null = null;

      if (
        fixturePreparation.status ===
          "BLOCKED" ||
        fixturePreparation.status ===
          "ERROR"
      ) {
        stepResult = {
          status:
            fixturePreparation.status,
          reasonCategory:
            fixturePreparation
              .reasonCategory,
          notes: [
            `Browser fixture provider ` +
              `"${fixturePreparation.providerId}" ` +
              `returned ` +
              `${fixturePreparation.status}.`,
            ...fixturePreparation.notes,
          ],
          deterministicEvidence: [
            ...fixturePreparation
              .deterministicEvidence,
          ],
        };
      } else if (
        blockReason &&
        fixturePreparation.status ===
          "NOT_APPLICABLE"
      ) {
        stepResult = {
          status: "BLOCKED",
          reasonCategory:
            getBrowserBlockReasonCategory(
              blockReason
            ),
          notes: [
            blockReason,
            "Browser fixture lifecycle did not " +
              "resolve an applicable provider.",
          ],
          deterministicEvidence: [],
        };
} else if (
  genericBrowserLegacyReplaySuppressed
) {
  const assertionHandoffCase =
    genericBrowserAssertionHandoffCase;

  if (!assertionHandoffCase) {
    stepResult = {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      notes: [
        `Generic browser navigation executed ` +
          `${genericBrowserExecutedSteps} safe ` +
          `state-changing action(s) before ` +
          `${
            genericBrowserBudgetExhausted
              ? "reaching the bounded safety fuse"
              : `stopping at ${
                  genericBrowserStopReason ||
                  "a safe terminal boundary"
                }`
          }.`,
        "Legacy compatibility step replay was " +
          "suppressed because autonomous navigation " +
          "already changed the browser state; " +
          "replaying prerequisite navigation from " +
          "an earlier assumed state would not be " +
          "safely grounded.",
        genericBrowserStopReason ===
        "GOAL_ALREADY_SATISFIED"
          ? "No canonical deterministic assertion " +
            "steps were available for autonomous " +
            "assertion handoff."
          : "Canonical assertions were not executed " +
            "because autonomous navigation did not " +
            "reach GOAL_ALREADY_SATISFIED.",
      ],
      deterministicEvidence: [],
    };
  } else {
    const assertionHandoffResult =
      await runGenericBrowserSteps(
        page,
        assertionHandoffCase,
        undefined,
        undefined,
        {
          visibleFieldProvenance,
          executionPersona: persona,
        }
      );

    if (
      genericBrowserGoalIteration !==
      null
    ) {
      genericBrowserUsefulnessEvents.push({
        kind:
          "HANDOFF_RESULT_RECORDED",
        iteration:
          genericBrowserGoalIteration,
        attempted: true,
        passed:
          assertionHandoffResult.status ===
          "PASS",
      });
    }

    const fixtureNotes =
      fixturePreparation.status ===
      "READY"
        ? [
            `Browser fixture provider ` +
              `"${fixturePreparation.providerId}" ` +
              `prepared the required state.`,
            ...fixturePreparation.notes,
          ]
        : [];

    const fixtureEvidence =
      fixturePreparation.status ===
      "READY"
        ? fixturePreparation
            .deterministicEvidence
        : [];

    const assertionHandoffFailed =
      assertionHandoffResult.status ===
      "FAIL";

    if (
      assertionHandoffResult.status ===
      "PASS"
    ) {
      stepResult = {
      ...assertionHandoffResult,

      ...(
        assertionHandoffFailed
          ? {
              status:
                "MANUAL_REQUIRED" as const,
              reasonCategory:
                "AUTOMATION_LIMITATION",
            }
          : {}
      ),

      notes: [
        ...fixtureNotes,

        `Generic browser navigation reached ` +
          `GOAL_ALREADY_SATISFIED after ` +
          `${genericBrowserExecutedSteps} verified ` +
          `state-changing action(s).`,

        "Canonical deterministic assertions were " +
          "executed from the reached state without " +
          "replaying planner-authored interaction steps.",

        ...(
          assertionHandoffFailed
            ? [
                "Assertion mismatch after autonomous " +
                  "navigation was kept verdict-neutral " +
                  "because the autonomous path is not " +
                  "itself a product-failure oracle.",
              ]
            : []
        ),

        ...assertionHandoffResult.notes,
      ],

      deterministicEvidence: [
        ...fixtureEvidence,
        ...(
          assertionHandoffResult
            .deterministicEvidence ??
          []
        ),
      ],
    };
    /*
 * AUTONOMOUS_ACCEPTANCE_CHECKPOINT_V1
 *
 * Autonomous navigation may reach a transient modal, drawer,
 * popover or nested editor state that is later closed during
 * cleanup.
 *
 * Capture the reached acceptance state after canonical
 * deterministic verification and before cleanup. This is
 * supplementary visual evidence only; it is not a deterministic
 * oracle and cannot create PASS by itself.
 */
try {
  const acceptanceCheckpointPath =
    `${checkpointDirectory}/` +
    `acceptance-state.png`;

  await page.screenshot({
    path: acceptanceCheckpointPath,
    fullPage: false,
  });

  checkpointEvidence.push({
    stepIndex: 0,
    action: "acceptance-state",
    label:
      "autonomous acceptance state",
    note:
      "Captured the browser state after canonical deterministic verification and before cleanup.",
    screenshotPath:
      acceptanceCheckpointPath,
    url: page.url(),
  });

  console.log(
    ` Evidence checkpoint captured: ` +
      `action=autonomous acceptance state, ` +
      `path=${acceptanceCheckpointPath}`
  );
} catch (error: any) {
  console.log(
    ` Evidence checkpoint skipped safely: ` +
      `action=autonomous acceptance state, ` +
      `reason=${String(
        error?.message || error
      )}`
  );
}
    } else {
      console.log(
        ` Generic browser deterministic handoff ` +
          `returned ${assertionHandoffResult.status}; ` +
          `the autonomous state will not be accepted.`
      );

      await restoreFreshCompatibilityPage(
        `deterministic handoff returned ` +
          `${assertionHandoffResult.status}`
      );

      await logVisibleAssessmentControls(
        page,
        testCase
      );

      await prepareAssessmentLanguageModal(
        page,
        testCase
      );
    }
  }
}

/*
 * GENERIC_BROWSER_USEFULNESS_STRUCTURED_EMISSION_V1
 *
 * Emit one machine-readable record for the autonomous
 * generic-browser lifecycle.
 *
 * Human-readable Notes / Trace output may repeat terminal
 * outcomes and must not be used as the metric source of truth.
 *
 * Compatibility execution below is intentionally excluded.
 */
if (
  genericBrowserUsefulnessEvents.length >
  0
) {
  const genericBrowserUsefulnessSummary =
    summarizeGenericBrowserUsefulness(
      genericBrowserUsefulnessEvents
    );
  const capabilityEvaluations =
    genericBrowserCapabilityRecognitions.map(
      (recognition) => recognition.evaluation
    );
  const genericBrowserCapabilityTelemetry =
    summarizeBrowserOperationalCapabilities(
      capabilityEvaluations
    );
  const capabilityFamilies = [
    "SELECTED_STATE_OPERATIONAL_CAPABILITY",
    "PAGINATION_OPERATIONAL_CAPABILITY",
  ] as const;
  const genericBrowserCapabilityTelemetryByFamily =
    Object.fromEntries(
      capabilityFamilies.map((capabilityKind) => [
        capabilityKind,
        summarizeBrowserOperationalCapabilities(
          capabilityEvaluations.filter(
            (evaluation) =>
              evaluation.capabilityKind === capabilityKind
          )
        ),
      ])
    );

  genericBrowserUsefulnessCaseRecords.push({
    issueKey:
      String(plan.issueKey || ""),
    caseId:
      String(testCase.id || ""),
    events:
      [...genericBrowserUsefulnessEvents],
    summary:
      genericBrowserUsefulnessSummary,
    capabilityRecognitions:
      [...genericBrowserCapabilityRecognitions],
    capabilityTelemetry:
      genericBrowserCapabilityTelemetry,
    capabilityTelemetryByFamily:
      genericBrowserCapabilityTelemetryByFamily,
  });

  console.log(
    `GENERIC_BROWSER_USEFULNESS_TELEMETRY_V1 ` +
      JSON.stringify({
        issueKey:
          String(plan.issueKey || ""),
        caseId:
          String(testCase.id || ""),
        events:
          genericBrowserUsefulnessEvents,
        summary:
          genericBrowserUsefulnessSummary,
        operationalCapabilities: {
          recognitions:
            genericBrowserCapabilityRecognitions,
          aggregate:
            genericBrowserCapabilityTelemetry,
          byFamily:
            genericBrowserCapabilityTelemetryByFamily,
        },
      })
  );
}

if (!stepResult) {
        const genericStepResult =
          await runGenericBrowserSteps(
          page,
          testCase,
          async ({
            stepIndex,
            step,
            note,
          }) => {
            const rawText =
              "text" in step
                ? String(step.text || "")
                : "";

            /*
             * RUNTIME_EVIDENCE_IDENTITY_V1
             *
             * A compatible-state interaction may replace the
             * planner fixture with a runtime-selected entity.
             * Evidence filenames and labels must identify the
             * entity actually opened, while retaining the
             * originally requested identity for auditability.
             */
            const runtimeInvoiceFixture =
              step.action === "clickText" &&
              testCase?.runtimeInvoiceFixture &&
              typeof testCase.runtimeInvoiceFixture ===
                "object"
                ? testCase.runtimeInvoiceFixture
                : null;

            const runtimeSelectedIdentity =
              String(
                runtimeInvoiceFixture?.selectedInvoice ||
                  ""
              ).trim();

            const runtimeRequestedIdentity =
              String(
                runtimeInvoiceFixture?.requestedInvoice ||
                  rawText ||
                  ""
              ).trim();

            const runtimeFixturePolicy =
              String(
                runtimeInvoiceFixture?.policy || ""
              ).trim();

            const runtimeIdentitySubstituted =
              Boolean(
                runtimeSelectedIdentity &&
                  runtimeRequestedIdentity &&
                  runtimeSelectedIdentity.toLowerCase() !==
                    runtimeRequestedIdentity.toLowerCase()
              );

            const runtimeHandoffIdentity =
              String(
                runtimeInvoiceFixture?.handoffInvoice ||
                  testCase
                    ?.runtimeResourceContext
                    ?.invoiceNumber ||
                  ""
              ).trim();

            const runtimeHandoffMatched =
              Boolean(
                runtimeInvoiceFixture
                  ?.handoffInvoiceMatched
              );

            const rawGenericIdentity =
              testCase
                ?.runtimeEvidenceIdentity;

            const rawSelectionSource =
              String(
                rawGenericIdentity
                  ?.selectionSource ||
                  ""
              ).trim();

            const genericSelectionSource:
              BrowserEvidenceIdentity[
                "selectionSource"
              ] =
              [
                "planner",
                "api-handoff",
                "runtime-discovery",
                "step",
              ].includes(
                rawSelectionSource
              )
                ? rawSelectionSource as
                    BrowserEvidenceIdentity[
                      "selectionSource"
                    ]
                : "step";

            /*
             * GENERIC_STRUCTURED_EVIDENCE_IDENTITY_V2
             *
             * Prefer the common adapter contract. The legacy
             * invoice fixture remains a compatibility fallback
             * until all entity resolvers publish this contract.
             */
            const genericCheckpointIdentity:
              BrowserEvidenceIdentity | null =
              rawGenericIdentity &&
              typeof rawGenericIdentity ===
                "object" &&
              String(
                rawGenericIdentity
                  .checkpointAction ||
                  step.action
              ) === step.action &&
              String(
                rawGenericIdentity
                  .runtimeIdentity ||
                  ""
              ).trim()
                ? {
                    entityType:
                      String(
                        rawGenericIdentity
                          .entityType ||
                          "resource"
                      ).trim(),
                    requestedIdentity:
                      String(
                        rawGenericIdentity
                          .requestedIdentity ||
                          ""
                      ).trim() ||
                      null,
                    runtimeIdentity:
                      String(
                        rawGenericIdentity
                          .runtimeIdentity ||
                          ""
                      ).trim(),
                    handoffIdentity:
                      String(
                        rawGenericIdentity
                          .handoffIdentity ||
                          ""
                      ).trim() ||
                      null,
                    substituted:
                      Boolean(
                        rawGenericIdentity
                          .substituted
                      ),
                    policy:
                      String(
                        rawGenericIdentity
                          .policy ||
                          ""
                      ).trim() ||
                      null,
                    selectionSource:
                      genericSelectionSource,
                  }
                : null;

            const checkpointIdentity:
              BrowserEvidenceIdentity | null =
              genericCheckpointIdentity ??
              (
                runtimeSelectedIdentity
                  ? {
                      entityType:
                        "invoice",
                      requestedIdentity:
                        runtimeRequestedIdentity ||
                        null,
                      runtimeIdentity:
                        runtimeSelectedIdentity,
                      handoffIdentity:
                        runtimeHandoffIdentity ||
                        null,
                      substituted:
                        runtimeIdentitySubstituted,
                      policy:
                        runtimeFixturePolicy ||
                        null,
                      selectionSource:
                        runtimeHandoffMatched
                          ? "api-handoff"
                          : runtimeIdentitySubstituted
                            ? "runtime-discovery"
                            : "planner",
                    }
                  : null
              );

            const evidenceRuntimeIdentity =
              checkpointIdentity
                ?.runtimeIdentity ||
              runtimeSelectedIdentity;

            const evidenceIdentityText =
              evidenceRuntimeIdentity
                ? `${
                    checkpointIdentity
                      ?.entityType ||
                    "resource"
                  }-${evidenceRuntimeIdentity}`
                : rawText;

            const safeText = evidenceIdentityText
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 48);

            const filename = [
              String(stepIndex).padStart(
                2,
                "0"
              ),
              step.action,
              safeText,
            ]
              .filter(Boolean)
              .join("-") + ".png";

            const checkpointPath =
              `${checkpointDirectory}/` +
              filename;

            const label =
              checkpointIdentity
                ?.runtimeIdentity
              ? [
                  step.action,
                  checkpointIdentity
                    .requestedIdentity
                    ? `requested=${
                        checkpointIdentity
                          .requestedIdentity
                      }`
                    : "",
                  `runtime=${
                    checkpointIdentity
                      .entityType
                  }:${
                    checkpointIdentity
                      .runtimeIdentity
                  }`,
                  checkpointIdentity
                    .handoffIdentity
                    ? `handoff=${
                        checkpointIdentity
                          .handoffIdentity
                      }`
                    : "",
                  `substituted=${
                    checkpointIdentity
                      .substituted
                  }`,
                  checkpointIdentity.policy
                    ? `policy=${
                        checkpointIdentity
                          .policy
                      }`
                    : "",
                  `source=${
                    checkpointIdentity
                      .selectionSource
                  }`,
                ]
                  .filter(Boolean)
                  .join(" ")
              : rawText
                ? `${step.action} ${rawText}`
                : step.action;

            /*
             * TRANSIENT_SURFACE_CHECKPOINT_V1
             *
             * Full-page screenshots may temporarily scroll or
             * resize the page and close an open menu/popover.
             * Capture transient expanded surfaces using the
             * current viewport so following assertions observe
             * the same UI state.
             */
            const preserveTransientSurface =
              step.action ===
                "openRuntimeControl" ||
              step.action === "openMenu";

            try {
              await page.screenshot({
                path: checkpointPath,
                fullPage:
                  !preserveTransientSurface,
              });

              checkpointEvidence.push({
                stepIndex,
                action: step.action,
                label,
                note,
                screenshotPath:
                  checkpointPath,
                url: page.url(),
                ...(checkpointIdentity
                  ? {
                      identity:
                        checkpointIdentity,
                    }
                  : {}),
              });

              console.log(
                ` Evidence checkpoint captured: ` +
                  `step=${stepIndex}, ` +
                  `action=${label}, ` +
                  `path=${checkpointPath}`
              );
            } catch (error: any) {
              console.log(
                ` Evidence checkpoint skipped safely: ` +
                  `step=${stepIndex}, ` +
                  `action=${label}, ` +
                  `reason=${String(
                    error?.message || error
                  )}`
              );
            }
          },
          (cleanup) => {
deferredCleanups.push(
  cleanup
);
          },
          {
            visibleFieldProvenance,
            executionPersona: persona,
          }
        );

        const fixtureNotes =
          fixturePreparation.status ===
            "READY"
            ? [
                `Browser fixture provider ` +
                  `"${fixturePreparation.providerId}" ` +
                  `prepared the required state.`,
                ...fixturePreparation.notes,
              ]
            : [];

        const fixtureEvidence =
          fixturePreparation.status ===
            "READY"
            ? fixturePreparation
                .deterministicEvidence
            : [];

        stepResult = {
          ...genericStepResult,
          notes: [
            ...fixtureNotes,
            ...genericStepResult.notes,
          ],
          deterministicEvidence: [
            ...fixtureEvidence,
            ...(
              genericStepResult
                .deterministicEvidence ??
              []
            ),
          ],
        };
      }

      if (
        (testCase.deterministicProofBindings?.length ?? 0) > 0 &&
        !["BLOCKED", "ERROR"].includes(stepResult.status)
      ) {
        stepResult.runtimeFixturePreparations =
          mergeRuntimeFixturePreparations(
            preGenericFixtureDispatch.preparations,
            stepResult.runtimeFixturePreparations ?? []
          );
        const proofResults = await executeBrowserEvidenceContractProofs({
          page,
          testCase,
          actualPersona: persona,
          deterministicEvidence:
            stepResult.deterministicEvidence ?? [],
          runtimeFixturePreparations:
            stepResult.runtimeFixturePreparations ?? [],
        });
        runProofResults.push(...proofResults);
        stepResult.evidenceContractProofResults = proofResults;
        stepResult.evidenceContractProofCoverage =
          summarizeBrowserEvidenceContractProofCoverage({
            bindings: testCase.deterministicProofBindings ?? [],
            results: proofResults,
          });
      }

      /*
       * SOURCE_BOUND_ASSERTION_SET_RUNTIME_V1
       *
       * Canonical assertion handoff remains the normal source-bound proof
       * owner. A second, narrower path exists only for source-derived exact
       * button presence on an already confirmed composed runtime target.
       *
       * COMPOSED_RUNTIME_STRUCTURAL_TARGET_PROOF_V1
       *
       * Composed preparation independently verifies persona, ownership,
       * fixture predicates, entity identity, and the exact concrete route.
       *
       * It may ground a fresh structural BUTTON_LABEL observation only when:
       * - autonomous navigation reached its terminal goal;
       * - no generic state-changing action executed;
       * - planner compatibility steps are observation-only;
       * - the browser is still on the exact composed route.
       *
       * Planner prose and GOAL_ALREADY_SATISFIED never create proof authority.
       */
      const sourceBoundAcceptedRoutePath =
        browserSourceBoundAssertionPathOf(
          page.url()
        );

      const sourceBoundComposedPreparation =
        testCase.composedRuntimeResolution
          ? composedPreparations.get(
              testCase.id
            )
          : undefined;

      const sourceBoundComposedPlannerStepsObservationOnly =
        (testCase.steps ?? []).every(
          (step: BrowserStep) =>
            [
              "wait",
              "assertUrlContains",
              "assertUrlNotContains",
              "assertTextVisible",
              "assertTextNotVisible",
              "assertSurfaceControls",
            ].includes(
              String(step?.action || "")
            )
        );

      const sourceBoundComposedTargetGrounded =
        Boolean(
          !testCase.executionPolicy &&
          testCase.composedRuntimeResolution &&
          genericBrowserReachedGoal &&
          genericBrowserExecutedSteps === 0 &&
          sourceBoundComposedPlannerStepsObservationOnly &&
          sourceBoundComposedPreparation &&
          composedPreparationAllowsInteraction(
            testCase,
            sourceBoundComposedPreparation,
            persona
          ) &&
          sourceBoundAcceptedRoutePath &&
          browserSourceBoundAssertionPathOf(
            String(
              sourceBoundComposedPreparation
                .navigationBinding
                ?.concreteRoute || ""
            )
          ) === sourceBoundAcceptedRoutePath
        );

      if (
        !testCase.executionPolicy &&
        (
          genericBrowserHasAssertionHandoff ||
          sourceBoundComposedTargetGrounded
        )
      ) {
        const allRequirements =
          buildBrowserSourceBoundAssertionSetRequirements({
            testCase,
            obligationLedger:
              plan.acceptanceObligationLedger,
            sourceLedger:
              plan.acceptanceSourceLedger,
            acceptedRoutePath:
              sourceBoundAcceptedRoutePath,
          });

        /*
         * Without canonical assertion handoff, composed target grounding may
         * transport only the pre-existing source-derived exact-button family.
         * General text assertions remain closed.
         */
        const requirements =
          genericBrowserHasAssertionHandoff
            ? allRequirements
            : allRequirements.filter(
                (requirement) =>
                  requirement.semanticFamily ===
                    "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1" &&
                  requirement.buttonCarrier?.kind ===
                    "SOURCE_DERIVED_EXACT_VISIBLE_BUTTON"
              );
        const allocations =
          allocateBrowserRuntimeSourceAssertions({
            currentCase: testCase,
            allCases: executionCases,
            obligationLedger:
              plan.acceptanceObligationLedger,
            requirements,
          });
        const buttonCarrierObservations =
          observeBrowserSourceDerivedButtonCarriers({
            requirements,
            observation: await observeBrowserPage(page),
            targetContextGrounded:
              (
                genericBrowserReachedGoal &&
                genericBrowserHasAssertionHandoff
              ) ||
              sourceBoundComposedTargetGrounded,
          });
        const evidence = requirements.map(
          (requirement) =>
            evaluateBrowserSourceBoundAssertionSet({
              requirement,
              deterministicEvidence:
                stepResult.deterministicEvidence ?? [],
              actualPersona: persona,
              actualRoutePath:
                sourceBoundAcceptedRoutePath,
              freshObservation:
                (
                  genericBrowserReachedGoal &&
                  genericBrowserHasAssertionHandoff
                ) ||
                sourceBoundComposedTargetGrounded,
              buttonCarrierObservations,
            })
        );
        const discharges = requirements.flatMap(
          (requirement, index) => {
            const decision =
              evaluateBrowserSourceBoundAssertionSetDischarge({
                testCase,
                obligationLedger:
                  plan.acceptanceObligationLedger,
                allocation: allocations.find(
                  (allocation) =>
                    allocation.obligationId ===
                    requirement.obligationId
                ),
                requirement,
                evidence: evidence[index]!,
              });
            return decision.status ===
              "DETERMINISTIC_OBLIGATION_PROVED"
              ? [decision.discharge]
              : [];
          }
        );
        stepResult.sourceBoundAssertionSetRequirements =
          requirements;
        stepResult.sourceBoundAssertionSetEvidence = evidence;
        stepResult.runtimeSourceAssertionAllocations =
          allocations;
        stepResult.sourceBoundAssertionSetPassProofs =
          requirements.flatMap((requirement, index) => {
            const allocation = allocations.find(
              (candidate) =>
                candidate.obligationId === requirement.obligationId
            );
            return allocation
              ? [{
                  kind: "SOURCE_BOUND_ASSERTION_SET" as const,
                  requirement,
                  evidence: evidence[index]!,
                  allocation,
                }]
              : [];
          });
        stepResult.deterministicObligationDischarges = [
          ...(stepResult.deterministicObligationDischarges ?? []),
          ...discharges,
        ];
        stepResult.caseProofReadiness =
          auditBrowserCaseProofReadiness({
            testCase,
            discharges:
              stepResult.deterministicObligationDischarges,
            browserObligationBindings:
              plan.browserObligationBindings,
          });
      }

      /*
       * SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_V1
       *
       * A terminal autonomous navigation result merely permits a fresh
       * observation. The source ledger, not that terminal result, creates
       * the structural requirement; missing observations stay non-confirming.
       */
      if (!testCase.executionPolicy && genericBrowserReachedGoal) {
        const structuralRequirements =
          buildBrowserSourceBoundStructuralControlPresenceRequirements({
            testCase,
            executionObligationIds:
              testCase.executionIntentAuthority?.executionObligationIds ??
              testCase.executionVerdictScope?.executionObligationIds ?? [],
            obligationLedger: plan.acceptanceObligationLedger,
            sourceLedger: plan.acceptanceSourceLedger,
            acceptedRoutePath: sourceBoundAcceptedRoutePath,
          });
        if (structuralRequirements.length > 0) {
          const observation = await observeBrowserPage(page);
          stepResult.structuralControlPresenceRequirements = structuralRequirements;
          stepResult.structuralControlPresenceEvidence = structuralRequirements.map((requirement) =>
            evaluateBrowserSourceBoundStructuralControlPresence({
              requirement,
              observation,
              actualPersona: persona,
              actualRoutePath: sourceBoundAcceptedRoutePath,
              freshObservation: true,
            })
          );
        }
      }

      const passSemanticGuardReason =
        stepResult.status === "PASS"
          ? getBrowserPassSemanticGuardReason({
              testCase,
              finalUrl: page.url(),
            })
          : null;

      if (passSemanticGuardReason) {
        stepResult.status =
          "MANUAL_REQUIRED";

        stepResult.reasonCategory =
          "AUTOMATION_LIMITATION";

        stepResult.notes.push(
          passSemanticGuardReason
        );

        console.log(
          ` Browser PASS semantic guard: ` +
            passSemanticGuardReason
        );
      }
      const manualAcceptanceCoverageGapReason =
        stepResult.status === "PASS"
          ? getBrowserManualAcceptanceCoverageGapReason(
              testCase,
              stepResult
            )
          : null;

      if (manualAcceptanceCoverageGapReason) {
        stepResult.status =
          "MANUAL_REQUIRED";
        stepResult.reasonCategory =
          "ACCEPTANCE_COVERAGE_GAP";
        stepResult.notes.push(
          manualAcceptanceCoverageGapReason
        );

        console.log(
          " Browser PASS acceptance completeness guard: " +
            manualAcceptanceCoverageGapReason
        );
      }

      const screenshotPath =
        `qa-results/evidence/` +
        `${testCase.id}-screenshot.png`;

      /*
       * Preserve the URL and visible page state before
       * the exact created resource is deleted.
       */
      const evidenceUrl = page.url();

      pagesVisited.add(evidenceUrl);

      let keyVisibleTexts: string[] = [];
      let screenshotFailure:
        unknown = null;

      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });

        keyVisibleTexts =
          await collectKeyVisibleTexts(
            page
          );
      } catch (error: unknown) {
        screenshotFailure = error;
      } finally {
        const cleanupExecution =
await executeDeferredCleanups(
  deferredCleanups
);

        deferredCleanupExecuted = true;

        caseRuntimeAudit.recordPersistence(
          cleanupExecution.ok
            ? "CLEAN"
            : "VIOLATION"
        );

        stepResult.notes.push(
          ...cleanupExecution.notes
        );

        stepResult.deterministicEvidence = [
          ...(
            stepResult
              .deterministicEvidence ??
            []
          ),
          ...cleanupExecution
            .deterministicEvidence,
        ];

        if (!cleanupExecution.ok) {
          stepResult.status = "ERROR";
          stepResult.reasonCategory =
            "CLEANUP_FAILED";

          stepResult.notes.push(
            "ERROR: CLEANUP_FAILED: Browser " +
            "evidence was captured, but one " +
            "or more exact deferred cleanups " +
            "failed."
          );
        }
      }

      if (screenshotFailure) {
        throw screenshotFailure;
      }

      await cancelAssessmentEditIfOpen(
        page,
        testCase
      );

      let evidenceReview: Awaited<
        ReturnType<typeof reviewBrowserEvidence>
      > = null;

      if (
        [
          "PASS",
          "FAIL",
          "MANUAL_REQUIRED",
        ].includes(
          stepResult.status
        )
      ) {
pendingEvidenceReviews.push({
  testCase,
  evidenceReviewCase:
    buildEvidenceReviewCase(
      testCase
    ),
  currentStatus:
            stepResult.status as
              | "PASS"
              | "FAIL"
              | "MANUAL_REQUIRED",
          currentReasonCategory:
            String(
              stepResult.reasonCategory ||
                "BROWSER_ASSERTION_FAILED"
            ),
          screenshotPath,
          checkpointEvidence: [
            ...checkpointEvidence,
          ],
          deterministicEvidence: [
            ...(
              stepResult
                .deterministicEvidence ??
              []
            ),
          ],
          currentUrl: evidenceUrl,
          notes: [
            ...stepResult.notes,
          ],
        });

        console.log(
          stepResult.status === "PASS"
            ? " PASS evidence audit queued for post-processing."
            : " Evidence review queued for post-processing."
        );
      }

      const successSignalReached =
        stepResult.status === "PASS";

      const trace = buildTraceFromBrowserRun({
        targetUrl,
        finalUrl: evidenceUrl,
        notes: stepResult.notes,
        screenshotPath,
        checkpointEvidence,
        finalStatus: stepResult.status,
      });

      const evidenceReviewText = "";

      const evidenceSummary: BrowserEvidenceSummary = {
        successSignal,
        successSignalReached,
        authWallDetected: false,
        pagesVisited: Array.from(pagesVisited),
        keyVisibleTexts,
      };

      console.log(` Screenshot Taken: ${screenshotPath}`);
      console.log(` Result: ${stepResult.status}`);
      console.log(` Success signal reached: ${successSignalReached ? "yes" : "no"}`);

      if (stepResult.notes.length > 0) {
        console.log(` Notes: ${stepResult.notes.join(" | ")}`);
      }

      console.log(` Trace: ${formatTrace(trace)}`);

      if (stepResult.reasonCategory === "TEST_DATA_ISSUE") {
        caseRuntimeAudit.recordTestData("TEST_DATA_ISSUE");
      }
      caseRuntimeAudit.completeSafetyAccounting();
      const finalizedRuntimeAudit = caseRuntimeAudit.finish();
      const runtimeAuditSignals =
        deriveBrowserCaseRuntimeSafetySignals(
          finalizedRuntimeAudit
        );
      console.log(
        "BROWSER_DETERMINISTIC_PASS_RUNTIME_AUDIT_V1 " +
          JSON.stringify({
            caseId: testCase.id,
            safetyViolation: runtimeAuditSignals.safetyViolation,
            productNonGetCount: runtimeAuditSignals.productNonGetCount,
            persistenceViolation: runtimeAuditSignals.persistenceViolation,
            testDataIssue: runtimeAuditSignals.testDataIssue,
        })
      );

      const finalizedComposedPreparation =
        testCase.composedRuntimeResolution
          ? composedPreparations.get(
              testCase.id
            )
          : undefined;

      const fixtureStatus =
        testCase.composedRuntimeResolution
          ? finalizedComposedPreparation
            ? normalizeBrowserDeterministicPassFixtureStatus({
                path: "COMPOSED",
                result:
                  finalizedComposedPreparation,
              })
            : {
                status:
                  "UNAVAILABLE" as const,
                reason:
                  "Composed runtime preparation was not retained for final verdict derivation.",
              }
          : fixturePreparation.status ===
              "READY"
            ? normalizeBrowserDeterministicPassFixtureStatus({
                path: "PREPARATION",
                result: fixturePreparation,
                fixtureRequired: true,
              })
            : normalizeBrowserDeterministicPassFixtureStatus({
              path: "RUNTIME_RESOLUTION",
                result:
                  preGenericFixtureDispatch,
              });
      const structuralControlPresenceProofs =
        (stepResult.structuralControlPresenceRequirements ?? []).flatMap((requirement) => {
          const matchingEvidence =
            (stepResult.structuralControlPresenceEvidence ?? []).filter((evidence) =>
              evidence.proofRequirementId === requirement.requirementId &&
              evidence.obligationId === requirement.obligationId &&
              evidence.executionCaseId === requirement.executionCaseId
            );
          const evidence = matchingEvidence[0];
          return matchingEvidence.length === 1 && evidence
            ? [{ requirement, evidence }]
            : [];
        });
      const proofSignals = deriveBrowserDeterministicProofRuntimeSignals({
        testCase,
        ...(plan.acceptanceObligationLedger ? { obligationLedger: plan.acceptanceObligationLedger } : {}),
        ...(plan.browserObligationBindings ? { browserObligationBindings: plan.browserObligationBindings } : {}),
        localStateProofs: stepResult.localStatePassProofs ?? [],
        sourceBoundAssertionSetProofs: stepResult.sourceBoundAssertionSetPassProofs ?? [],
        structuralControlPresenceProofs,
        deterministicObligationDischarges: stepResult.deterministicObligationDischarges ?? [],
        ...(stepResult.caseProofReadiness ? { caseProofReadiness: stepResult.caseProofReadiness } : {}),
        acceptedRoutePath: browserSourceBoundAssertionPathOf(page.url()),
        actualPersona: persona,
      });
      const deterministicPassRuntimeContext = buildBrowserDeterministicPassRuntimeContext({
        fixtureStatus,
        ...(browserSourceBoundAssertionPathOf(page.url()) ? { acceptedRoutePath: { status: "AVAILABLE" as const, value: browserSourceBoundAssertionPathOf(page.url())!, source: "Final accepted runtime route." } } : {}),
        ...proofSignals,
        ...runtimeAuditSignals,
      });
      stepResult.deterministicPassRuntimeContext = deterministicPassRuntimeContext;
      const acceptedRoutePath =
        browserSourceBoundAssertionPathOf(
          page.url()
        );

      const runtimeVerdictContract =
        materializeBrowserRuntimeExecutionContract({
          testCase,
          executionCheckContract:
            testCase.executionCheckContract,
          acceptedRoutePath,
          sourceBoundAssertionSetRequirements:
            stepResult
              .sourceBoundAssertionSetRequirements ??
            [],
          structuralControlPresenceRequirements:
            stepResult.structuralControlPresenceRequirements ?? [],
        });

      const caseVerdict = deriveBrowserCaseVerdict({
        testCase:
          runtimeVerdictContract.testCase,
        ...(
          runtimeVerdictContract
            .executionCheckContract
            ? {
                executionCheckContract:
                  runtimeVerdictContract
                    .executionCheckContract,
              }
            : {}
        ),
        executionAuthority: {
          actualPersona: {
            status: "AVAILABLE",
            value: persona,
            source: "Final authenticated browser persona.",
          },
          ...(acceptedRoutePath
            ? {
                acceptedRoutePath: {
                  status: "AVAILABLE" as const,
                  value: acceptedRoutePath,
                  source: "Final accepted runtime route.",
                },
              }
            : {
                acceptedRoutePath: {
                  status: "UNAVAILABLE" as const,
                  reason: "No accepted runtime route was finalized.",
                },
              }),
          targetVerified: proofSignals.targetVerified,
          fixtureStatus,
        },
        runtimeAudit: finalizedRuntimeAudit,
        runnerStatus: stepResult.status,
        sourceBoundAssertionSetRequirements:
          stepResult.sourceBoundAssertionSetRequirements ?? [],
        sourceBoundAssertionSetEvidence:
          stepResult.sourceBoundAssertionSetEvidence ?? [],
        structuralControlPresenceRequirements:
          stepResult.structuralControlPresenceRequirements ?? [],
        structuralControlPresenceEvidence:
          stepResult.structuralControlPresenceEvidence ?? [],
        deterministicEvidence: stepResult.deterministicEvidence ?? [],
        localStateTransitionEvidence:
          stepResult.localStateTransitionEvidence ?? [],
        evidenceContractProofResults:
          stepResult.evidenceContractProofResults ?? [],
      });
      applyBrowserCaseVerdict(stepResult, caseVerdict);
      attemptDeterministicBrowserPass({
        testCase,
        obligationLedger: plan.acceptanceObligationLedger,
        browserObligationBindings: plan.browserObligationBindings,
        currentResult: stepResult,
        localStatePassProofs: stepResult.localStatePassProofs ?? [],
        sourceBoundAssertionSetPassProofs:
          stepResult.sourceBoundAssertionSetPassProofs ?? [],
        deterministicPassRuntimeContext,
      });

      results.push({
        id: testCase.id,
        status: stepResult.status,
        reasonCategory: stepResult.reasonCategory,
        deterministicPassRuntimeContext,
        caseVerdict: stepResult.caseVerdict,
        evidenceReview,
        startRoute: testCase.startRoute,
        evidence: [
          screenshotPath,
          checkpointEvidence.length > 0
            ? `Evidence checkpoints: ` +
              checkpointEvidence
                .map(
                  (checkpoint) =>
                    `${checkpoint.label}=` +
                    checkpoint.screenshotPath
                )
                .join(", ")
            : "",
          (
            stepResult
              .deterministicEvidence
              ?.length ?? 0
          ) > 0
            ? `Deterministic evidence: ` +
              stepResult
                .deterministicEvidence!
                .map(
                  (item) =>
                    `step ${item.stepIndex} ` +
                    `${item.action} ` +
                    `"${item.expected}"=` +
                    `${
                      item.passed
                        ? "PASS"
                        : "FAIL"
                    } ` +
                    `actual=${
                      item.actualUrl ||
                      "(non-URL machine evidence)"
                    }`
                )
                .join(", ")
            : "",
          (
            stepResult.orderingEvidence
              ?.length ?? 0
          ) > 0
            ? `Ordering evidence (verdict-neutral): ` +
              stepResult.orderingEvidence!
                .map((item) =>
                  `${item.requirementId}=${item.status} ` +
                  `semantic=${item.semanticDimension || "unavailable"} ` +
                  `${item.direction}/${item.comparisonType} ` +
                  `collection=${item.collectionLabel || "unavailable"} ` +
                  `identity=${item.collectionIdentityMethod || "unavailable"} ` +
                  `schema=${JSON.stringify(item.visibleFields || [])} ` +
                  `rows=${item.rowCount} ` +
                  `rowIdentities=${item.groundedRowIdentityCount ?? 0} ` +
                  `rowSequence=${item.rowSequenceObserved === true ? "observed" : "unavailable"} ` +
                  `requirementField=${item.requirementField || "unavailable"} ` +
                  `proofField=${item.proofField || "unavailable"} ` +
                  `binding=${item.proofFieldBindingId || "unavailable"} ` +
                  `proposalSource=${item.proofFieldProposalSource || "unavailable"} ` +
                  `authority=${item.proofFieldAuthority || "unavailable"} ` +
                  `bindingSourceRef=${item.proofFieldSourceRef || "unavailable"} ` +
                  `field=${item.field || "unavailable"} ` +
                  `mapping=${item.mappingResolutionStatus || "unavailable"} ` +
                  `mappingKind=${item.mappingKind || "unavailable"} ` +
                  `sourceFields=${JSON.stringify(item.mappingSourceFields || [])} ` +
                  `sourceRef=${item.mappingSourceRef ? JSON.stringify(item.mappingSourceRef) : "unavailable"} ` +
                  `sourceCommitRef=${item.mappingSourceCommitRef || "unavailable"} ` +
                  `reason=${item.reason || "none"} ` +
                  `values=${JSON.stringify(item.values)}`
                )
                .join(", ")
            : "",
          (
            stepResult
              .runtimeTopTabObservations
              ?.length ?? 0
          ) > 0
            ? `Runtime tab observations: ` +
              stepResult
                .runtimeTopTabObservations!
                .map(
                  (item) =>
                    `step ${item.stepIndex} ` +
                    `target="${item.targetTabLabel}" ` +
                    `observedActive=${
                      item.observedActiveTabLabel
                        ? `"${item.observedActiveTabLabel}"`
                        : "none"
                    } ` +
                    `activeStateVerified=${item.activeStateVerified} ` +
                    `source=${item.activeStateSource ?? "none"} ` +
                    `urlChanged=${item.urlChanged}`
                )
                .join(", ")
            : "",
          (
            stepResult
              .expandedSurfaceObservations
              ?.length ?? 0
          ) > 0
            ? `Expanded surface observations: ` +
              stepResult
                .expandedSurfaceObservations!
                .map(
                  (item) =>
                    `step ${item.stepIndex} ` +
                    `trigger="${item.triggerText}" ` +
                    `context=${
                      item.contextText
                        ? `"${item.contextText}"`
                        : "none"
                    } ` +
                    `interactionSucceeded=${item.interactionSucceeded} ` +
                    `expandedSurfaceVerified=${item.expandedSurfaceVerified} ` +
                    `surface=${item.surfaceType ?? "none"} ` +
                    `name=${
                      item.surfaceName
                        ? `"${item.surfaceName}"`
                        : "none"
                    } ` +
                    `source=${item.verificationSource ?? "none"}`
                )
                .join(", ")
            : "",
          `Success signal: ${successSignal}`,
          `Success signal reached: ${successSignalReached}`,
          evidenceReviewText,
          `Pages visited: ${evidenceSummary.pagesVisited.join(", ") || "none"}`,
          `Key visible texts: ${evidenceSummary.keyVisibleTexts.join(", ") || "none"}`,
          stepResult.notes.length > 0 ? `Notes: ${stepResult.notes.join(" | ")}` : "",
          `Trace: ${formatTrace(trace)}`,
        ]
          .filter(Boolean)
          .join(" | "),
        successSignal,
        successSignalReached,
        evidenceSummary,
checkpointEvidence,
deterministicEvidence:
  stepResult.deterministicEvidence ??
  [],
...(
  stepResult.terminationReason
    ? {
        terminationReason:
          stepResult.terminationReason,
      }
    : {}
),
collectionFilterEvidence:
  stepResult.collectionFilterEvidence ??
  [],
localStateTransitionEvidence:
  stepResult.localStateTransitionEvidence ??
  [],
deterministicObligationDischarges:
  stepResult.deterministicObligationDischarges ??
  [],
sourceBoundAssertionSetRequirements:
  stepResult.sourceBoundAssertionSetRequirements ??
  [],
sourceBoundAssertionSetEvidence:
  stepResult.sourceBoundAssertionSetEvidence ??
  [],
runtimeSourceAssertionAllocations:
  stepResult.runtimeSourceAssertionAllocations ??
  [],
sourceBoundAssertionSetPassProofs:
  stepResult.sourceBoundAssertionSetPassProofs ??
  [],
localStatePassProofs:
  stepResult.localStatePassProofs ??
  [],
...(
  stepResult.caseProofReadiness
    ? {
        caseProofReadiness:
          stepResult.caseProofReadiness,
      }
    : {}
),
...(
  stepResult.deterministicPassEligibility
    ? {
        deterministicPassEligibility:
          stepResult.deterministicPassEligibility,
      }
    : {}
),
...(
  stepResult.deterministicPassValidationContext
    ? {
        deterministicPassValidationContext:
          stepResult.deterministicPassValidationContext,
      }
    : {}
),
orderingEvidence:
  stepResult.orderingEvidence ??
  [],
orderingEvidenceParity:
  stepResult.orderingEvidenceParity,
interactionExecutionEvidence:
  stepResult
    .interactionExecutionEvidence ??
  [],
runtimeTopTabObservations:
  stepResult
    .runtimeTopTabObservations ??
  [],
expandedSurfaceObservations:
  stepResult
    .expandedSurfaceObservations ??
  [],
runtimeFixturePreparations:
  stepResult
    .runtimeFixturePreparations ??
  [],
evidenceContractProofResults:
  stepResult
    .evidenceContractProofResults ??
  [],
evidenceContractProofCoverage:
  stepResult
    .evidenceContractProofCoverage ??
  [],
trace,
      });
    } catch (error: any) {
      console.log(` Error: ${error.message}`);
      const runnerErrorCaseVerdict = deriveBrowserCaseVerdict({
        testCase,
        executionCheckContract: testCase.executionCheckContract,
        executionAuthority: {
          actualPersona: {
            status: "UNAVAILABLE",
            reason: "Runner terminated before a final persona authority could be recorded.",
          },
          acceptedRoutePath: {
            status: "UNAVAILABLE",
            reason: "Runner terminated before a final route authority could be recorded.",
          },
          targetVerified: {
            status: "UNAVAILABLE",
            reason: "Runner terminated before final target verification.",
          },
          fixtureStatus: {
            status: "UNAVAILABLE",
            reason: "Runner terminated before a final fixture lifecycle result.",
          },
        },
        runnerStatus: "ERROR",
      });
      results.push({
        id: testCase.id,
        status: "ERROR",
        reasonCategory: "AGENT_RUNTIME_ERROR",
        startRoute: testCase.startRoute,
        evidence: error.message,
        caseVerdict: runnerErrorCaseVerdict,
      });
    } finally {
      /*
       * Last-resort orphan prevention. Normal execution
       * already cleans up after final evidence capture.
       */
      if (
        !deferredCleanupExecuted &&
deferredCleanups.length > 0
      ) {
        const fallbackCleanup =
await executeDeferredCleanups(
  deferredCleanups
);

        deferredCleanupExecuted = true;

        const fallbackResult = [
          ...results,
        ]
          .reverse()
          .find(
            (item: any) =>
              item.id === testCase.id
          );

        if (fallbackResult) {
          fallbackResult.evidence = [
            fallbackResult.evidence,
            ...fallbackCleanup.notes,
          ]
            .filter(Boolean)
            .join(" | ");

          if (!fallbackCleanup.ok) {
            fallbackResult.status = "ERROR";
            fallbackResult.reasonCategory =
              "CLEANUP_FAILED";
            fallbackResult
              .successSignalReached = false;

            if (
              fallbackResult.evidenceSummary
            ) {
              fallbackResult
                .evidenceSummary
                .successSignalReached = false;
            }
          }
        }
      }

      const video = page.video();

      await page.close().catch(() => {});

      const rawVideoPath = video
        ? await video.path().catch(
            () => null
          )
        : null;

      if (rawVideoPath) {
        const issueKey = String(
          plan.issueKey ||
            "unknown-issue"
        );

        const caseVideoPath =
          `qa-results/videos/` +
          `${issueKey}-${testCase.id}.webm`;

        if (
          fs.existsSync(caseVideoPath)
        ) {
          fs.rmSync(caseVideoPath);
        }

        fs.renameSync(
          rawVideoPath,
          caseVideoPath
        );

        const currentResult = [
          ...results,
        ]
          .reverse()
          .find(
            (item: any) =>
              item.id === testCase.id
          );

        if (currentResult) {
          currentResult.videoPath =
            caseVideoPath;

          currentResult.evidence = [
            currentResult.evidence,
            `Video: ${caseVideoPath}`,
          ]
            .filter(Boolean)
            .join(" | ");
        }

        console.log(
          ` Video finalized: ` +
            `${caseVideoPath}`
        );
      }
    }
  }

  await context.close();
  await browser.close();
  await stagehand.close();

  console.log(
    "\nBrowser automation completed."
  );

  if (
    pendingEvidenceReviews.length > 0
  ) {
    console.log(
      "Evidence post-processing starting..."
    );
  }

  for (
    const pendingReview
    of pendingEvidenceReviews
  ) {
    const currentResult = [
      ...results,
    ]
      .reverse()
      .find(
        (item: any) =>
          item.id ===
          pendingReview.testCase.id
      );

    if (!currentResult) {
      continue;
    }

const evidenceReview =
  await reviewBrowserEvidence({
    testCase:
      pendingReview
        .evidenceReviewCase,
        currentStatus:
          pendingReview.currentStatus,
        currentReasonCategory:
          pendingReview
            .currentReasonCategory,
        screenshotPath:
          pendingReview.screenshotPath,
        checkpointEvidence:
          pendingReview.checkpointEvidence,
        deterministicEvidence:
          pendingReview.deterministicEvidence,
        currentUrl:
          pendingReview.currentUrl,
        notes:
          pendingReview.notes,
      });

    if (!evidenceReview) {
      /*
       * CANONICAL_CASE_VERDICT_SURVIVES_UNAVAILABLE_VISUAL_REVIEW_V1
       *
       * Screenshot/video review is supplementary. Once a typed canonical
       * caseVerdict exists, review unavailability cannot independently
       * replace that verdict with MANUAL_REQUIRED.
       *
       * Legacy results without caseVerdict retain the historical fallback
       * behavior below.
       */
      if (currentResult.caseVerdict) {
        reconcileBrowserResultFromEvidence({
          currentResult,
          testCase:
            pendingReview.testCase,
          review: null,
          source: "screenshot",
        });

        console.log(
          ` Evidence reconciliation: [` +
            `${pendingReview.testCase.id}] ` +
            `canonical case verdict retained ` +
            `(screenshot review unavailable)`
        );

        continue;
      }

      if (
        pendingReview.currentStatus ===
          "PASS"
      ) {
        currentResult.status =
          "MANUAL_REQUIRED";

        currentResult.reasonCategory =
          "PASS_EVIDENCE_UNAVAILABLE";

        currentResult.successSignalReached =
          false;

        if (
          currentResult.evidenceSummary
        ) {
          currentResult
            .evidenceSummary
            .successSignalReached =
              false;
        }

        currentResult.evidence = [
          currentResult.evidence,
          "PASS evidence audit was unavailable; " +
            "manual verification is required.",
        ]
          .filter(Boolean)
          .join(" | ");

        console.log(
          ` Evidence reconciliation: [${pendingReview.testCase.id}] ` +
            "PASS -> MANUAL_REQUIRED " +
            "(screenshot review unavailable)"
        );
      }

      continue;
    }

    currentResult.evidenceReview =
      evidenceReview;

    console.log(
      ` Evidence review: [${pendingReview.testCase.id}] ` +
        `${evidenceReview.verdict} ` +
        `(${evidenceReview.confidence})`
    );

    console.log(
      ` Evidence review rationale: [${pendingReview.testCase.id}] ` +
        `${evidenceReview.rationale}`
    );

    const evidenceReviewText = [
      `Evidence review verdict: ` +
        evidenceReview.verdict,

      `Evidence review confidence: ` +
        evidenceReview.confidence,

      `Evidence review rationale: ` +
        evidenceReview.rationale,

      evidenceReview.visibleEvidence
        .length > 0
        ? `Visible evidence: ` +
          evidenceReview
            .visibleEvidence
            .join("; ")
        : "",

      `Evidence review recommended status: ` +
        evidenceReview
          .recommendedStatus,
    ]
      .filter(Boolean)
      .join(" | ");

    currentResult.evidence = [
      currentResult.evidence,
      evidenceReviewText,
    ]
      .filter(Boolean)
      .join(" | ");

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase:
        pendingReview.testCase,
      review: evidenceReview,
      source: "screenshot",
    });

    /*
     * PASS audits use screenshot evidence only.
     * The video reviewer currently handles only
     * FAIL and MANUAL_REQUIRED cases.
     */
    if (
      pendingReview.currentStatus ===
        "PASS"
    ) {
      console.log(
        " PASS evidence audit completed " +
          "with screenshot evidence only."
      );

      continue;
    }

    if (
      !shouldRunVideoEvidenceReview(
        evidenceReview
      )
    ) {
      continue;
    }

    console.log(
      " Video fallback queued: " +
        `${evidenceReview.verdict} ` +
        `(${evidenceReview.confidence})`
    );

    const videoPath = String(
      currentResult.videoPath || ""
    );

    if (
      !videoPath ||
      !fs.existsSync(videoPath)
    ) {
      console.log(
        " Video fallback skipped: " +
          "case video is unavailable."
      );

      continue;
    }

    const issueKey = String(
      plan.issueKey ||
        "unknown-issue"
    );

    const videoEvidenceReview =
      await reviewBrowserVideoEvidence({
        issueKey,
        testCase:
          pendingReview.testCase,
        currentStatus:
          pendingReview.currentStatus,
        currentReasonCategory:
          pendingReview
            .currentReasonCategory,
        notes:
          pendingReview.notes,
        videoPath,
        checkpointEvidence:
          pendingReview
            .checkpointEvidence,
        screenshotReview:
          evidenceReview,
      });

    if (!videoEvidenceReview) {
      continue;
    }

    currentResult.videoEvidenceReview =
      videoEvidenceReview;

    const videoReviewText = [
      "Video fallback triggered: true",

      `Video review verdict: ` +
        videoEvidenceReview.verdict,

      `Video review confidence: ` +
        videoEvidenceReview.confidence,

      `Video review rationale: ` +
        videoEvidenceReview.rationale,

      videoEvidenceReview
        .resolvedFailures.length > 0
        ? `Resolved failures: ` +
          videoEvidenceReview
            .resolvedFailures
            .join("; ")
        : "Resolved failures: none",

      videoEvidenceReview
        .unresolvedFailures.length > 0
        ? `Unresolved failures: ` +
          videoEvidenceReview
            .unresolvedFailures
            .join("; ")
        : "Unresolved failures: none",

      videoEvidenceReview
        .temporalEvidence.length > 0
        ? `Temporal evidence: ` +
          videoEvidenceReview
            .temporalEvidence
            .join("; ")
        : "",

      `Frame paths: ` +
        videoEvidenceReview
          .framePaths
          .join(", "),

      `Video recommended status: ` +
        videoEvidenceReview
          .recommendedStatus,

      `Resolved by video: ` +
        videoEvidenceReview
          .resolvedByVideo,
    ]
      .filter(Boolean)
      .join(" | ");

    currentResult.evidence = [
      currentResult.evidence,
      videoReviewText,
    ]
      .filter(Boolean)
      .join(" | ");

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase:
        pendingReview.testCase,
      review: videoEvidenceReview,
      source: "video",
    });

    console.log(
      ` Video evidence review: ` +
        `${videoEvidenceReview.verdict} ` +
        `(${videoEvidenceReview.confidence})`
    );

    console.log(
      ` Video resolved by fallback: ` +
        `${videoEvidenceReview.resolvedByVideo}`
    );
  }

  const runProofCoverage =
    summarizeBrowserEvidenceContractProofCoverage({
      bindings: runProofBindings,
      results: runProofResults,
    });
  for (const result of results) {
    const caseBindingObligationIds = new Set(
      (executionBrowserCases.find((item) => item.id === result.id)
        ?.deterministicProofBindings ?? [])
        .map((item) => item.obligationId)
    );
    if (caseBindingObligationIds.size === 0) continue;
    result.evidenceContractProofCoverage = runProofCoverage.filter(
      (item) => caseBindingObligationIds.has(item.obligationId)
    );
  }

  for (const result of results) {
    const testCase = executionBrowserCases.find((item) => item.id === result.id);
    const acceptedRoute = result.deterministicPassRuntimeContext?.acceptedRoutePath;
    const deepRouteBinding = testCase
      ? getRuntimeDeepRouteBinding(testCase)
      : undefined;
    const reasonCode = deepRouteBinding && deepRouteBinding.status !== "RESOLVED"
      ? deepRouteBinding?.status
      : result.caseVerdict?.reason ?? result.reasonCategory;
    const fixtureRequirement = testCase?.fixtureRequirements?.filter(Boolean).join("; ");
    result.humanReadableResult = presentBrowserHumanReadableQaResult({
      status: result.status,
      reasonCategory: reasonCode,
      caseVerdict: result.caseVerdict,
      ...(acceptedRoute?.status === "AVAILABLE" ? { acceptedRoutePath: acceptedRoute.value } : {}),
      ...(result.interactionExecutionEvidence?.length ? { interactionExecutionCount: result.interactionExecutionEvidence.length } : {}),
      ...(result.terminationReason ? { terminationReason: result.terminationReason } : {}),
      ...(result.videoPath ? { evidencePath: result.videoPath } : {}),
      ...(reasonCode === "NO_COMPATIBLE_ENTITY" && fixtureRequirement ? {
        resolutionRequest: {
          kind: "EXECUTION_CONTEXT",
          description: "Provide an exact QA fixture entity identity satisfying the recorded fixture requirement.",
          requiredInputs: [{ key: "entityId", description: fixtureRequirement }],
          rerunSupported: true,
        },
      } : {}),
    });
    if (
      process.env.QA_RERUN_OF &&
      process.env.QA_HUMAN_RESOLUTION_REQUEST_ID
    ) {
      result.rerunLineage = {
        rerunOf: process.env.QA_RERUN_OF,
        resolutionRequestId: process.env.QA_HUMAN_RESOLUTION_REQUEST_ID,
        resolutionProvenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT",
        resolvedInputKeys: ["entityId"],
      };
    }
  }

  console.log(
    "\nFinal reconciled browser results:"
  );

  for (const result of results) {
    console.log(
      ` Final browser result: ` +
        `[${String(result.id)}] ` +
        `${String(result.status)}`
    );
    if (result.humanReadableResult) {
      console.log(formatBrowserHumanReadableQaResult(result.humanReadableResult));
    }
  }

  /*
   * GENERIC_BROWSER_USEFULNESS_RUN_SUMMARY_V1
   *
   * Aggregate only typed case lifecycle telemetry.
   *
   * Rates are recomputed from summed numerators and
   * denominators. Per-case rates are never averaged.
   *
   * This artifact is observational only and does not
   * participate in execution, proof, evidence reconciliation,
   * or final verdict selection.
   */
  const genericBrowserUsefulnessRunSummary =
    aggregateGenericBrowserUsefulness(
      genericBrowserUsefulnessCaseRecords.map(
        (record) => record.summary
      )
    );
  const genericBrowserCapabilityEvaluations =
    genericBrowserUsefulnessCaseRecords.flatMap(
      (record) =>
        record.capabilityRecognitions.map(
          (recognition) => recognition.evaluation
        )
    );
  const genericBrowserOperationalCapabilities = {
    aggregate:
      summarizeBrowserOperationalCapabilities(
        genericBrowserCapabilityEvaluations
      ),
    byFamily:
      Object.fromEntries(
        [
          "SELECTED_STATE_OPERATIONAL_CAPABILITY",
          "PAGINATION_OPERATIONAL_CAPABILITY",
        ].map((capabilityKind) => [
          capabilityKind,
          summarizeBrowserOperationalCapabilities(
            genericBrowserCapabilityEvaluations.filter(
              (evaluation) =>
                evaluation.capabilityKind === capabilityKind
            )
          ),
        ])
      ),
  };

  /*
   * GENERIC_BROWSER_USEFULNESS_EXECUTION_PROFILE_ARTIFACT_V1
   *
   * This snapshot is resolved inside the smoke/browser process,
   * where autonomous activation, model selection, and policy
   * environment are actually visible.
   *
   * It is measurement metadata only. It cannot affect proposal
   * selection, safety, execution, proof, reconciliation, or
   * final verdict.
   */
  const genericBrowserUsefulnessExecutionProfile =
    buildGenericBrowserUsefulnessExecutionProfile();

  const genericBrowserUsefulnessRunArtifact = {
    schemaVersion: 2 as const,
    issueKey:
      String(plan.issueKey || ""),
    materializedBrowserRuntimeUnitCount:
      browserExecutionSelection.materializedBrowserRuntimeUnitCount,
    browserExecutionSelectedCount:
      browserExecutionSelection.browserExecutionSelectedCount,
    browserCaseCount:
      executionBrowserCases.length,
    autonomousCaseCount:
      genericBrowserUsefulnessCaseRecords.length,
    caseRecords:
      genericBrowserUsefulnessCaseRecords,
    executionProfile:
      genericBrowserUsefulnessExecutionProfile,
    aggregate:
      genericBrowserUsefulnessRunSummary,
    operationalCapabilities:
      genericBrowserOperationalCapabilities,
  };

  const genericBrowserUsefulnessRunArtifactPath =
    "qa-results/generic-browser-usefulness-run-summary.json";

  fs.writeFileSync(
    genericBrowserUsefulnessRunArtifactPath,
    JSON.stringify(
      genericBrowserUsefulnessRunArtifact,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    `GENERIC_BROWSER_USEFULNESS_RUN_SUMMARY_V1 ` +
      JSON.stringify({
        issueKey:
          genericBrowserUsefulnessRunArtifact.issueKey,
        browserCaseCount:
          genericBrowserUsefulnessRunArtifact
            .browserCaseCount,
        autonomousCaseCount:
          genericBrowserUsefulnessRunArtifact
            .autonomousCaseCount,
        artifactPath:
          genericBrowserUsefulnessRunArtifactPath,
        executionProfile:
          genericBrowserUsefulnessExecutionProfile,
        aggregate:
          genericBrowserUsefulnessRunSummary,
        operationalCapabilities:
          genericBrowserOperationalCapabilities,
      })
  );

  console.log(
    "\nBrowser tests are completed"
  );

  for (const result of results) {
    const prepared = composedPreparations.get(result.id);
    if (prepared) result.composedRuntimePreparation = prepared;
  }

  return results;
}
