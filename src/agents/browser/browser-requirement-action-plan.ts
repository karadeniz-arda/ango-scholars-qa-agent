import type {
  BrowserStep,
} from "./browser-execution-types.js";

export type RequirementActionPlan = {
  steps: BrowserStep[];
  notes: string[];
};

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function requiresEveryVisibleMenuSelection(
  testCase: any
): boolean {
  const successCriteria = normalize(
    testCase?.successCriteria
  );

  /*
   * GENERIC_BROWSER_CANONICAL_MENU_SURFACE_ORACLE_V1
   *
   * Acceptance wording may describe the same requirement as
   * "when each option is selected", "after each option is
   * selected", or directly "select each option".
   */
  const requiresEverySelection =
    /\b(?:when|after)\s+each\s+(?:option|choice)\s+is\s+selected\b/.test(
      successCriteria
    ) ||
    /\beach\s+(?:option|choice)\s+is\s+selected\b/.test(
      successCriteria
    ) ||
    /\bselect(?:\s+and\s+verify)?\s+each\s+(?:option|choice)\b/.test(
      successCriteria
    );

  const requiresVisibleSelectedValue =
    /\bvisible\s+selected\s+(?:value|option|choice)\b/.test(
      successCriteria
    ) ||
    /\bselected\s+(?:value|option|choice)\s+is\s+(?:visible|correct)\b/.test(
      successCriteria
    );

  return (
    requiresEverySelection &&
    requiresVisibleSelectedValue
  );
}

type VisibleTextAssertion = Extract<
  BrowserStep,
  { action: "assertTextVisible" }
>;

function collectConsecutiveVisibleAssertions(
  steps: BrowserStep[],
  startIndex: number
): {
  assertions: VisibleTextAssertion[];
  cursor: number;
} {
  const assertions:
    VisibleTextAssertion[] = [];

  let cursor = startIndex;

  while (
    steps[cursor]?.action ===
      "assertTextVisible"
  ) {
    assertions.push(
      steps[cursor] as
        VisibleTextAssertion
    );

    cursor += 1;
  }

  return {
    assertions,
    cursor,
  };
}

function canPromoteMenuAssertions(
  assertions: VisibleTextAssertion[]
): boolean {
  if (assertions.length < 2) {
    return false;
  }

  /*
   * Multiple canonical oracle identities cannot safely collapse
   * into one aggregate assertion identity. Preserve the original
   * steps instead of discarding that metadata.
   */
  if (
    assertions.some(
      (assertion) =>
        Boolean(
          String(
            assertion.oracleId || ""
          ).trim()
        )
    )
  ) {
    return false;
  }

  const criticalities =
    new Set(
      assertions
        .map(
          (assertion) =>
            assertion.acceptanceCritical
        )
        .filter(
          (
            value
          ): value is boolean =>
            value !== undefined
        )
    );

  if (criticalities.size > 1) {
    return false;
  }

  const normalizedLabels =
    assertions.map(
      (assertion) =>
        normalize(assertion.text)
    );

  return (
    normalizedLabels.every(Boolean) &&
    new Set(
      normalizedLabels
    ).size ===
      normalizedLabels.length
  );
}

function buildMenuSurfaceAssertion(
  assertions: VisibleTextAssertion[]
): Extract<
  BrowserStep,
  { action: "assertSurfaceControls" }
> {
  const criticality =
    assertions.find(
      (assertion) =>
        assertion.acceptanceCritical !==
        undefined
    )?.acceptanceCritical;

  return {
    action:
      "assertSurfaceControls",
    surfaceKind: "menu",
    controls:
      assertions.map(
        (assertion) => ({
          kind:
            "menuitem" as const,
          label:
            assertion.text,
        })
      ),
    ...(criticality !== undefined
      ? {
          acceptanceCritical:
            criticality,
        }
      : {}),
  };
}

/**
 * Expands canonical assertions into safe runtime actions only
 * when the acceptance criteria explicitly require every
 * listed menu option to be selected and visibly verified.
 *
 * The source plan remains untouched. Option labels and menu
 * identity come exclusively from the canonical case.
 */
export function buildRequirementActionPlan(
  testCase: any
): RequirementActionPlan {
  const canonicalSteps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps as BrowserStep[]
    : [];

  const requiresEverySelection =
    requiresEveryVisibleMenuSelection(
      testCase
    );

  const runtimeSteps: BrowserStep[] = [];
  const notes: string[] = [];

  for (
    let index = 0;
    index < canonicalSteps.length;
    index += 1
  ) {
    const step =
      canonicalSteps[index];

    if (!step) {
      continue;
    }

    if (step.action !== "openMenu") {
      runtimeSteps.push(step);
      continue;
    }

    const {
      assertions:
        optionAssertions,
      cursor,
    } =
      collectConsecutiveVisibleAssertions(
        canonicalSteps,
        index + 1
      );

    if (
      !canPromoteMenuAssertions(
        optionAssertions
      )
    ) {
      /*
       * Preserve the pre-existing selection expansion when
       * structural promotion is unsafe because canonical
       * assertion metadata cannot be aggregated losslessly.
       */
      if (
        requiresEverySelection &&
        optionAssertions.length >= 2
      ) {
        runtimeSteps.push(step);

        optionAssertions.forEach(
          (
            assertion,
            optionIndex
          ) => {
            runtimeSteps.push(
              assertion
            );

            runtimeSteps.push({
              action:
                "selectOption",
              text:
                assertion.text,
            });

            if (
              optionIndex <
              optionAssertions.length - 1
            ) {
              runtimeSteps.push(
                step
              );
            }
          }
        );

        notes.push(
          `Requirement action plan expanded menu ` +
            `"${step.text}" into ` +
            `${optionAssertions.length} observed ` +
            `selection-and-verification transitions ` +
            `without structural aggregation because ` +
            `canonical assertion metadata must be preserved.`
        );

        index = cursor - 1;
        continue;
      }

      runtimeSteps.push(step);
      continue;
    }

    /*
     * GENERIC_BROWSER_CANONICAL_MENU_SURFACE_ORACLE_V1
     *
     * A canonical openMenu followed by two or more distinct
     * visibility assertions already declares a set of expected
     * menu choices.
     *
     * Upgrade that availability requirement to one structural
     * oracle scoped to the uniquely observed semantic menu.
     *
     * Labels come only from canonical assertions. No product
     * literals, DOM order, geometry or global label uniqueness
     * are introduced here.
     */
    runtimeSteps.push(
      step,
      buildMenuSurfaceAssertion(
        optionAssertions
      )
    );

    notes.push(
      `Requirement action plan promoted ` +
        `${optionAssertions.length} canonical ` +
        `menu option visibility assertions for ` +
        `"${step.text}" into one scoped semantic ` +
        `menu-control assertion.`
    );

    if (requiresEverySelection) {
      optionAssertions.forEach(
        (
          assertion,
          optionIndex
        ) => {
          runtimeSteps.push({
            action:
              "selectOption",
            text:
              assertion.text,
          });

          if (
            optionIndex <
            optionAssertions.length - 1
          ) {
            runtimeSteps.push(
              step
            );
          }
        }
      );

      notes.push(
        `Requirement action plan expanded menu ` +
          `"${step.text}" into ` +
          `${optionAssertions.length} ` +
          `selected-state verification transitions.`
      );
    }

    index = cursor - 1;
  }

  return {
    steps: runtimeSteps,
    notes,
  };
}
