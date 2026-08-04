import type {
  Page,
} from "playwright";
import {
  clickSmartButton,
  clickSmartText,
} from "./generic-browser-actions.js";
import {
  getBrowserCaseText,
} from "./browser-case-relevance.js";

export async function cancelAssessmentEditIfOpen(
  page: Page,
  testCase: any
): Promise<void> {
  if (
    !isAssessmentLanguageModalCase(
      testCase
    )
  ) {
    return;
  }

  const openDialog = page
    .locator(
      '[role="dialog"]:visible, .ant-modal-wrap:visible'
    )
    .last();

  const dialogVisible = await openDialog
    .isVisible({
      timeout: 1000,
    })
    .catch(() => false);

if (dialogVisible) {
  const levelAdjustmentPanelOpen =
    await page
      .getByText(
        /^Listening\*?$/i
      )
      .first()
      .isVisible({
        timeout: 500,
      })
      .catch(() => false);

  if (levelAdjustmentPanelOpen) {
    const levelAdjustmentButton =
      page
        .getByRole("button", {
          name: /level adjustment/i,
        })
        .first();

    const adjustmentButtonVisible =
      await levelAdjustmentButton
        .isVisible({
          timeout: 500,
        })
        .catch(() => false);

    if (adjustmentButtonVisible) {
      await levelAdjustmentButton.click();
      await page.waitForTimeout(250);

      console.log(
        ` Assessment level adjustment panel ` +
          `closed for ${testCase.id}`
      );
    }
  }

  const modalCancel = openDialog
      .getByRole("button", {
        name: /^cancel$/i,
      })
      .first();

    const modalCancelVisible =
      await modalCancel
        .isVisible({
          timeout: 1000,
        })
        .catch(() => false);

    if (modalCancelVisible) {
      await modalCancel.click();

      console.log(
        ` Assessment language dialog cancelled ` +
          `for ${testCase.id}`
      );
    } else {
      const modalClose = openDialog
        .locator(
          ".ant-modal-close"
        )
        .first();

      const modalCloseVisible =
        await modalClose
          .isVisible({
            timeout: 1000,
          })
          .catch(() => false);

      if (modalCloseVisible) {
        await modalClose.click();

        console.log(
          ` Assessment language dialog closed ` +
            `for ${testCase.id}`
        );
      }
    }

    await page.waitForTimeout(500);
  }

  const cancelEditButton = page
    .getByRole("button", {
      name: /^cancel edit$/i,
    })
    .first();

  const cancelEditVisible =
    await cancelEditButton
      .isVisible({
        timeout: 1000,
      })
      .catch(() => false);

  if (!cancelEditVisible) {
    return;
  }

  await cancelEditButton.click();
  await page.waitForTimeout(500);

  console.log(
    ` Assessment edit flow cancelled for ` +
      `${testCase.id}`
  );
}

export async function logVisibleAssessmentControls(
  page: Page,
  testCase: any
): Promise<void> {
  const caseText = getBrowserCaseText(testCase);

  if (!caseText.includes("assessment")) {
    return;
  }

  const labels = await page.evaluate(() => {
    const selectors = [
      "button",
      "a",
      '[role="button"]',
      '[role="tab"]',
      '[aria-label]',
      "h1",
      "h2",
      "h3",
    ];

    const elements = Array.from(
      document.querySelectorAll(
        selectors.join(",")
      )
    ) as HTMLElement[];

    const values = elements
      .filter((element) => {
        const rect =
          element.getBoundingClientRect();

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        );
      })
      .map((element) => {
        return String(
          element.getAttribute("aria-label") ||
            element.innerText ||
            element.textContent ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      })
      .filter((value) => {
        return (
          value.length > 0 &&
          value.length <= 120
        );
      });

    return Array.from(new Set(values))
      .slice(0, 80);
  });

  console.log(
    ` Assessment UI controls for ` +
      `${testCase.id}: ` +
      `${labels.join(" | ") || "none"}`
  );
}

export function browserEditFlowsAllowed(): boolean {
  return (
    process.env.QA_ALLOW_BROWSER_EDIT_FLOWS ===
    "true"
  );
}

/*
 * ASSESSMENT_LANGUAGE_PERSISTENCE_GUARD_V1
 *
 * Opening Edit, Configure or Level Adjustment is safe when
 * the case is observational and the runner exits with Cancel.
 * Only actions that can persist or submit changes require the
 * explicit edit-flow safety flag.
 */
export function hasAssessmentLanguagePersistMutationStep(
  testCase: any
): boolean {
  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const persistenceText =
    /\b(save|submit|update|create|delete|remove|confirm|approve|reject|publish|complete|upload|reupload|send)\b/i;

  return steps.some((step: any) => {
    const action = String(
      step?.action || ""
    ).trim();

    if (
      action ===
      "createDraftJobAndVerifyRedirect"
    ) {
      return true;
    }

    if (
      action !== "clickButton" &&
      action !== "clickText"
    ) {
      return false;
    }

    return persistenceText.test(
      String(step?.text || "").trim()
    );
  });
}

export function isAssessmentLanguageCase(
  testCase: any
): boolean {
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

  return (
    caseText.includes("assessment") &&
    [
      "language",
      "proficiency",
      "listening",
      "speaking",
      "writing",
      "reading",
    ].some((term) =>
      caseText.includes(term)
    )
  );
}

