import type {
  Locator,
  Page,
  Response,
} from "playwright";
import type {
  DeferredCleanup,
  DeferredCleanupResult,
} from "../browser-deferred-cleanup.js";
import {
  observeMutationResponse,
  type ObservedMutationResponse,
} from "../browser-mutation-response.js";
import type {
  BrowserFixtureProvider,
  BrowserFixtureProviderContext,
  BrowserFixtureProviderResult,
} from "./browser-fixture-types.js";

const DEFAULT_LANGUAGE =
  "Chinese (Mandarin)";

const DEFAULT_PROFICIENCY =
  "B2";

function normalizeText(
  value: unknown
): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

async function waitForFirstVisible(
  locator: Locator,
  timeoutMs = 10000,
  limit = 40
): Promise<Locator | null> {
  const deadline =
    Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const count = Math.min(
      await locator
        .count()
        .catch(() => 0),
      limit
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
          .isVisible({
            timeout: 250,
          })
          .catch(() => false);

      if (visible) {
        return candidate;
      }
    }

    await new Promise<void>(
      (resolve) => {
        setTimeout(resolve, 200);
      }
    );
  }

  return null;
}

function isTalentProfileUpdateResponse(
  response: Response
): boolean {
  try {
    const parsed =
      new URL(response.url());

    return /\/talents\/[1-9]\d*\/?$/i.test(
      parsed.pathname
    );
  } catch {
    return false;
  }
}

function findNumberArrayByKey(
  value: unknown,
  key: string,
  seen = new Set<unknown>()
): number[] | null {
  if (
    typeof value !== "object" ||
    value === null ||
    seen.has(value)
  ) {
    return null;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested =
        findNumberArrayByKey(
          item,
          key,
          seen
        );

      if (nested) {
        return nested;
      }
    }

    return null;
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  const direct = record[key];

  if (
    Array.isArray(direct) &&
    direct.every(
      (item) =>
        typeof item === "number" &&
        Number.isFinite(item)
    )
  ) {
    return [...direct] as number[];
  }

  for (
    const nestedValue of
    Object.values(record)
  ) {
    const nested =
      findNumberArrayByKey(
        nestedValue,
        key,
        seen
      );

    if (nested) {
      return nested;
    }
  }

  return null;
}

async function clickSaveAndObserve(
  page: Page
): Promise<
  ObservedMutationResponse | null
> {
  const saveButton =
    await waitForFirstVisible(
      page.getByRole(
        "button",
        {
          name:
            /^save changes$/i,
        }
      ),
      10000
    );

  if (!saveButton) {
    return null;
  }

  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    const enabled =
      await saveButton
        .isEnabled()
        .catch(() => false);

    if (enabled) {
      break;
    }

    await page.waitForTimeout(250);
  }

  const enabled =
    await saveButton
      .isEnabled()
      .catch(() => false);

  if (!enabled) {
    return null;
  }

  return observeMutationResponse(
    page,
    {
      method: "POST",
      matchesResponse:
        isTalentProfileUpdateResponse,
      trigger: () =>
        saveButton.click({
          timeout: 10000,
        }),
      timeoutMs: 30000,
    }
  );
}

async function closeLanguagePopovers(
  page: Page
): Promise<void> {
  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    await page.keyboard
      .press("Escape")
      .catch(() => undefined);

    await page.waitForTimeout(150);
  }
}

async function isTalentLanguageSurfaceReady(
  page: Page
): Promise<boolean> {
  const emptyStateVisible =
    await page
      .getByText(
        "No languages added yet",
        {
          exact: true,
        }
      )
      .isVisible({
        timeout: 500,
      })
      .catch(() => false);

  if (emptyStateVisible) {
    return true;
  }

  const addButtonVisible =
    await page
      .getByRole(
        "button",
        {
          name: /add language/i,
        }
      )
      .first()
      .isVisible({
        timeout: 500,
      })
      .catch(() => false);

  return addButtonVisible;
}

