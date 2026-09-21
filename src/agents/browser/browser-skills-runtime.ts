import type {
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";
import {
  deriveSkillsRuntimeRequirements,
  mergeSkillsRuntimeQuery,
  type SkillsRuntimeFixture,
} from "../api/skills-runtime-resolver.js";

export type BrowserSkillsRuntimeResult =
  | {
      status: "NOT_REQUIRED";
    }
  | {
      status: "READY";
      path: string;
      skillLabels: string[];
    }
  | {
      status: "BLOCKED";
      reason: string;
    };

function exactRuntimeFixture(
  context:
    RuntimeResourceContext
): SkillsRuntimeFixture | null {
  const skillIds =
    context.skillIds ?? [];
  const skillLabels =
    context.skillLabels ?? [];

  if (
    skillIds.length === 0 ||
    skillIds.length !==
      skillLabels.length ||
    new Set(skillIds).size !==
      skillIds.length ||
    new Set(skillLabels).size !==
      skillLabels.length ||
    skillIds.some(
      (id) => !/^\d+$/.test(id)
    ) ||
    skillLabels.some(
      (label) => !label.trim()
    )
  ) {
    return null;
  }

  return {
    skillIds: [...skillIds],
    skillLabels:
      skillLabels.map(
        (label) => label.trim()
      ),
    ...(context.skillCategory
      ? {
          category:
            context.skillCategory,
        }
      : {}),
    ...(context.mainDiscipline
      ? {
          mainDiscipline:
            context.mainDiscipline,
        }
      : {}),
  };
}

export function applyBrowserSkillsRuntime(
  plan: any,
  testCase: any,
  context:
    RuntimeResourceContext = {}
): BrowserSkillsRuntimeResult {
  const requirements =
    deriveSkillsRuntimeRequirements({
      summary: plan?.summary,
      notes: plan?.notes,
      apiCases: [],
      browserCases: [testCase],
    });

  if (
    !requirements.requiresSelectedSkills
  ) {
    return {
      status: "NOT_REQUIRED",
    };
  }

  const fixture =
    exactRuntimeFixture(context);

  if (!fixture) {
    return {
      status: "BLOCKED",
      reason:
        "Selected-skill browser state requires one exact shared runtime ID and user-facing label per selected record.",
    };
  }

  if (
    fixture.skillIds.length !==
    requirements.selectedSkillCount
  ) {
    return {
      status: "BLOCKED",
      reason:
        "The shared API/browser selected-skill count disagrees with the canonical requirement.",
    };
  }

  const queryResult =
    mergeSkillsRuntimeQuery(
      String(
        testCase?.startRoute || ""
      ),
      fixture,
      requirements
    );

  if (queryResult.status === "BLOCKED") {
    return queryResult;
  }

  testCase.startRoute =
    queryResult.path;

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const existingAssertions =
    new Set(
      steps
        .filter(
          (step: any) =>
            step?.action ===
            "assertTextVisible"
        )
        .map((step: any) =>
          String(
            step?.text || ""
          )
            .trim()
            .toLowerCase()
        )
    );

  const selectedStateAssertions =
    fixture.skillLabels
      .filter(
        (label) =>
          !existingAssertions.has(
            label.toLowerCase()
          )
      )
      .map((label) => ({
        action:
          "assertTextVisible" as const,
        text: label,

        /*
         * RUNTIME_SKILL_OBSERVATION_CRITICALITY_V1
         *
         * This text comes from a runtime-selected fixture
         * record and is not a canonical planner acceptance
         * assertion.
         */
        acceptanceCritical: false,
      }));

  const firstNonWaitIndex =
    steps.findIndex(
      (step: any) =>
        step?.action !== "wait"
    );

  const insertionIndex =
    firstNonWaitIndex === -1
      ? steps.length
      : firstNonWaitIndex;

  testCase.steps = [
    ...steps.slice(0, insertionIndex),
    ...selectedStateAssertions,
    ...steps.slice(insertionIndex),
  ];

  testCase
    .runtimeSelectedSkillFixtureResolved =
    true;

  return {
    status: "READY",
    path: queryResult.path,
    skillLabels:
      [...fixture.skillLabels],
  };
}
