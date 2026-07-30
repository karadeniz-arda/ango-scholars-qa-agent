import type {
  Locator,
  Page,
} from "playwright";

type ComplianceFailureResult = {
  status:
    | "BLOCKED"
    | "MANUAL_REQUIRED";
  reasonCategory:
    | "TEST_DATA_ISSUE"
    | "AUTOMATION_LIMITATION";
  note: string;
};

export type TrolleyComplianceSelectionResult =
  | {
      status: "PASS";
      masterServiceAgreement: string;
      workAuthorization?: string;
      note: string;
    }
  | ComplianceFailureResult;

type OptionSelectionResult =
  | {
      status: "SELECTED";
      text: string;
    }
  | {
      status: "NO_OPTIONS";
    }
  | {
      status: "ERROR";
      note: string;
    };

async function firstVisibleOutsideNavigation(
  locators: Locator[]
): Promise<Locator | null> {
  for (const locator of locators) {
    const count = Math.min(
      await locator
        .count()
        .catch(() => 0),
      30
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const candidate =
        locator.nth(index);

      const visible =
        await candidate
          .isVisible()
          .catch(() => false);

      if (!visible) {
        continue;
      }

      const insideNavigation =
        await candidate
          .evaluate(
            (element: Element) =>
              Boolean(
                element.closest(
                  [
                    "nav",
                    "aside",
                    '[role="navigation"]',
                  ].join(", ")
                )
              )
          )
          .catch(() => true);

      if (!insideNavigation) {
        return candidate;
      }
    }
  }

  return null;
}

async function findVisibleFormItemByLabel(
  page: Page,
  expectedLabel: string
): Promise<Locator | null> {
  const formItems =
    page.locator(".ant-form-item");

  const count = Math.min(
    await formItems
      .count()
      .catch(() => 0),
    100
  );

  const normalizedExpected =
    expectedLabel
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const candidate =
      formItems.nth(index);

    const visible =
      await candidate
        .isVisible()
        .catch(() => false);

    if (!visible) {
      continue;
    }

    const matches =
      await candidate
        .evaluate(
          (
            element: Element,
            expected: string
          ) => {
            const labelElement =
              element.querySelector(
                ".ant-form-item-label"
              );

            const actual = String(
              labelElement?.textContent || ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

            return (
              actual === expected ||
              actual.includes(expected)
            );
          },
          normalizedExpected
        )
        .catch(() => false);

    if (matches) {
      return candidate;
    }
  }

  return null;
}

async function waitForFormItemByLabel(
  page: Page,
  label: string,
  timeoutMs: number
): Promise<Locator | null> {
  const deadline =
    Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const formItem =
      await findVisibleFormItemByLabel(
        page,
        label
      );

    if (formItem) {
      return formItem;
    }

    await page.waitForTimeout(300);
  }

  return null;
}

