import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateGenericFixtureCandidateProposal,
  genericFixtureEvidencePathIsUnsafe,
  normalizeGenericFixtureCandidate,
  runGenericFixtureCandidateSelection,
  type GenericFixtureCandidateModelInput,
} from "./generic-fixture-candidate-selector.js";
import {
  buildWorkSetupFixtureRequirementContext,
  resolveWorkSetupFixtureCandidateDecision,
} from "./talent-contract-work-setup-fixture.js";

const requirements = {
  goal: "Select the best compatible option.",
  successCriteria:
    "The selected option exposes the required semantic capability.",
  automatedChecks: [],
  fixtureRequirements: [],
};

test(
  "identifier evidence detection is token-aware",
  () => {
    for (
      const unsafe of [
        "id",
        "workSetupId",
        "work_setup_id",
        "nested.id",
        "resourceUUID",
        "createdAt",
        "internalNotes",
      ]
    ) {
      assert.equal(
        genericFixtureEvidencePathIsUnsafe(
          unsafe
        ),
        true,
        unsafe
      );
    }

    for (
      const safe of [
        "isPaid",
        "valid",
        "invalid",
        "fluid",
        "semanticGrid",
      ]
    ) {
      assert.equal(
        genericFixtureEvidencePathIsUnsafe(
          safe
        ),
        false,
        safe
      );
    }
  }
);

test(
  "Work Setup exposes only approved semantics to proposal input",
  async () => {
    let captured:
      GenericFixtureCandidateModelInput |
      undefined;

    const result =
      await resolveWorkSetupFixtureCandidateDecision({
testCase: {
  ...requirements,
  fixtureRequirements: [
    "A compatible Work Setup requiring file upload.",
  ],
},
        companyData: [
          {
            id: "runtime-sensitive-id",
            title: "General onboarding",
            description:
              "A representative setup",
            requireFileUpload: true,
            requireApproval: false,
            documentPath:
              "/private/reference.pdf",
            isPaid: true,
            authorizationToken:
              "must-never-egress",
            internalNotes:
              "private operational note",
            companyId:
              "private-company-id",
            callbackUrl:
              "https://signed.invalid/value",
            createdBy: {
              email:
                "private@example.invalid",
            },
          },
        ],
        visibleTalentData: [],
        selectCandidate:
          runGenericFixtureCandidateSelection,
        requestCandidateProposal:
          async (input) => {
            captured = input;
            const candidate =
              input.candidates[0]!;

            return {
              decision:
                "SELECT_CANDIDATE",
              selectionMode:
                "ATTACH_NEW",
              candidateId:
                candidate.candidateId,
              confidence: "high",
              rationale:
                "The approved title is exact.",
              evidence: [
                {
                  path: "title",
                  expected:
                    "General onboarding",
                },
              ],
            };
          },
      });

    assert.equal(
      result.status,
      "ATTACH_NEW"
    );
    assert.ok(captured);

    const serialized =
      JSON.stringify(captured);

    assert.equal(
      serialized.includes(
        "runtime-sensitive-id"
      ),
      false
    );
    assert.equal(
      serialized.includes(
        "must-never-egress"
      ),
      false
    );
    assert.equal(
      serialized.includes(
        "private operational note"
      ),
      false
    );
    assert.equal(
      serialized.includes(
        "private-company-id"
      ),
      false
    );
    assert.equal(
      serialized.includes(
        "signed.invalid"
      ),
      false
    );
    assert.deepEqual(
      captured.candidates[0]
        ?.capabilities,
      {
        title:
          "General onboarding",
        description:
          "A representative setup",
        requiresFileUpload: true,
        requiresApproval: false,
        hasReferenceDocument: true,
      }
    );
  }
);

test(
  "equivalent candidates require comparative evidence",
  () => {
    const first =
      normalizeGenericFixtureCandidate({
        id: "first-runtime-id",
        semanticCapabilities: {
          category: "general",
        },
      });
    const second =
      normalizeGenericFixtureCandidate({
        id: "second-runtime-id",
        semanticCapabilities: {
          category: "general",
        },
      });

    const evaluation =
      evaluateGenericFixtureCandidateProposal({
        proposal: {
          decision:
            "SELECT_CANDIDATE",
          candidateId:
            first.selectionKey,
          selectionMode:
            "ATTACH_NEW",
          confidence: "high",
          rationale:
            "Both expose the same category.",
          evidence: [
            {
              path: "category",
              expected: "general",
            },
          ],
        },
        candidates: [
          first,
          second,
        ],
      });

    assert.equal(
      evaluation.status,
      "INSUFFICIENT_COMPARATIVE_EVIDENCE"
    );
    assert.equal(
      evaluation.safeToSelect,
      false
    );
  }
);

