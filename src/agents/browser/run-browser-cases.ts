import fs from "node:fs";
import yaml from "yaml";
import type { TestPlan } from "../../planner/types.js";
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
  runGenericBrowserSteps,
} from "./browser-step-executor.js";
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
  shouldDeferBrowserFixtureBlock,
} from "./fixtures/browser-fixture-lifecycle.js";




export type BrowserRunOptions = {
  runtimeContexts?:
    RuntimeContextsByPersona;
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

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const plan: TestPlan = JSON.parse(cleanJsonFileContent(planFile));
  const results: any[] = [];

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
    !Array.isArray(plan.browserCases) ||
    plan.browserCases.length === 0
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

  const probeCases = [
    ...(plan.browserCases as any[]),
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
    ...(plan.browserCases as any[]),
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

  ensureAssessmentLanguageReadOnlyNavigationStep(
  testCase
);

ensureTalentProfileLanguageNavigationStep(
  testCase
);

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
      shouldDeferBrowserFixtureBlock(
        testCase
      );

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

      const targetUrl =
        `${baseUrl}${testCase.startRoute}`;

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

      await logVisibleAssessmentControls(
        page,
        testCase
      );

      await prepareAssessmentLanguageModal(
  page,
  testCase
);

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

      const fixturePreparation =
        await prepareBrowserFixture({
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
        BrowserStepResult;

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
      } else {
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

      results.push({
        id: testCase.id,
        status: stepResult.status,
        reasonCategory: stepResult.reasonCategory,
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
        trace,
      });
    } catch (error: any) {
      console.log(` Error: ${error.message}`);
      results.push({
        id: testCase.id,
        status: "ERROR",
        reasonCategory: "AGENT_RUNTIME_ERROR",
        startRoute: testCase.startRoute,
        evidence: error.message,
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

  console.log(
    "\nFinal reconciled browser results:"
  );

  for (const result of results) {
    console.log(
      ` Final browser result: ` +
        `[${String(result.id)}] ` +
        `${String(result.status)}`
    );
  }

  console.log(
    "\nBrowser tests are completed"
  );

  return results;
}
