import type {
  Page,
} from "playwright";
import type {
  BrowserCheckpointCapture,
  BrowserInteractionExecutionEvidence,
  BrowserExpandedSurfaceObservation,
  BrowserRuntimeTopTabObservation,
  BrowserStep,
  BrowserStepResult,
} from "./browser-execution-types.js";
import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
import {
  buildSuccessfulInteractionEvidence,
} from "./browser-interaction-execution-evidence.js";
import {
  getBrowserCaseText,
} from "./browser-case-relevance.js";
import {
  isAssessmentLanguageModalCase,
} from "./browser-assessment-language-flow.js";
import {
  clickSmartButton,
  clickSmartText,
  findTextInOpenDetailSurface,
  openMatchingTableRowDetail,
} from "./generic-browser-actions.js";
import {
  openReadOnlyExpandedSurface,
} from "./browser-expanded-surface-interaction.js";
import {
  openSmartMenu,
  selectRuntimeTopTab,
  selectSmartOption,
} from "./browser-control-interaction.js";
import {
  openRuntimeControl,
  selectRuntimeFilterOption,
} from "./runtime-filter-interaction.js";
import {
  isInvoiceRowClickRequest,
  resolveAndOpenInvoiceRow,
} from "./browser-entity-interaction.js";
import type {
  BrowserRuntimeFixturePreparationResult,
} from "./browser-runtime-fixture-preparation.js";
import {
  createDraftJobAndVerifyRedirect,
} from "./browser-job-creation-redirect.js";
import type {
  DeferredCleanup,
} from "./browser-deferred-cleanup.js";
import {
  isChangeRequestRowDetailClickRequest,
} from "./browser-change-request-click-policy.js";
import {
  clickProjectDropdown,
  selectLastDropdownOption,
} from "./browser-project-dropdown-actions.js";
import {
  isBrowserTextVisible,
} from "./browser-text-visibility.js";
import {
  observeBrowserPage,
} from "./browser-observation.js";
import {
  evaluateBrowserOrderingRequirement,
  summarizeBrowserOrderingEvidenceParity,
  type BrowserOrderingEvidence,
} from "./browser-ordering-evidence.js";
import type {
  FrontendVisibleFieldProvenance,
} from "../../discovery/frontend-visible-field-provenance.js";
import type {
  BrowserOrderingRequirement,
} from "../../planner/types.js";
import type {
  BrowserCollectionFilterRequirement,
} from "../../planner/types.js";
import {
  executeGroundedCollectionFilterRequirement,
  type BrowserCollectionFilterEvidence,
} from "./browser-grounded-search-proof.js";
import {
  assertSurfaceControlsInObservation,
} from "./browser-surface-control-assertion.js";
import {
  prepareActionsMenuForAssertion,
} from "./browser-actions-menu-assertion.js";
import {
  finalizeBrowserStepResult,
  isPermissionSensitiveBrowserCase,
  isSanityAssertionText,
  requiresPanelOrModalBrowserCase,
} from "./browser-step-result-policy.js";
import {
  buildRequirementActionPlan,
} from "./browser-requirement-action-plan.js";
import {
  ensureRequiredFeatureSurface,
} from "./browser-feature-surface-resolver.js";

/**
 * A runtime-only compatibility action may help expose a surface, but failure
 * cannot suppress later typed source-authorized assertions.
 */
export function isAdvisoryCompatibilityNavigationStep(
  step: BrowserStep
): boolean {
  return step.action === "clickButton" &&
    step.compatibilityNavigation === "ADVISORY";
}

function requiresAssertionSurfaceGrounding(
  step: BrowserStep
): boolean {
  return step.action === "clickButton" &&
    step.assertionSurfaceGrounding === "REQUIRED";
}