async function navigateToTalentLanguages(
  page: Page
): Promise<boolean> {
  if (
    await isTalentLanguageSurfaceReady(
      page
    )
  ) {
    return true;
  }

  const tab =
    await waitForFirstVisible(
      page.getByText(
        /^skills\s*&\s*languages$/i
      ),
      10000
    );

  if (!tab) {
    return false;
  }

  await tab.click({
    timeout: 10000,
  });

  const deadline =
    Date.now() + 15000;

  while (Date.now() <= deadline) {
    if (
      await isTalentLanguageSurfaceReady(
        page
      )
    ) {
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

async function selectPreferredOption(
  page: Page,
  popoverSelector: string,
  preferredText: string,
  validText?: RegExp
): Promise<{
  locator: Locator;
  text: string;
} | null> {
  const popover =
    page.locator(
      `${popoverSelector}:visible`
    );

  const popoverVisible =
    await popover
      .waitFor({
        state: "visible",
        timeout: 15000,
      })
      .then(() => true)
      .catch(() => false);

  if (!popoverVisible) {
    return null;
  }

  const preferredPattern =
    new RegExp(
      `^\\s*${escapeRegExp(
        preferredText
      )}(?:\\s+.*)?\\s*$`,
      "i"
    );

  const preferred =
    await waitForFirstVisible(
      popover.getByRole(
        "button",
        {
          name:
            preferredPattern,
        }
      ),
      3000
    );

  if (preferred) {
    return {
      locator: preferred,
      text: normalizeText(
        await preferred
          .innerText()
          .catch(() => "")
      ),
    };
  }

  const options =
    popover.locator("button");

  const first =
    await waitForFirstVisible(
      options,
      15000
    );

  if (!first) {
    return null;
  }

  const count = Math.min(
    await options
      .count()
      .catch(() => 0),
    40
  );

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const candidate =
      options.nth(index);

    const visible =
      await candidate
        .isVisible({
          timeout: 250,
        })
        .catch(() => false);

    if (!visible) {
      continue;
    }

    const text =
      normalizeText(
        await candidate
          .innerText()
          .catch(() => "")
      );

    if (
      text &&
      (
        !validText ||
        validText.test(text)
      )
    ) {
      return {
        locator: candidate,
        text,
      };
    }
  }

  return null;
}

function buildLanguageCleanup(
  context:
    BrowserFixtureProviderContext,
  selectedLanguage: string
): DeferredCleanup {
  const {
    page,
  } = context;

  return {
    label:
      `talent profile language ` +
      selectedLanguage,

    evidenceAction:
      "cleanupBrowserFixture",

    expected:
      "Remove the exact UI-provisioned language and restore the original empty profile-language state",

    notePrefix:
      "Talent profile language cleanup",

    run:
      async (): Promise<
        DeferredCleanupResult
      > => {
        await closeLanguagePopovers(
          page
        );

        const removeButton =
          await waitForFirstVisible(
            page.getByRole(
              "button",
              {
                name:
                  /^remove language$/i,
              }
            ),
            5000
          );

        if (removeButton) {
          await removeButton.click({
            timeout: 10000,
          });
        }

        const emptyState =
          page.getByText(
            "No languages added yet",
            {
              exact: true,
            }
          );

        const emptyVisible =
          await emptyState
            .waitFor({
              state: "visible",
              timeout: 10000,
            })
            .then(() => true)
            .catch(() => false);

        if (!emptyVisible) {
          return {
            status: "FAIL",
            note:
              "The exact provisioned language row could not be removed from the profile form.",
          };
        }

        const saveButton =
          await waitForFirstVisible(
            page.getByRole(
              "button",
              {
                name:
                  /^save changes$/i,
              }
            ),
            5000
          );

        if (!saveButton) {
          return {
            status: "FAIL",
            note:
              "Save changes was unavailable while restoring the empty profile-language state.",
          };
        }

        let saveEnabled = false;

        for (
          let attempt = 0;
          attempt < 20;
          attempt += 1
        ) {
          saveEnabled =
            await saveButton
              .isEnabled()
              .catch(() => false);

          if (saveEnabled) {
            break;
          }

          await page.waitForTimeout(
            250
          );
        }

        if (!saveEnabled) {
          return {
            status: "FAIL",
            note:
              "The cleanup Save changes control did not become enabled, so persisted profile restoration could not be proven.",
          };
        }

        const cleanupMutation =
          await clickSaveAndObserve(
            page
          );

        if (!cleanupMutation) {
          return {
            status: "FAIL",
            note:
              "The cleanup profile-update response was not observed.",
          };
        }

        const status =
          cleanupMutation
            .response
            .status();

        const languageIds =
          findNumberArrayByKey(
            cleanupMutation
              .requestBody,
            "languageIds"
          );

        const restored =
          status >= 200 &&
          status < 300 &&
          Array.isArray(
            languageIds
          ) &&
          languageIds.length === 0;

        if (!restored) {
          return {
            status: "FAIL",
            note:
              `Cleanup update returned ` +
              `status=${status}; ` +
              `languageIds=` +
              `${JSON.stringify(
                languageIds
              )}.`,
          };
        }

        await emptyState
          .waitFor({
            state: "visible",
            timeout: 10000,
          })
          .catch(() => undefined);

        return {
          status: "PASS",
          note:
            `Removed UI-provisioned language ` +
            `${selectedLanguage}; ` +
            "profile update returned a 2xx response with an empty languageIds list.",
        };
      },
  };
}

function blockedResult(
  reasonCategory: string,
  note: string,
  cleanups:
    DeferredCleanup[] = []
): BrowserFixtureProviderResult {
  return {
    status: "BLOCKED",
    reasonCategory,
    notes: [note],
    deterministicEvidence: [],
    cleanups,
  };
}

async function prepareTalentLanguageFixture(
  context:
    BrowserFixtureProviderContext
): Promise<
  BrowserFixtureProviderResult
> {
  const {
    page,
    captureCheckpoint,
    registerCleanup,
  } = context;

  const surfaceReady =
    await navigateToTalentLanguages(
      page
    );

  if (!surfaceReady) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      "The Skills & Languages profile surface could not be reached."
    );
  }

  const emptyState =
    page.getByText(
      "No languages added yet",
      {
        exact: true,
      }
    );

  const emptyStateVisible =
    await emptyState
      .waitFor({
        state: "visible",
        timeout: 5000,
      })
      .then(() => true)
      .catch(() => false);

  if (!emptyStateVisible) {
    return blockedResult(
      "FIXTURE_PRECONDITION_UNSAFE",
      "UI provisioning requires the QA talent profile to start with zero languages so cleanup can restore the exact original state."
    );
  }

  const addLanguageButton =
    (
      await waitForFirstVisible(
        page.getByRole(
          "button",
          {
            name:
              /add language/i,
          }
        ),
        10000
      )
    ) ??
    (
      await waitForFirstVisible(
        page
          .locator("button")
          .filter({
            hasText:
              /add language/i,
          }),
        5000
      )
    );

  if (!addLanguageButton) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      "The Add language button was unavailable on the Skills & Languages profile surface."
    );
  }

  await addLanguageButton.click({
    timeout: 10000,
  });

  const languageTrigger =
    await waitForFirstVisible(
      page.getByPlaceholder(
        "Select language"
      ),
      10000
    );

  if (!languageTrigger) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      "The new language row did not expose the Select language control."
    );
  }

  await languageTrigger.click({
    timeout: 10000,
  });

  const preferredLanguage =
    normalizeText(
      process.env
        .QA_FIXTURE_LANGUAGE ||
        DEFAULT_LANGUAGE
    ) || DEFAULT_LANGUAGE;

  const languageOption =
    await selectPreferredOption(
      page,
      ".language-selector-popover",
      preferredLanguage
    );

  if (
    !languageOption ||
    !languageOption.text
  ) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      "No selectable language option became visible after the language selector opened."
    );
  }

  const selectedLanguage =
    languageOption.text;

  await languageOption
    .locator
    .click({
      timeout: 10000,
    });

  const proficiencyTrigger =
    await waitForFirstVisible(
      page.getByPlaceholder(
        "Select proficiency"
      ),
      10000
    );

  if (!proficiencyTrigger) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      `The selected language ` +
        `${selectedLanguage} did not ` +
        "expose the Select proficiency control."
    );
  }

  await proficiencyTrigger.click({
    timeout: 10000,
  });

  const proficiencyOption =
    await selectPreferredOption(
      page,
      ".language-proficiency-selector-popover",
      DEFAULT_PROFICIENCY,
      /\b(?:A1|A2|B1|B2|C1|C2)\b/i
    );

  if (
    !proficiencyOption ||
    !/\b(?:A1|A2|B1|B2|C1|C2)\b/i.test(
      proficiencyOption.text
    )
  ) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      `No CEFR A1-C2 proficiency option became visible for ${selectedLanguage}.`
    );
  }

  const selectedProficiency =
    proficiencyOption.text;

  await proficiencyOption
    .locator
    .click({
      timeout: 10000,
    });

  const cleanup =
    buildLanguageCleanup(
      context,
      selectedLanguage
    );

  registerCleanup?.(cleanup);

  const setupMutation =
    await clickSaveAndObserve(
      page
    );

  if (!setupMutation) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      "The profile-update response was not observed after Save changes.",
      [cleanup]
    );
  }

  const setupStatus =
    setupMutation
      .response
      .status();

  const languageIds =
    findNumberArrayByKey(
      setupMutation.requestBody,
      "languageIds"
    );

  if (
    setupStatus < 200 ||
    setupStatus >= 300 ||
    !Array.isArray(languageIds) ||
    languageIds.length < 4
  ) {
    return blockedResult(
      "FIXTURE_PROVISIONING_FAILED",
      `Profile update returned ` +
        `status=${setupStatus}; ` +
        `languageIds=` +
        `${JSON.stringify(
          languageIds
        )}. ` +
        "At least four persisted language-mode IDs are required.",
      [cleanup]
    );
  }

  await captureCheckpoint?.({
    phase: "setup",
    label:
      "language-provisioned",
    note:
      `Provisioned ${selectedLanguage} ` +
      `with ${selectedProficiency}; ` +
      `profile update returned ` +
      `${setupStatus} with ` +
      `${languageIds.length} ` +
      "language-mode IDs.",
    fullPage: true,
  });

  const adjustmentButton =
    await waitForFirstVisible(
      page.getByRole(
        "button",
        {
          name:
            /^level adjustment$/i,
        }
      ),
      10000
    );

  let surfaceNote =
    "Level Adjustment was not opened; canonical assertions will determine the visible product behavior.";

  if (adjustmentButton) {
    const clicked =
      await adjustmentButton
        .click({
          timeout: 10000,
        })
        .then(() => true)
        .catch(() => false);

    if (clicked) {
      const adjustmentPopover =
        page.locator(
          ".shared-language-adjustment-popover:visible"
        );

      const opened =
        await adjustmentPopover
          .waitFor({
            state: "visible",
            timeout: 10000,
          })
          .then(() => true)
          .catch(() => false);

      surfaceNote = opened
        ? "Level Adjustment was opened for the canonical AS-1058 assertions."
        : "Level Adjustment was clicked but its popover did not become visible; canonical assertions will determine the product result.";
    }
  }

  const setupNote =
    `UI-provisioned language ` +
    `${selectedLanguage} with ` +
    `${selectedProficiency}; ` +
    `profile update returned ` +
    `${setupStatus} with ` +
    `${languageIds.length} ` +
    `language-mode IDs. ` +
    surfaceNote;

  return {
    status: "READY",
    notes: [setupNote],
    deterministicEvidence: [
      {
        stepIndex: 0,
        action:
          "provisionBrowserFixture",
        expected:
          "Create one exact talent-profile language fixture through the UI before canonical assertions",
        passed: true,
        note: setupNote,
      },
    ],
    cleanups: [cleanup],
  };
}

export const talentProfileLanguageFixtureProvider:
  BrowserFixtureProvider = {
    id:
      "talent-profile-language",

    getEntryRoute: () =>
      "/talent/profile",

    supports: ({
      issueKey,
      testCase,
    }) =>
      issueKey === "AS-1058" &&
      String(
        testCase?.id || ""
      ) === "web-1" &&
      String(
        testCase?.persona || ""
      ).toLowerCase() ===
        "talent",

    prepare:
      prepareTalentLanguageFixture,
  };