test(
  "Work Setup adapter marks candidates that miss an explicit subtype requirement ineligible",
  async () => {
    const result =
      await resolveWorkSetupFixtureCandidateDecision({
        testCase: {
          ...requirements,
          successCriteria:
            "The compact card exposes a document-required indication.",
        },
        companyData: [
          {
            id: "without-upload",
            title: "Without upload",
            requireFileUpload: false,
          },
          {
            id: "with-upload",
            title: "With upload",
            requireFileUpload: true,
          },
        ],
        visibleTalentData: [],
        selectCandidate:
          runGenericFixtureCandidateSelection,
        requestCandidateProposal:
          async (input) => {
            const withoutUpload =
              input.candidates.find(
                (candidate) =>
                  candidate
                    .capabilities.title ===
                  "Without upload"
              )!;
            const withUpload =
              input.candidates.find(
                (candidate) =>
                  candidate
                    .capabilities.title ===
                  "With upload"
              )!;

            assert.equal(
              withoutUpload.usable,
              false
            );
            assert.equal(
              withUpload.usable,
              true
            );

            return {
              decision:
                "SELECT_CANDIDATE",
              selectionMode:
                withUpload
                  .selectionMode,
              candidateId:
                withUpload
                  .candidateId,
              confidence: "high",
              rationale:
                "The required subtype is exact.",
              evidence: [
                {
                  path:
                    "requiresFileUpload",
                  expected: true,
                },
              ],
            };
          },
      });

    assert.equal(
      result.status,
      "ATTACH_NEW"
    );
  }
);

test(
  "approved reuse preference resolves attachment-state-only tie",
  () => {
    const reusable =
      normalizeGenericFixtureCandidate({
        id: "reusable",
        alreadyAttached: true,
        semanticCapabilities: {
          category: "general",
        },
      });
    const attachable =
      normalizeGenericFixtureCandidate({
        id: "attachable",
        semanticCapabilities: {
          category: "general",
        },
      });

    const evaluation =
      evaluateGenericFixtureCandidateProposal({
        proposal: {
          decision:
            "SELECT_CANDIDATE",
          candidateId:
            reusable.selectionKey,
          selectionMode:
            "REUSE_EXISTING",
          confidence: "high",
          rationale:
            "Semantics tie and reuse is approved.",
          evidence: [
            {
              path: "category",
              expected: "general",
            },
          ],
        },
        candidates: [
          attachable,
          reusable,
        ],
        selectionPolicy: {
          allowReusePreference: true,
        },
      });

    assert.equal(
      evaluation.status,
      "SAFE_TO_SELECT"
    );
  }
);

test(
  "selection is invariant across candidate permutations",
  async () => {
    const base = [
      {
        id: "underlying-a",
        semanticCapabilities: {
          tier: "basic",
        },
      },
      {
        id: "underlying-b",
        semanticCapabilities: {
          tier: "required",
        },
      },
      {
        id: "underlying-c",
        semanticCapabilities: {
          tier: "other",
        },
      },
    ];

    const observedModelOrders:
      string[][] = [];

    for (
      const candidates of [
        base,
        [base[2]!, base[0]!, base[1]!],
        [base[1]!, base[2]!, base[0]!],
      ]
    ) {
      const result =
        await runGenericFixtureCandidateSelection({
          requirements,
          candidates,
          requestProposal:
            async (input) => {
              observedModelOrders.push(
                input.candidates.map(
                  (candidate) =>
                    candidate.candidateId
                )
              );

              const selected =
                input.candidates.find(
                  (candidate) =>
                    candidate
                      .capabilities.tier ===
                    "required"
                )!;

              return {
                decision:
                  "SELECT_CANDIDATE",
                selectionMode:
                  selected.selectionMode,
                candidateId:
                  selected.candidateId,
                confidence: "high",
                rationale:
                  "The required tier is exact.",
                evidence: [
                  {
                    path: "tier",
                    expected:
                      "required",
                  },
                ],
              };
            },
        });

      assert.equal(
        result.status,
        "SELECTED"
      );

      if (
        result.status ===
        "SELECTED"
      ) {
        assert.equal(
          result.candidate.id,
          "underlying-b"
        );
      }
    }

    assert.deepEqual(
      observedModelOrders[0],
      observedModelOrders[1]
    );
    assert.deepEqual(
      observedModelOrders[1],
      observedModelOrders[2]
    );
  }
);