export function isAssessmentLanguageModalCase(
  testCase: any
): boolean {
const caseText = [
  String(testCase?.goal || ""),
  String(
    testCase?.successCriteria || ""
  ),
  ...(Array.isArray(
    testCase?.automatedChecks
  )
    ? testCase.automatedChecks
    : []),
  ...(Array.isArray(
    testCase?.manualChecks
  )
    ? testCase.manualChecks
    : []),
  ...(Array.isArray(
    testCase?.fixtureRequirements
  )
    ? testCase.fixtureRequirements
    : []),
]
  .map((value) =>
    String(value || "")
  )
  .join(" ")
  .toLowerCase()
  .replace(/[-_]+/g, " ");

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const hasEditorNavigationStep =
    steps.some((step: any) => {
      if (
        step?.action !== "clickButton"
      ) {
        return false;
      }

      const text = String(
        step?.text || ""
      )
        .trim()
        .toLowerCase();

      return (
        text === "configure" ||
        text === "level adjustment"
      );
    });
  const hasEditorScope =
  caseText.includes(
    "language requirements"
  ) &&
  [
    "level adjustment",
    "proficiency level",
    "configure",
    "edit state",
    "edit assessment",
    "editing",
  ].some((term) =>
    caseText.includes(term)
  );

  return (
    isAssessmentLanguageCase(testCase) &&
    (
 hasEditorNavigationStep ||
hasEditorScope ||
      [
        "modal",
        "editor",
        "edit flow",
        "edit assessment",
        "editing",
      ].some((term) =>
        caseText.includes(term)
      )
    )
  );
}

export function ensureAssessmentLanguageReadOnlyNavigationStep(
  testCase: any
): void {
  const caseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  const requiresReadOnlyDetailsState =
    isAssessmentLanguageCase(testCase) &&
    !isAssessmentLanguageModalCase(
      testCase
    ) &&
    [
      "details",
      "detail",
      "review",
      "summary",
    ].some((term) =>
      caseText.includes(term)
    );

  if (!requiresReadOnlyDetailsState) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const alreadyNavigatesToDetails =
    steps.some(
      (step: any) =>
        step?.action === "clickTopTab" &&
        /^details$/i.test(
          String(
            step?.text || ""
          ).trim()
        )
    );

  if (alreadyNavigatesToDetails) {
    return;
  }

  testCase.steps = [
    {
      action: "clickTopTab",
      text: "Details",
    },
    ...steps,
  ];

  console.log(
    ` Assessment language read-only navigation ` +
      `added for ${testCase.id}: Details`
  );
}

export function ensureAssessmentLanguageEditorNavigationStep(
  testCase: any
): void {
  if (
    !isAssessmentLanguageModalCase(
      testCase
    )
  ) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const isEditorNavigationStep = (
    step: any
  ): boolean => {
    if (
      step?.action !== "clickButton"
    ) {
      return false;
    }

    const text = String(
      step?.text || ""
    )
      .trim()
      .toLowerCase();

    return (
      text === "configure" ||
      text === "level adjustment"
    );
  };

  testCase.steps = [
    {
      action: "clickButton",
      text: "Configure",
    },
    {
      action: "clickButton",
      text: "Level Adjustment",
    },
    ...steps.filter(
      (step: any) =>
        !isEditorNavigationStep(step)
    ),
  ];

  console.log(
    ` Assessment language editor navigation ` +
      `added for ${testCase.id}: ` +
      `Configure -> Level Adjustment`
  );
}

export async function prepareAssessmentLanguageModal(
  page: Page,
  testCase: any
): Promise<void> {
  if (
    !isAssessmentLanguageModalCase(testCase)
  ) {
    return;
  }

  if (
    hasAssessmentLanguagePersistMutationStep(
      testCase
    ) &&
    !browserEditFlowsAllowed()
  ) {
    console.log(
      ` Assessment modal opener skipped for ` +
        `${testCase.id}: the case contains a ` +
        `persistent edit action and browser edit ` +
        `flows are disabled by default.`
    );

    return;
  }

  const cancelEditButton =
    page
      .getByRole("button", {
        name: /^cancel edit$/i,
      })
      .first();

  const editModeAlreadyOpen =
    await cancelEditButton
      .isVisible({
        timeout: 700,
      })
      .catch(() => false);

  if (editModeAlreadyOpen) {
    console.log(
      ` Assessment modal opener reused existing ` +
        `edit mode for ${testCase.id}`
    );

    return;
  }

  console.log(
    ` Assessment modal opener starting for ${testCase.id}`
  );

  let result = await clickSmartButton(
    page,
    "Edit"
  );

  if (!result.ok) {
    result = await clickSmartText(
      page,
      "Edit"
    );
  }

  console.log(
    ` Assessment modal opener: ${result.note}`
  );

  if (!result.ok) {
    console.log(
      " Assessment modal opener could not click Edit."
    );
    return;
  }

  await page.waitForTimeout(1500);

  await logVisibleAssessmentControls(
    page,
    {
      ...testCase,
      id: `${testCase.id}-after-edit`,
    }
  );
}
