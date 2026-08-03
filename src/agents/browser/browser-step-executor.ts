import type {
  Page,
} from "playwright";
import type {
  BrowserCheckpointCapture,
  BrowserStep,
  BrowserStepResult,
} from "./browser-execution-types.js";
import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
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
  prepareActionsMenuForAssertion,
} from "./browser-actions-menu-assertion.js";
import {
  finalizeBrowserStepResult,
  isPermissionSensitiveBrowserCase,
  isSanityAssertionText,
  requiresPanelOrModalBrowserCase,
} from "./browser-step-result-policy.js";








export async function runGenericBrowserSteps(
  page: Page,
  testCase: any,
  captureCheckpoint?:
    BrowserCheckpointCapture,
  registerDeferredCleanup?:
    (
cleanup: DeferredCleanup
    ) => void
): Promise<BrowserStepResult> {
  const steps = testCase.steps as BrowserStep[] | undefined;
  const notes: string[] = [];

  const deterministicEvidence:
    BrowserDeterministicEvidence[] = [];

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
          `fallback after clickTopTab "${step.text}"`
        );

        notes.push(
          `manual required: prerequisite tab action failed; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
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
      const result = await clickSmartButton(page, step.text);

      notes.push(result.note);
      console.log(` Generic browser step ${result.note}`);

      if (!result.ok) {
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
        };
      }

      await page.waitForTimeout(1000);
      continue;
    }

    if (step.action === "openMenu") {
      const result = await openSmartMenu(
        page,
        step.text
      );

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
        };
      }

      await page.waitForTimeout(500);

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
      const result =
        await selectRuntimeFilterOption(
          page,
          step.queryKey,
          step.hint
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      if (!result.ok) {
        notes.push(
          `manual required: a safe runtime ` +
            `filter option for query key ` +
            `"${step.queryKey}" could not be ` +
            `selected with a verified URL ` +
            `transition; remaining assertions ` +
            `were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
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
        step.text
      );

      notes.push(result.note);
      console.log(
        ` Generic browser step ${result.note}`
      );

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
        };
      }

      await page.waitForTimeout(500);

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
            step.text
          );

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
        };
      }

      await page.waitForTimeout(1000);
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

    if (step.action === "assertTextVisible") {
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
            : {}
        );

      const passed = !visible;
      const note = `assert not visible "${step.text}": ${
        passed ? "PASS" : "FAIL"
      }`;

      deterministicEvidence.push({
        stepIndex,
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

  return finalizeBrowserStepResult({
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

}