async function selectFirstEnabledOption(
  page: Page,
  formItem: Locator
): Promise<OptionSelectionResult> {
  const combobox =
    formItem
      .getByRole("combobox")
      .first();

  const comboboxVisible =
    await combobox
      .isVisible()
      .catch(() => false);

  if (!comboboxVisible) {
    return {
      status: "NO_OPTIONS",
    };
  }

  try {
    await combobox.click();
  } catch {
    return {
      status: "ERROR",
      note:
        "The compliance selector was visible " +
        "but could not be opened safely.",
    };
  }

  await page.waitForTimeout(500);

  let options = page.locator(
    [
      ".ant-select-dropdown:visible",
      '[role="option"]',
    ].join(" ")
  );

  let optionCount = 0;

  for (
    let attempt = 0;
    attempt < 25;
    attempt += 1
  ) {
    options = page.locator(
      [
        ".ant-select-dropdown:visible",
        [
          '[role="option"]',
          ".ant-select-item-option",
        ].join(", "),
      ].join(" ")
    );

    optionCount =
      await options
        .count()
        .catch(() => 0);

    if (optionCount > 0) {
      break;
    }

    await page.waitForTimeout(300);
  }

  /*
   * Ant Design may portal the dropdown or omit the
   * expected ARIA role in some rendered states.
   */
  if (optionCount === 0) {
    options = page.locator(
      [
        '[role="option"]:visible',
        ".ant-select-item-option:visible",
      ].join(", ")
    );

    optionCount =
      await options
        .count()
        .catch(() => 0);
  }

  const visibleDropdownCount =
    await page
      .locator(
        ".ant-select-dropdown:visible"
      )
      .count()
      .catch(() => 0);

  const roleOptionCount =
    await page
      .locator(
        '[role="option"]:visible'
      )
      .count()
      .catch(() => 0);

  const classOptionCount =
    await page
      .locator(
        ".ant-select-item-option:visible"
      )
      .count()
      .catch(() => 0);

  console.log(
    " Compliance selector diagnostics: " +
      `dropdowns=${visibleDropdownCount}, ` +
      `roleOptions=${roleOptionCount}, ` +
      `classOptions=${classOptionCount}, ` +
      `candidates=${optionCount}`
  );

  if (optionCount === 0) {
    await page.keyboard
      .press("Escape")
      .catch(() => undefined);

    return {
      status: "NO_OPTIONS",
    };
  }

  const boundedCount =
    Math.min(optionCount, 100);

  for (
    let index = 0;
    index < boundedCount;
    index += 1
  ) {
    const option =
      options.nth(index);

    const visible =
      await option
        .isVisible()
        .catch(() => false);

    if (!visible) {
      continue;
    }

    const disabled =
      await option
        .evaluate(
          (element: Element) =>
            element.getAttribute(
              "aria-disabled"
            ) === "true" ||
            element.classList.contains(
              "ant-select-item-option-disabled"
            )
        )
        .catch(() => true);

    if (disabled) {
      continue;
    }

    const content =
      option.locator(
        ".ant-select-item-option-content"
      );

    const contentText = String(
      await content
        .first()
        .textContent()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

    const optionText =
      contentText ||
      String(
        await option
          .textContent()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim();

    if (!optionText) {
      continue;
    }

    await option
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);

    let clicked = false;

    try {
      await option.click({
        timeout: 5000,
      });

      clicked = true;
    } catch {
      const contentVisible =
        await content
          .first()
          .isVisible()
          .catch(() => false);

      if (contentVisible) {
        try {
          await content
            .first()
            .click({
              timeout: 5000,
            });

          clicked = true;
        } catch {
          clicked = false;
        }
      }
    }

    if (!clicked) {
      continue;
    }

    await page.waitForTimeout(500);

    const selectedText = String(
      await formItem
        .locator(
          ".ant-select-selection-item"
        )
        .first()
        .textContent()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

    if (!selectedText) {
      return {
        status: "ERROR",
        note:
          "An enabled compliance option was " +
          "clicked, but the selected value was " +
          "not reflected in the form field.",
      };
    }

    return {
      status: "SELECTED",
      text: selectedText,
    };
  }

  await page.keyboard
    .press("Escape")
    .catch(() => undefined);

  return {
    status: "ERROR",
    note:
      "Compliance options were visibly " +
      "rendered, but none could be selected " +
      "and verified safely.",
  };
}

export async function selectTrolleyComplianceRequirements(
  page: Page
): Promise<TrolleyComplianceSelectionResult> {
  const complianceStep =
    await firstVisibleOutsideNavigation([
      page.getByRole("tab", {
        name: "Compliance",
        exact: true,
      }),
      page.getByRole("button", {
        name: "Compliance",
        exact: true,
      }),
      page.getByText(
        "Compliance",
        {
          exact: true,
        }
      ),
    ]);

  if (!complianceStep) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "Trolley was selected, but the " +
        "source-grounded Compliance wizard " +
        "step was not safely clickable.",
    };
  }

  try {
    await complianceStep.click();
    await page.waitForTimeout(800);
  } catch {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The Compliance wizard step was " +
        "visible but could not be opened.",
    };
  }

  const msaFormItem =
    await waitForFormItemByLabel(
      page,
      "Master service agreement",
      12000
    );

  if (!msaFormItem) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The Compliance step opened, but the " +
        "source-grounded Master service " +
        "agreement field was not observed.",
    };
  }

  const msaSelection =
    await selectFirstEnabledOption(
      page,
      msaFormItem
    );

  if (
    msaSelection.status ===
    "NO_OPTIONS"
  ) {
    return {
      status: "BLOCKED",
      reasonCategory:
        "TEST_DATA_ISSUE",
      note:
        "Trolley requires a Master service " +
        "agreement, but no selectable MSA " +
        "was available for the current " +
        "company and project.",
    };
  }

  if (
    msaSelection.status === "ERROR"
  ) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The Master service agreement " +
        "could not be selected safely. " +
        msaSelection.note,
    };
  }

  const workAuthorizationFormItem =
    await waitForFormItemByLabel(
      page,
      "Work authorization",
      5000
    );

  if (!workAuthorizationFormItem) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The Master service agreement was " +
        "selected, but the source-grounded " +
        "Work authorization field state " +
        "could not be inspected.",
    };
  }

  const workAuthorizationSelection =
    await selectFirstEnabledOption(
      page,
      workAuthorizationFormItem
    );

  if (
    workAuthorizationSelection.status ===
    "ERROR"
  ) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The Work authorization selector " +
        "could not be handled safely. " +
        workAuthorizationSelection.note,
    };
  }

  const workAuthorization =
    workAuthorizationSelection.status ===
    "SELECTED"
      ? workAuthorizationSelection.text
      : null;

  return {
    status: "PASS",
    masterServiceAgreement:
      msaSelection.text,
    ...(workAuthorization
      ? {
          workAuthorization,
        }
      : {}),
    note:
      "A source-grounded Master service " +
      "agreement was selected. " +
      (workAuthorization
        ? "An available Work authorization " +
          "was also selected."
        : "No selectable Work authorization " +
          "was exposed, so the supported " +
          "missing/system-generated state " +
          "was preserved."),
  };
}