test(
  "selection blocks an invented candidate reference and missing semantic context",
  async () => {
    const invented =
      await runGenericFixtureCandidateSelection({
        requirements,
        candidates: [
          {
            id: "real-runtime-id",
            semanticCapabilities: {
              kind: "real",
            },
          },
        ],
        requestProposal:
          async () => ({
            decision:
              "SELECT_CANDIDATE",
            selectionMode:
              "ATTACH_NEW",
            candidateId:
              "candidate-invented",
            confidence: "high",
            rationale:
              "Invented reference.",
            evidence: [
              {
                path: "kind",
                expected: "real",
              },
            ],
          }),
      });

    assert.equal(invented.status, "BLOCKED");

    if (invented.status === "BLOCKED") {
      assert.equal(
        invented.evaluation.status,
        "CANDIDATE_NOT_FOUND"
      );
    }

    let proposalRequested = false;
    const missingContext =
      await runGenericFixtureCandidateSelection({
        requirements,
        candidates: [
          {
            id: "no-semantics",
            semanticCapabilities: {},
          },
        ],
        requestProposal:
          async () => {
            proposalRequested = true;
            return {};
          },
      });

    assert.equal(
      missingContext.status,
      "BLOCKED"
    );
    assert.equal(proposalRequested, false);

    if (
      missingContext.status ===
      "BLOCKED"
    ) {
      assert.equal(
        missingContext
          .evaluation.status,
        "SEMANTIC_CONTEXT_REQUIRED"
      );
    }
  }
);


test(
  "Work Setup candidate context excludes negative copy assertions",
  () => {
    const context =
      buildWorkSetupFixtureRequirementContext({
        goal:
          "Verify populated Work Setups helper text.",
        successCriteria:
          "The new helper text is shown.",
        automatedChecks: [
          "Verify Work Setups is visible.",
          "Verify old document upload copy is not visible.",
        ],
        fixtureRequirements: [
          "A contract with at least one assigned Work Setup.",
        ],
        steps: [
          {
            action:
              "assertTextVisible",
            text: "Work Setups",
          },
          {
            action:
              "assertTextNotVisible",
            text:
              "Some require a document upload for review.",
          },
        ],
      });

    assert.deepEqual(
      context.automatedChecks,
      ["Work Setups"]
    );
  }
);

test(
  "generic populated Work Setup selection bypasses a low-confidence model proposal",
  async () => {
    let proposalRequested = false;

    const result =
      await resolveWorkSetupFixtureCandidateDecision({
        testCase: {
          goal:
            "Verify a populated Work Setups section.",
          successCriteria:
            "At least one assigned Work Setup is visible.",
          automatedChecks: [
            "Verify Work Setups is visible.",
          ],
          fixtureRequirements: [
            "A talent-owned contract with at least one assigned Work Setup.",
          ],
          steps: [
            {
              action:
                "assertTextVisible",
              text: "Work Setups",
            },
          ],
        },
        companyData: [
          {
            id: "setup-b",
            title: "Beta setup",
          },
          {
            id: "setup-a",
            title: "Alpha setup",
          },
        ],
        visibleTalentData: [],
        selectCandidate:
          runGenericFixtureCandidateSelection,
        requestCandidateProposal:
          async () => {
            proposalRequested = true;
            return {
              decision:
                "SELECT_CANDIDATE",
              selectionMode:
                "ATTACH_NEW",
              candidateId:
                "candidate-not-used",
              confidence: "low",
              rationale:
                "The fallback must not override a deterministic generic match.",
              evidence: [],
            };
          },
      });

    assert.equal(
      proposalRequested,
      false
    );
    assert.equal(
      result.status,
      "ATTACH_NEW"
    );

    if (
      result.status ===
        "ATTACH_NEW"
    ) {
      assert.equal(
        result.workSetupTitle,
        "Alpha setup"
      );
    }
  }
);
