import fs from "node:fs";
import path from "node:path";
import {
  runGenericFixtureCandidateSelection,
  type GenericFixtureCandidateInput,
} from "../src/agents/browser/fixtures/generic-fixture-candidate-selector.js";

type ShadowCase = {
  issueKey: string;
  caseId: string;
};

const cases: ShadowCase[] = [
  {
    issueKey: "AS-1165",
    caseId: "web-3",
  },
  {
    issueKey: "AS-1190",
    caseId: "web-1",
  },
];

const candidates:
  GenericFixtureCandidateInput[] = [
    {
      id: "semantic-general",
      label: "General profile",
      semanticCapabilities: {
        title: "General profile",
        description:
          "Representative onboarding steps",
        requiresDocument: false,
        requiresApproval: false,
      },
    },
    {
      id: "semantic-document",
      label:
        "Document-required profile",
      semanticCapabilities: {
        title:
          "Document-required profile",
        description:
          "Requires a document upload",
        requiresDocument: true,
        requiresApproval: false,
      },
    },
    {
      id: "semantic-approval",
      label: "Approval profile",
      semanticCapabilities: {
        title: "Approval profile",
        description:
          "Requires a review decision",
        requiresDocument: false,
        requiresApproval: true,
      },
    },
  ];

const permutations = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function loadCase(
  descriptor: ShadowCase
) {
  const planPath = path.join(
    "fixtures",
    "regression",
    "final-13",
    "plans",
    `${descriptor.issueKey}.json`
  );
  const plan = JSON.parse(
    fs.readFileSync(
      planPath,
      "utf8"
    )
  );
  const testCase =
    plan.browserCases.find(
      (candidate: any) =>
        candidate.id ===
        descriptor.caseId
    );

  if (!testCase) {
    throw new Error(
      `Missing canonical browser case ${descriptor.issueKey}/${descriptor.caseId}.`
    );
  }

  return {
    goal: String(
      testCase.goal || ""
    ),
    successCriteria: String(
      testCase.successCriteria ||
      ""
    ),
    automatedChecks:
      Array.isArray(
        testCase.automatedChecks
      )
        ? testCase.automatedChecks
        : [],
    fixtureRequirements:
      Array.isArray(
        testCase.fixtureRequirements
      )
        ? testCase.fixtureRequirements
        : [],
  };
}

const timestamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 14);

const outputDirectory =
  process.argv[2] ||
  path.join(
    "qa-results",
    "runs",
    `generic-mutation-shadow-${timestamp}`
  );

const summaries: any[] = [];
const invariance: any[] = [];
const failures: string[] = [];

for (const descriptor of cases) {
  const requirements =
    loadCase(descriptor);
  const selectedIds:
    string[] = [];

  for (
    let index = 0;
    index < permutations.length;
    index += 1
  ) {
    const permutation =
      permutations[index]!;
    const result =
      await runGenericFixtureCandidateSelection({
        requirements,
        candidates:
          permutation.map(
            (candidateIndex) => {
              const candidate =
                candidates[
                  candidateIndex
                ]!;
              const requiresDocument =
                requirements
                  .successCriteria
                  .toLowerCase()
                  .includes(
                    "document-required indication"
                  );

              return {
                ...candidate,
                usable:
                  !requiresDocument ||
                  candidate
                    .semanticCapabilities
                    .requiresDocument ===
                    true,
              };
            }
          ),
      });

    if (result.status === "ERROR") {
      failures.push(
        `${descriptor.issueKey}/${descriptor.caseId} permutation ${index + 1}: ${result.note}`
      );
      continue;
    }

    const selectedSemanticClass =
      result.status === "SELECTED"
        ? result.candidate.id
        : null;

    if (selectedSemanticClass) {
      selectedIds.push(
        selectedSemanticClass
      );
    }

    summaries.push({
      issueKey:
        descriptor.issueKey,
      caseId: descriptor.caseId,
      permutation:
        index + 1,
      status: result.status,
      selectedSemanticClass,
      selectionMode:
        result.status === "SELECTED"
          ? result.proposal
              .selectionMode ?? null
          : null,
      evaluationStatus:
        result.evaluation.status,
      confidence:
        result.proposal.confidence,
      evidencePaths:
        result.proposal.evidence.map(
          (evidence) =>
            evidence.path
        ),
    });
  }

  const stable =
    selectedIds.length !==
      permutations.length
      ? false
      : new Set(selectedIds)
          .size === 1;

  invariance.push({
    issueKey: descriptor.issueKey,
    caseId: descriptor.caseId,
    stable,
    selectedSemanticClass:
      stable
        ? selectedIds[0] ?? null
        : null,
  });

  if (!stable) {
    failures.push(
      `${descriptor.issueKey}/${descriptor.caseId} was not invariant across all candidate permutations.`
    );
  }
}

fs.mkdirSync(
  outputDirectory,
  { recursive: true }
);

const artifact = {
  generatedAt:
    new Date().toISOString(),
  candidateData:
    "synthetic-sanitized",
  permutationCount:
    permutations.length,
  invariance,
  cases: summaries,
};

const outputPath = path.join(
  outputDirectory,
  "generic-mutation-shadow-summary.json"
);

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(
    artifact,
    null,
    2
  )}\n`,
  "utf8"
);

console.log(outputPath);

if (failures.length > 0) {
  throw new Error(
    `${failures.join(" ")} Sanitized summary: ${outputPath}`
  );
}