export async function runGenericBrowserSteps(
  page: Page,
  testCase: any,
  captureCheckpoint?:
    BrowserCheckpointCapture,
registerDeferredCleanup?:
    (
cleanup: DeferredCleanup
    ) => void,
  runtimeEvidenceOptions: {
    visibleFieldProvenance?:
      FrontendVisibleFieldProvenance[];
    executionPersona?:
      "company_admin" | "talent";
  } = {}
): Promise<BrowserStepResult> {
  const requirementActionPlan =
    buildRequirementActionPlan(
      testCase
    );
  const steps =
    requirementActionPlan.steps;
  const notes: string[] = [
    ...requirementActionPlan.notes,
  ];

  for (
    const note of
    requirementActionPlan.notes
  ) {
    console.log(
      ` Generic browser steps: ${note}`
    );
  }

  const deterministicEvidence:
    BrowserDeterministicEvidence[] = [];
  const interactionExecutionEvidence:
  BrowserInteractionExecutionEvidence[] = [];
  const runtimeTopTabObservations:
    BrowserRuntimeTopTabObservation[] = [];
  const expandedSurfaceObservations:
    BrowserExpandedSurfaceObservation[] = [];
  const runtimeFixturePreparations:
    BrowserRuntimeFixturePreparationResult[] = [];
  const orderingRequirements:
    BrowserOrderingRequirement[] =
      Array.isArray(
        testCase?.acceptanceScope
          ?.orderingRequirements
      )
        ? testCase.acceptanceScope
            .orderingRequirements
        : [];
  const orderingEvidence:
    BrowserOrderingEvidence[] = [];
  const collectionFilterRequirements:
    BrowserCollectionFilterRequirement[] =
      Array.isArray(
        testCase?.acceptanceScope
          ?.collectionFilterRequirements
      )
        ? testCase.acceptanceScope
            .collectionFilterRequirements
        : [];
  const collectionFilterEvidence:
    BrowserCollectionFilterEvidence[] = [];
  let assertionSurfaceGroundingUnavailable: string | null = null;
  const runtimeObservationResult = () => ({
    ...(runtimeTopTabObservations.length > 0
      ? { runtimeTopTabObservations }
      : {}),
    ...(expandedSurfaceObservations.length > 0
      ? { expandedSurfaceObservations }
      : {}),
    ...(runtimeFixturePreparations.length > 0
      ? { runtimeFixturePreparations }
      : {}),
    ...(orderingRequirements.length > 0
      ? {
          orderingEvidence,
          orderingEvidenceParity:
            summarizeBrowserOrderingEvidenceParity({
              requirements:
                orderingRequirements,
              evidence: orderingEvidence,
            }),
        }
      : {}),
    ...(collectionFilterRequirements.length > 0
      ? { collectionFilterEvidence }
      : {}),
  });

  if (!Array.isArray(steps) || steps.length === 0) {
    const note =
      "No structured browser steps provided. Screenshot-only browser cases require manual verification.";
    console.log(` Generic browser steps: ${note}`);

    return {
      status: "MANUAL_REQUIRED",
      reasonCategory: "NO_STRUCTURED_STEPS",
      notes: [note],
    };
  }

  let hasAssertion = false;
  let hasAcceptanceAssertion = false;
  let hasPositiveAcceptanceAssertion = false;
  let hasFailedAssertion = false;
  let needsManualVerification = false;
  let hasActionLimitation = false;
  let lastOpenedMenuHint:
    string | undefined;

  for (const requirement of collectionFilterRequirements) {
    const execution =
      await executeGroundedCollectionFilterRequirement({
        page,
        requirement,
      });
    collectionFilterEvidence.push(execution.evidence);
    deterministicEvidence.push(
      ...execution.deterministicEvidence
    );
    notes.push(execution.evidence.note);
    console.log(
      ` Grounded collection filter proof: ` +
        `${execution.evidence.status}; ` +
        `proofReady=${execution.evidence.proofReady}`
    );

    if (execution.evidence.status === "CONFIRMED") {
      hasAssertion = true;
      hasAcceptanceAssertion = true;
      hasPositiveAcceptanceAssertion = true;
    } else if (execution.evidence.status === "CONTRADICTED") {
      hasAssertion = true;
      hasAcceptanceAssertion = true;
      hasFailedAssertion = true;
    } else {
      needsManualVerification = true;
      hasActionLimitation = true;
    }
  }

  const caseText = getBrowserCaseText(testCase);

  const isPermissionSensitiveCase =
    isPermissionSensitiveBrowserCase(
      testCase,
      steps
    );

  const requiresPanelOrModal =
    requiresPanelOrModalBrowserCase(
      caseText
    );

  async function tryOpenLikelyFallback(reason: string) {
    if (!requiresPanelOrModal) return;

    const note =
      `${reason}: skipped ambiguous fallback; ` +
      `no unrelated panel or item was clicked`;

    notes.push(note);
    console.log(` Generic browser step ${note}`);

    hasActionLimitation = true;
  }

  for (
    let stepOffset = 0;
    stepOffset < steps.length;
    stepOffset += 1
  ) {
    const step = steps[stepOffset];

    if (!step) {
      continue;
    }

    const stepIndex = stepOffset + 1;

    /*
     * Prevent one entity interaction from leaking its
     * identity into a later unrelated checkpoint.
     */
    delete testCase.runtimeEvidenceIdentity;

    if (step.action === "wait") {
      await page.waitForTimeout(step.ms);
      notes.push(`wait ${step.ms}ms`);
      continue;
    }

    if (step.action === "setViewport") {
      await page.setViewportSize({
        width: step.width,
        height: step.height,
      });

      await page.waitForTimeout(1000);

      const note = `setViewport ${step.width}x${step.height}`;
      notes.push(note);
      console.log(` Generic browser step ${note}`);

      continue;
    }

    if (
      step.action ===
      "selectRuntimeTopTab"
    ) {
      const result =
        await selectRuntimeTopTab(
          page
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      if (
        result.runtimeTopTabObservation
      ) {
        runtimeTopTabObservations.push({
          stepIndex,
          ...result.runtimeTopTabObservation,
          note: result.note,
        });
      }

      if (!result.ok) {
        notes.push(
          `manual required: a safe inactive ` +
            `main-content tab could not be ` +
            `discovered, selected and verified; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
          ...runtimeObservationResult(),
        };
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "clickTopTab") {
      const result = await clickSmartText(page, step.text);

      notes.push(result.note);
      console.log(` Generic browser step ${result.note}`);

if (!result.ok) {
  hasActionLimitation = true;

  await tryOpenLikelyFallback(
    `fallback after clickText "${step.text}"`
  );

  notes.push(
    `manual required: prerequisite text action failed; ` +
      `remaining assertions were skipped`
  );

  return {
    status: "MANUAL_REQUIRED",
    reasonCategory:
      "AUTOMATION_LIMITATION",
    notes,
    ...runtimeObservationResult(),
  };
}

const interactionEvidence =
  buildSuccessfulInteractionEvidence({
    stepIndex,
    step,
    note: result.note,
  });

if (interactionEvidence) {
  interactionExecutionEvidence.push(
    interactionEvidence
  );
}

await page.waitForTimeout(1000);

await captureCheckpoint?.({
  stepIndex,
  step,
  note: result.note,
});

continue;
    }

    if (
      step.action ===
      "createDraftJobAndVerifyRedirect"
    ) {
      const result =
        await createDraftJobAndVerifyRedirect(
          page,
          {
            caseId: String(
              testCase.id || "browser"
            ),
            origin: step.origin,
          }
        );

      if (result.deferredCleanup) {
        registerDeferredCleanup?.(
          result.deferredCleanup
        );
      }

      const resultNote =
        result.status === "PASS"
          ? result.note
          : `${result.status}: ${result.reasonCategory}: ${result.note}`;

      notes.push(resultNote);

      console.log(
        ` Draft job browser interaction: ` +
          resultNote
      );

      if (result.status !== "PASS") {
        return {
          status: result.status,
          reasonCategory:
            result.reasonCategory,
          notes,
          deterministicEvidence,
          ...runtimeObservationResult(),
        };
      }

      await page.waitForTimeout(750);

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "clickButton") {
      const expandedResult =
        step.verifyExpandedSurface
          ? await openReadOnlyExpandedSurface(
              page,
              {
                triggerText: step.text,
                ...(step.contextText
                  ? {
                      contextText:
                        step.contextText,
                    }
                  : {}),
              }
            )
          : undefined;
      const result = expandedResult ??
        await clickSmartButton(page, step.text);

      if (expandedResult) {
        expandedSurfaceObservations.push({
          stepIndex,
          action: "clickButton",
          triggerText: step.text,
          ...(step.contextText
            ? {
                contextText:
                  step.contextText,
              }
            : {}),
          interactionSucceeded:
            expandedResult.interactionSucceeded,
          expandedSurfaceVerified:
            expandedResult.expandedSurfaceVerified,
          surfaceRole:
            expandedResult.surface?.role ??
            null,
          surfaceType:
            expandedResult.surface?.type ??
            null,
          surfaceName:
            expandedResult.surface?.name ??
            null,
          verificationSource:
            expandedResult.surface?.source ??
            null,
          note: expandedResult.note,
        });
      }

      notes.push(result.note);
      console.log(` Generic browser step ${result.note}`);

      if (requiresAssertionSurfaceGrounding(step)) {
        if (expandedResult?.expandedSurfaceVerified) {
          assertionSurfaceGroundingUnavailable = null;
        } else {
          assertionSurfaceGroundingUnavailable =
            `required assertion surface was not deterministically grounded ` +
            `after compatibility navigation "${step.text}"`;
        }
      }

      if (!result.ok) {
        if (isAdvisoryCompatibilityNavigationStep(step)) {
          notes.push(
            `compatibility navigation action "${step.text}" was unavailable; ` +
              `continuing with typed source-authorized assertions`
          );
          continue;
        }

        hasActionLimitation = true;

        await tryOpenLikelyFallback(
          `fallback after clickButton "${step.text}"`
        );

        notes.push(
          `manual required: prerequisite button action failed; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          ...runtimeObservationResult(),
        };
      }

      const interactionEvidence =
  buildSuccessfulInteractionEvidence({
    stepIndex,
    step,
    note: result.note,
  });

if (interactionEvidence) {
  interactionExecutionEvidence.push(
    interactionEvidence
  );
}

await page.waitForTimeout(1000);

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "openMenu") {
      const surfaceResolution =
        await ensureRequiredFeatureSurface(
          page,
          testCase,
          step.text
        );

      if (
        surfaceResolution.status ===
        "ENTERED"
      ) {
        notes.push(
          surfaceResolution.note
        );
        console.log(
          ` Generic browser feature surface: ` +
            `${surfaceResolution.status} - ` +
            `${surfaceResolution.note}`
        );
      }

      const result = await openSmartMenu(
        page,
        step.text
      );

      if (
        !result.ok &&
        surfaceResolution.status ===
          "BLOCKED"
      ) {
        notes.push(
          surfaceResolution.note
        );
        console.log(
          ` Generic browser feature surface: ` +
            `${surfaceResolution.status} - ` +
            `${surfaceResolution.note}`
        );
      }

      notes.push(result.note);
      console.log(
        ` Generic browser step ${result.note}`
      );

      if (!result.ok) {
        notes.push(
          `manual required: menu trigger "${step.text}" ` +
            `could not be opened and verified; remaining ` +
            `assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
    ...runtimeObservationResult(),
        };
      }

      await page.waitForTimeout(500);

      lastOpenedMenuHint =
        step.text;

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (
      step.action ===
      "openRuntimeControl"
    ) {
      const result =
        await openRuntimeControl(
          page,
          step.target
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      deterministicEvidence.push({
        stepIndex,
        action: "openRuntimeControl",
        expected:
          `Open interactive control ` +
          `"${step.target}" and verify its ` +
          `expanded surface`,
        passed: result.ok,
        note: result.note,
      });

      if (!result.ok) {
        notes.push(
          `manual required: runtime control ` +
            `"${step.target}" could not be ` +
            `opened with a deterministic ` +
            `expanded-surface signal; remaining ` +
            `assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
          ...runtimeObservationResult(),
        };
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (
      step.action ===
      "selectRuntimeFilterOption"
    ) {
      const visibleStateMode =
        step.verification ===
        "visible-state";

      const verification =
        visibleStateMode
          ? "visible-state"
          : "url";

      const runtimeFilterKey =
        step.verification ===
        "visible-state"
          ? step.filterKey
          : step.queryKey;

      const result =
        await selectRuntimeFilterOption(
          page,
          runtimeFilterKey,
          step.hint,
          verification
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      if (
        visibleStateMode &&
        result.interactionSucceeded ===
          true
      ) {
        const interactionEvidence =
          buildSuccessfulInteractionEvidence({
            stepIndex,
            step,
            note: result.note,
          });

        if (interactionEvidence) {
          interactionExecutionEvidence.push(
            interactionEvidence
          );
        }
      }

      const selectedStatePassed =
        visibleStateMode
          ? result.visibleStateVerified ===
            true
          : result.ok;

      if (
        visibleStateMode &&
        selectedStatePassed
      ) {
        hasAssertion = true;
        hasAcceptanceAssertion = true;
        hasPositiveAcceptanceAssertion =
          true;
      }

      deterministicEvidence.push({
        stepIndex,
        ...(visibleStateMode &&
        step.oracleId
          ? {
              oracleId:
                step.oracleId,
            }
          : {}),
        action:
          "selectRuntimeFilterOption",
        verificationMode:
          verification,
        ...(visibleStateMode
          ? {
              ...(result.selectedLabel
                ? {
                    targetSelectedLabel:
                      result.selectedLabel,
                  }
                : {}),
              observedSelectedLabel:
                result.observedSelectedLabel ??
                null,
            }
          : {}),
        expected:
          verification === "visible-state"
            ? (
                `Select safe runtime option ` +
                `"${result.selectedLabel || "(unresolved)"}" ` +
                `for filter "${step.hint || runtimeFilterKey}" ` +
                `and observe that exact visible ` +
                `selected label`
              )
            : (
                `Select one safe runtime option ` +
                `for query key "${runtimeFilterKey}" ` +
                `and verify a browser URL transition`
              ),
        passed: selectedStatePassed,
        note: result.note,
      });

      if (!result.ok) {
        notes.push(
          verification === "visible-state"
            ? (
                `manual required: a safe runtime ` +
                `filter option for ` +
                `"${step.hint || runtimeFilterKey}" ` +
                `could not be selected with a ` +
                `verified visible state; remaining ` +
                `assertions were skipped`
              )
            : (
                `manual required: a safe runtime ` +
                `filter option for query key ` +
                `"${runtimeFilterKey}" could not be ` +
                `selected with a verified URL ` +
                `transition; remaining assertions ` +
                `were skipped`
              )
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
          ...(interactionExecutionEvidence.length >
          0
            ? {
                interactionExecutionEvidence,
              }
            : {}),
          ...runtimeObservationResult(),
        };
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "selectOption") {
      const result = await selectSmartOption(
        page,
        step.text,
        lastOpenedMenuHint
          ? {
              menuHint:
                lastOpenedMenuHint,
            }
          : undefined
      );

      notes.push(result.note);
      console.log(
        ` Generic browser step ${result.note}`
      );

      deterministicEvidence.push({
        stepIndex,
        action: "selectOption",
        expected:
          `Select the unique observed option ` +
          `"${step.text}" and verify its visible ` +
          `selected state`,
        passed: result.ok,
        note: result.note,
      });

      if (!result.ok) {
        notes.push(
          `manual required: menu option "${step.text}" ` +
            `could not be selected safely; remaining ` +
            `assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          ...runtimeObservationResult(),
        };
      }

      await page.waitForTimeout(500);

      const matchingOrderingRequirements =
        orderingRequirements.filter(
          (requirement) =>
            String(
              requirement.selectionHint || ""
            )
              .trim()
              .toLowerCase() ===
            step.text.trim().toLowerCase()
        );

      if (
        matchingOrderingRequirements.length > 0
      ) {
        const observation =
          await observeBrowserPage(page);

        for (const requirement of
          matchingOrderingRequirements) {
          orderingEvidence.push(
            evaluateBrowserOrderingRequirement({
              requirement,
              observation,
              ...(runtimeEvidenceOptions
                .visibleFieldProvenance
                ? {
                    visibleFieldProvenance:
                      runtimeEvidenceOptions
                        .visibleFieldProvenance,
                  }
                : {}),
              stepIndex,
            })
          );
        }
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "clickProjectDropdown") {
      const clicked = await clickProjectDropdown(page);

      if (clicked) {
        notes.push("clicked project dropdown");
      } else {
        notes.push("manual required: could not open project dropdown reliably");
        hasActionLimitation = true;
        needsManualVerification = true;
      }

      continue;
    }

    if (step.action === "selectLastDropdownOption") {
      const selected = await selectLastDropdownOption(page);

      if (selected) {
        notes.push("selected last dropdown option");
      } else {
        notes.push(
          "manual required: could not reliably scroll/select/verify the last dropdown option"
        );
        hasActionLimitation = true;
        needsManualVerification = true;
      }

      continue;
    }

    if (step.action === "clickText") {
      if (
        isInvoiceRowClickRequest(
          testCase,
          step.text
        )
      ) {
        const invoiceResult =
          await resolveAndOpenInvoiceRow(
            page,
            testCase,
            step.text,
            {
              ...(runtimeEvidenceOptions
                .executionPersona
                ? {
                    executionPersona:
                      runtimeEvidenceOptions
                        .executionPersona,
                  }
                : {}),
            }
          );

        if (
          invoiceResult
            .runtimeFixturePreparation
        ) {
          runtimeFixturePreparations.push(
            invoiceResult
              .runtimeFixturePreparation
          );
        }

        notes.push(invoiceResult.note);

        console.log(
          ` Invoice browser interaction: ` +
            invoiceResult.note
        );

        if (
          invoiceResult.status ===
          "OPENED"
        ) {
          deterministicEvidence.push({
            stepIndex,
            action:
              "resolveRuntimeInvoiceFixture",
            expected:
              `Open an invoice from required ` +
              `table view=${
                invoiceResult
                  .requiredTableView ||
                "current"
              }`,
            passed: true,
            note:
              `requested=${
                invoiceResult
                  .requestedInvoice ||
                "none"
              }; selected=${
                invoiceResult
                  .selectedInvoice
              }; requiredView=${
                invoiceResult
                  .requiredTableView ||
                "current"
              }; selectedView=${
                invoiceResult
                  .selectedTableView ||
                "current"
              }; exactMatch=${
                invoiceResult
                  .exactInvoiceMatched
              }`,
          });

          await page.waitForTimeout(700);

          /*
           * Screenshot only. No drawer scrolling, DOM
           * mutation or React-controlled interaction.
           */
          await captureCheckpoint?.({
            stepIndex,
            step,
            note:
              `${invoiceResult.note}; ` +
              `invoice drawer opened`,
          });

          continue;
        }

        if (
          invoiceResult.status ===
          "TEST_DATA_ISSUE"
        ) {
          return {
            status: "BLOCKED",
            reasonCategory:
              "TEST_DATA_ISSUE",
            notes,
            ...runtimeObservationResult(),
          };
        }

        hasActionLimitation = true;
        needsManualVerification = true;

        notes.push(
          `manual required: invoice prerequisite state was not reached; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          ...runtimeObservationResult(),
        };
      }

      if (
        isChangeRequestRowDetailClickRequest(
          testCase,
          step.text
        )
      ) {
        const expectedDetailTexts =
          steps
            .slice(stepOffset + 1)
            .flatMap(
              (candidateStep) =>
                candidateStep.action ===
                "assertTextVisible"
                  ? [
                      candidateStep.text,
                    ]
                  : []
            )
            .filter(
              (text) =>
                !isSanityAssertionText(
                  text
                )
            );

        const rowDetailResult =
          await openMatchingTableRowDetail(
            page,
            step.text,
            expectedDetailTexts
          );

        notes.push(
          rowDetailResult.note
        );

        console.log(
          ` Change-request row interaction: ` +
            rowDetailResult.note
        );

        if (!rowDetailResult.ok) {
          notes.push(
            `manual required: matching ` +
              `change-request row detail ` +
              `could not be opened and ` +
              `verified; remaining ` +
              `assertions were skipped`
          );

          return {
            status:
              "MANUAL_REQUIRED",
            reasonCategory:
              "AUTOMATION_LIMITATION",
            notes,
            deterministicEvidence,
            ...runtimeObservationResult(),
          };
        }

        await captureCheckpoint?.({
          stepIndex,
          step,
          note:
            rowDetailResult.note,
        });

        continue;
      }

      const clickCaseText = [
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

      const requiresContentScopedClick =
        clickCaseText.includes(
          "job wizard"
        );

      const result =
        await clickSmartText(
          page,
          step.text,
          {
            allowGlobalNavigationFallback:
              !requiresContentScopedClick,
          }
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ${result.note}`
      );

      if (!result.ok) {
        hasActionLimitation = true;

        await tryOpenLikelyFallback(
          `fallback after clickText "${step.text}"`
        );

        notes.push(
          `manual required: prerequisite text action failed; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          ...runtimeObservationResult(),
        };
      }

      await page.waitForTimeout(1000);

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "reload") {
      const beforeUrl = page.url();

      try {
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        await page
          .waitForLoadState(
            "networkidle",
            { timeout: 5000 }
          )
          .catch(() => undefined);

        await page.waitForTimeout(500);
      } catch (error: any) {
        const note =
          `manual required: page reload could not ` +
          `be completed safely: ${String(
            error?.message || error
          )}`;

        notes.push(note);

        console.log(
          ` Generic browser step ${note}`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
          ...runtimeObservationResult(),
        };
      }

      const note =
        `reloaded page: ${beforeUrl} -> ` +
        `${page.url()}`;

      notes.push(note);

      console.log(
        ` Generic browser step ${note}`
      );

      await captureCheckpoint?.({
        stepIndex,
        step,
        note,
      });

      continue;
    }

    if (
      step.action === "assertUrlContains" ||
      step.action === "assertUrlNotContains"
    ) {
      hasAssertion = true;
      hasAcceptanceAssertion = true;

      if (
        step.action === "assertUrlContains"
      ) {
        hasPositiveAcceptanceAssertion =
          true;
      }

      const expected =
        String(step.text || "").trim();

      const actualUrl = page.url();

      let decodedUrl = actualUrl;

      try {
        decodedUrl =
          decodeURIComponent(actualUrl);
      } catch {
        decodedUrl = actualUrl;
      }

      const containsExpected =
        expected.length > 0 &&
        (
          actualUrl.includes(expected) ||
          decodedUrl.includes(expected)
        );

      const passed =
        step.action === "assertUrlContains"
          ? containsExpected
          : expected.length > 0 &&
            !containsExpected;

      const assertionLabel =
        step.action === "assertUrlContains"
          ? "contains"
          : "does not contain";

      const note =
        `assert URL ${assertionLabel} ` +
        `"${expected}": ` +
        `${passed ? "PASS" : "FAIL"} ` +
        `(actual: ${actualUrl})`;

      deterministicEvidence.push({
        stepIndex,
        ...(step.oracleId
          ? {
              oracleId:
                step.oracleId,
            }
          : {}),
        ...(step.acceptanceCritical !==
        undefined
          ? {
              acceptanceCritical:
                step.acceptanceCritical,
            }
          : {}),
        action: step.action,
        expected,
        actualUrl,
        passed,
        note,
      });

      notes.push(note);

      console.log(
        ` Generic browser assertion ${note}`
      );

      if (!passed) {
        hasFailedAssertion = true;
      }

      continue;
    }

    if (
      step.action ===
      "assertSurfaceControls"
    ) {
      /*
       * GENERIC_BROWSER_SURFACE_CONTROL_ASSERTION_PLUMBING_V1
       *
       * The structural oracle consumes only a fresh bounded
       * BrowserObservation. It does not query global page text
       * or select controls by DOM order.
       */
      hasAssertion = true;
      hasAcceptanceAssertion = true;
      hasPositiveAcceptanceAssertion =
        true;

      const observation =
        await observeBrowserPage(
          page
        );

      const assertion =
        assertSurfaceControlsInObservation({
          observation,
          surfaceKind:
            step.surfaceKind,
          controls:
            step.controls,
        });

      const expectedControls =
        step.controls
          .map(
            (control) =>
              `${control.kind}:"${control.label}"`
          )
          .join(", ");

      const note =
        `assert ${step.surfaceKind} surface controls ` +
        `[${expectedControls}]: ` +
        `${assertion.passed ? "PASS" : "FAIL"} ` +
        `(${assertion.note})`;

      deterministicEvidence.push({
        stepIndex,
        ...(step.oracleId
          ? {
              oracleId:
                step.oracleId,
            }
          : {}),
        ...(step.acceptanceCritical !==
        undefined
          ? {
              acceptanceCritical:
                step.acceptanceCritical,
            }
          : {}),
        action:
          "assertSurfaceControls",
        expected:
          `Unique ${step.surfaceKind} surface ` +
          `contains exactly one of each requested ` +
          `semantic control: ${expectedControls}`,
        passed:
          assertion.passed,
        note,
      });

      notes.push(note);

      console.log(
        ` Generic browser assertion ${note}`
      );

      if (!assertion.passed) {
        hasFailedAssertion = true;
      }

      continue;
    }

    if (step.action === "assertTextVisible") {
      if (assertionSurfaceGroundingUnavailable) {
        notes.push(
          `manual required: ${assertionSurfaceGroundingUnavailable}; ` +
            "source-bound assertions were not evaluated on an ungrounded surface"
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory: "TARGET_SURFACE_UNAVAILABLE",
          notes,
          ...runtimeObservationResult(),
        };
      }

      hasAssertion = true;

      if (
        !isSanityAssertionText(
          step.text
        )
      ) {
        hasAcceptanceAssertion = true;
        hasPositiveAcceptanceAssertion = true;
      }

      const actionsMenuResult =
        await prepareActionsMenuForAssertion(
          page,
          step.text
        );

      if (actionsMenuResult) {
        notes.push(
          actionsMenuResult.note
        );

        console.log(
          ` Generic browser step ` +
            `${actionsMenuResult.note}`
        );

        if (!actionsMenuResult.ok) {
          notes.push(
            "manual required: Actions menu prerequisite " +
              "could not be verified; assertion was skipped"
          );

          return {
            status: "MANUAL_REQUIRED",
            reasonCategory:
              "AUTOMATION_LIMITATION",
            notes,
            ...runtimeObservationResult(),
          };
        }
      }

let visible =
  await isBrowserTextVisible(
    page,
    step.text
  );

let semanticVisibilitySignal = "";

if (
  !visible &&
  isAssessmentLanguageModalCase(
    testCase
  ) &&
  /^select proficiency level$/i.test(
    String(step.text || "").trim()
  )
) {
  const proficiencyLabelVisible =
    await isBrowserTextVisible(
      page,
      "Proficiency Level"
    );

  const visibleCefrOptionCount =
    await page
      .locator("button:visible")
      .filter({
        hasText:
          /^(A1|A2|B1|B2|C1|C2)$/i,
      })
      .count()
      .catch(() => 0);

  if (
    proficiencyLabelVisible &&
    visibleCefrOptionCount >= 6
  ) {
    visible = true;

    semanticVisibilitySignal =
      " (populated proficiency control; " +
      "visible A1-C2 scale)";
  }
}


if (
  !visible &&
  /^document requirement$/i.test(
    String(step.text || "").trim()
  ) &&
  caseText.includes("work setup") &&
  /\/company\/(?:all-)?work-setups(?:[/?#]|$)/i.test(
    page.url()
  )
) {
  const workSetupsTable = page
    .locator("table:visible")
    .first();

  const documentHeaderVisible =
    await workSetupsTable
      .getByText(/^Document$/i)
      .first()
      .isVisible({
        timeout: 500,
      })
      .catch(() => false);

  const requirementValues =
    workSetupsTable.getByText(
      /^(Required|Not required)$/i
    );

  const requirementValueCount =
    Math.min(
      await requirementValues
        .count()
        .catch(() => 0),
      20
    );

  let visibleRequirementValueCount = 0;

  for (
    let index = 0;
    index < requirementValueCount;
    index += 1
  ) {
    const valueVisible =
      await requirementValues
        .nth(index)
        .isVisible()
        .catch(() => false);

    if (valueVisible) {
      visibleRequirementValueCount += 1;
    }
  }

  if (
    documentHeaderVisible &&
    visibleRequirementValueCount > 0
  ) {
    visible = true;

    semanticVisibilitySignal =
      " (Document column with visible " +
      "Required/Not required indicator)";
  }
}

let scrollAwareResult:
        Awaited<
          ReturnType<
            typeof findTextInOpenDetailSurface
          >
        > | null = null;

      if (!visible) {
        scrollAwareResult =
          await findTextInOpenDetailSurface(
            page,
            step.text
          );

        notes.push(
          scrollAwareResult.note
        );

        console.log(
          ` Generic browser step ` +
            `${scrollAwareResult.note}`
        );

        if (
          scrollAwareResult.visible
        ) {
          visible = true;

          await captureCheckpoint?.({
            stepIndex,
            step,
            note:
              scrollAwareResult.note,
          });
        }
      }

      const scrollSignal =
        scrollAwareResult?.visible
          ? ` (scroll-aware detail surface)`
          : "";

      const note = `assert visible "${step.text}": ${
        visible ? "PASS" : "FAIL"
}${scrollSignal}${semanticVisibilitySignal}`;

      deterministicEvidence.push({
        stepIndex,
        ...(step.oracleId
          ? {
              oracleId:
                step.oracleId,
            }
          : {}),
        ...(step.acceptanceCritical !==
        undefined
          ? {
              acceptanceCritical:
                step.acceptanceCritical,
            }
          : {}),
        action: "assertTextVisible",
        expected:
          `Text is visible: ${step.text}`,
        passed: visible,
        note,
      });

      notes.push(note);
      console.log(` Generic browser assertion ${note}`);

      if (!visible) {
        hasFailedAssertion = true;
      }

      continue;
    }

    if (step.action === "assertTextNotVisible") {
      if (assertionSurfaceGroundingUnavailable) {
        notes.push(
          `manual required: ${assertionSurfaceGroundingUnavailable}; ` +
            "source-bound assertions were not evaluated on an ungrounded surface"
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory: "TARGET_SURFACE_UNAVAILABLE",
          notes,
          ...runtimeObservationResult(),
        };
      }

      hasAssertion = true;

      if (
        !isSanityAssertionText(
          step.text
        )
      ) {
        hasAcceptanceAssertion = true;
      }

      const actionsMenuResult =
        await prepareActionsMenuForAssertion(
          page,
          step.text
        );

      if (actionsMenuResult) {
        notes.push(
          actionsMenuResult.note
        );

        console.log(
          ` Generic browser step ` +
            `${actionsMenuResult.note}`
        );

        if (!actionsMenuResult.ok) {
          notes.push(
            "manual required: Actions menu prerequisite " +
              "could not be verified; assertion was skipped"
          );

          return {
            status: "MANUAL_REQUIRED",
            reasonCategory:
              "AUTOMATION_LIMITATION",
            notes,
            ...runtimeObservationResult(),
          };
        }
      }

      const normalizedNegativeText =
        String(
          step.text || ""
        ).trim();

      const isLegacyLanguageLabel =
        /^(?:Receptive|Productive)$/i.test(
          normalizedNegativeText
        );

      const languageAdjustmentOpen =
        isLegacyLanguageLabel &&
        await page
          .locator(
            ".shared-language-adjustment-popover:visible"
          )
          .first()
          .isVisible()
          .catch(() => false);

      const visible =
        await isBrowserTextVisible(
          page,
          step.text,
          languageAdjustmentOpen
            ? {
                exact: true,
                scopeSelector:
                  ".shared-language-adjustment-popover",
                allowRequiredAsterisk:
                  true,
              }
            : {
                exact: true,
              }
        );

      const passed = !visible;
      const note = `assert not visible "${step.text}": ${
        passed ? "PASS" : "FAIL"
      }`;

      deterministicEvidence.push({
        stepIndex,
        ...(step.oracleId
          ? {
              oracleId:
                step.oracleId,
            }
          : {}),
        ...(step.acceptanceCritical !==
        undefined
          ? {
              acceptanceCritical:
                step.acceptanceCritical,
            }
          : {}),
        action:
          "assertTextNotVisible",
        expected:
          `Text is not visible: ${step.text}`,
        passed,
        note,
      });

      notes.push(note);
      console.log(` Generic browser assertion ${note}`);

      if (!passed) {
        hasFailedAssertion = true;
      }

      continue;
    }

    notes.push(`manual required: unsupported browser step "${(step as any).action}"`);
    needsManualVerification = true;
  }

  const unobservedFinalRequirements =
    orderingRequirements.filter(
      (requirement) =>
        !requirement.selectionHint &&
        !orderingEvidence.some(
          (evidence) =>
            evidence.requirementId ===
            requirement.requirementId
        )
    );

  if (unobservedFinalRequirements.length > 0) {
    const observation =
      await observeBrowserPage(page);

    for (const requirement of
      unobservedFinalRequirements) {
      orderingEvidence.push(
        evaluateBrowserOrderingRequirement({
          requirement,
          observation,
          ...(runtimeEvidenceOptions
            .visibleFieldProvenance
            ? {
                visibleFieldProvenance:
                  runtimeEvidenceOptions
                    .visibleFieldProvenance,
              }
            : {}),
        })
      );
    }
  }

const finalResult =
  finalizeBrowserStepResult({
    testCase,
    notes,
    deterministicEvidence,
    hasAssertion,
    hasAcceptanceAssertion,
    hasPositiveAcceptanceAssertion,
    hasFailedAssertion,
    needsManualVerification,
    hasActionLimitation,
    requiresPanelOrModal,
    isPermissionSensitiveCase,
  });

return {
  ...finalResult,
  ...(interactionExecutionEvidence.length > 0
    ? {
        interactionExecutionEvidence,
      }
    : {}),
  ...(runtimeTopTabObservations.length > 0
    ? {
        runtimeTopTabObservations,
      }
    : {}),
  ...(expandedSurfaceObservations.length > 0
    ? {
        expandedSurfaceObservations,
      }
      : {}),
  ...(collectionFilterRequirements.length > 0
    ? { collectionFilterEvidence }
    : {}),
  ...runtimeObservationResult(),
};

}
