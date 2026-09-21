import {
  createHash,
} from "node:crypto";

export type GenericFixtureScalar =
  | string
  | number
  | boolean
  | null;

export type GenericFixtureCandidateInput = {
  id: string;
  label?: string;
  usable?: boolean;
  alreadyAttached?: boolean;
  selectionMode?:
    GenericFixtureCandidateSelectionMode;
  semanticCapabilities:
    Record<
      string,
      GenericFixtureScalar
    >;
};

export type GenericFixtureCandidate = {
  id: string;
  selectionKey: string;
  label?: string;
  usable: boolean;
  alreadyAttached: boolean;
  selectionMode:
    GenericFixtureCandidateSelectionMode;
  capabilities:
    Record<
      string,
      GenericFixtureScalar
    >;
};

export type GenericFixtureRequirementContext = {
  goal: string;
  successCriteria: string;
  automatedChecks: string[];
  fixtureRequirements: string[];
};

export type GenericFixtureCandidateEvidence = {
  path: string;
  expected: GenericFixtureScalar;
};

export type GenericFixtureCandidateDecision =
  | "SELECT_CANDIDATE"
  | "NO_COMPATIBLE_CANDIDATE"
  | "NEEDS_MORE_CONTEXT";

export type GenericFixtureCandidateConfidence =
  | "low"
  | "medium"
  | "high";

export type GenericFixtureCandidateSelectionMode =
  | "ATTACH_NEW"
  | "REUSE_EXISTING"
  | "CREATE_NEW"
  | "UPDATE_EXISTING"
  | "DELETE_EXISTING";

export type GenericFixtureCandidateProposal = {
  decision:
    GenericFixtureCandidateDecision;
  rationale: string;
  confidence:
    GenericFixtureCandidateConfidence;
  selectionMode?:
    GenericFixtureCandidateSelectionMode;
  candidateId?: string;
  evidence:
    GenericFixtureCandidateEvidence[];
};

export type GenericFixtureCandidateModelInput = {
  requirements:
    GenericFixtureRequirementContext;
  selectionPolicy: {
    allowReusePreference: boolean;
  };
  candidates:
    GenericFixtureCandidateModelCandidate[];
};

export type GenericFixtureCandidateModelCandidate = {
  candidateId: string;
  label?: string;
  usable: boolean;
  alreadyAttached: boolean;
  selectionMode:
    GenericFixtureCandidateSelectionMode;
  capabilities:
    Record<
      string,
      GenericFixtureScalar
    >;
};

export type GenericFixtureCandidateRequestProposal =
  (
    input:
      GenericFixtureCandidateModelInput
  ) => Promise<unknown>;

export type GenericFixtureCandidateEvaluationStatus =
  | "SAFE_TO_SELECT"
  | "NO_COMPATIBLE_CANDIDATE"
  | "NEEDS_MORE_CONTEXT"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_UNUSABLE"
  | "CANDIDATE_ALREADY_ATTACHED"
  | "CANDIDATE_NOT_ATTACHED"
  | "SELECTION_MODE_REQUIRED"
  | "LOW_CONFIDENCE"
  | "EVIDENCE_REQUIRED"
  | "EVIDENCE_PATH_UNSAFE"
  | "EVIDENCE_NOT_GROUNDED"
  | "EVIDENCE_VALUE_MISMATCH"
  | "INSUFFICIENT_COMPARATIVE_EVIDENCE"
  | "SEMANTIC_CONTEXT_REQUIRED"
  | "SELECTION_MODE_MISMATCH";

export type GenericFixtureCandidateEvaluation = {
  status:
    GenericFixtureCandidateEvaluationStatus;
  safeToSelect: boolean;
  grounded: boolean;
  reason: string;
  candidate?: GenericFixtureCandidate;
};

export type RunGenericFixtureCandidateSelectionArgs = {
  requirements:
    GenericFixtureRequirementContext;
  candidates:
    GenericFixtureCandidateInput[];
  requestProposal?:
    GenericFixtureCandidateRequestProposal;
  selectionPolicy?: {
    allowReusePreference?: boolean;
  };
};

export type GenericFixtureCandidateSelectionResult =
  | {
      status: "SELECTED";
      candidate:
        GenericFixtureCandidate;
      proposal:
        GenericFixtureCandidateProposal;
      evaluation:
        GenericFixtureCandidateEvaluation;
    }
  | {
      status: "BLOCKED";
      note: string;
      proposal:
        GenericFixtureCandidateProposal;
      evaluation:
        GenericFixtureCandidateEvaluation;
    }
  | {
      status: "ERROR";
      note: string;
    };

const DECISIONS =
  new Set<
    GenericFixtureCandidateDecision
  >([
    "SELECT_CANDIDATE",
    "NO_COMPATIBLE_CANDIDATE",
    "NEEDS_MORE_CONTEXT",
  ]);

const CONFIDENCES =
  new Set<
    GenericFixtureCandidateConfidence
  >([
    "low",
    "medium",
    "high",
  ]);

const SELECTION_MODES =
  new Set<
    GenericFixtureCandidateSelectionMode
  >([
    "ATTACH_NEW",
    "REUSE_EXISTING",
    "CREATE_NEW",
    "UPDATE_EXISTING",
    "DELETE_EXISTING",
  ]);

const SECRET_KEY =
  /token|secret|password|credential|authorization|cookie/i;

const REFERENCE_KEY =
  /url|signed|download|documentPath|filePath/i;

const NON_SEMANTIC_EVIDENCE_KEY =
  new Set([
    "company",
    "createdat",
    "createdby",
    "internalnotes",
    "updatedat",
  ]);

function terminalPathToken(
  path: string
): string {
  const terminalKey =
    path
      .replace(/\[\d+\]/g, "")
      .split(".")
      .at(-1)
      ?.trim() ?? "";

  const tokens = terminalKey
    .replace(
      /([a-z0-9])([A-Z])/g,
      "$1 $2"
    )
    .split(/[^a-zA-Z0-9]+/)
    .map((token) =>
      token.toLowerCase()
    )
    .filter(Boolean);

  return tokens.at(-1) ?? "";
}

function compactTerminalPathKey(
  path: string
): string {
  return (
    path
      .replace(/\[\d+\]/g, "")
      .split(".")
      .at(-1) ?? ""
  )
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

export function genericFixtureEvidencePathIsUnsafe(
  path: string
): boolean {
  if (
    SECRET_KEY.test(path) ||
    REFERENCE_KEY.test(path)
  ) {
    return true;
  }

  const terminalKey =
    terminalPathToken(path);
  const compactTerminalKey =
    compactTerminalPathKey(path);

  return (
    terminalKey === "id" ||
    terminalKey === "identifier" ||
    terminalKey === "uuid" ||
    terminalKey === "guid" ||
    NON_SEMANTIC_EVIDENCE_KEY.has(
      compactTerminalKey
    )
  );
}

function isRecord(
  value: unknown
): value is
  Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isScalar(
  value: unknown
): value is GenericFixtureScalar {
  return (
    value === null ||
    typeof value === "string" ||
    (
      typeof value === "number" &&
      Number.isFinite(value)
    ) ||
    typeof value === "boolean"
  );
}

function normalizeText(
  value: unknown,
  maxLength: number
): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function sanitizeScalar(
  key: string,
  value: GenericFixtureScalar
): GenericFixtureScalar {
  if (
    typeof value !== "string"
  ) {
    return value;
  }

  if (
    SECRET_KEY.test(key)
  ) {
    return value.trim()
      ? "[redacted]"
      : "";
  }

  if (
    REFERENCE_KEY.test(key)
  ) {
    return value.trim()
      ? "[present]"
      : "";
  }

  const normalized =
    value.trim();

  return normalized.length > 240
    ? `${normalized.slice(0, 237)}...`
    : normalized;
}

export function normalizeGenericFixtureCandidate(
  input:
    GenericFixtureCandidateInput
): GenericFixtureCandidate {
  const id =
    normalizeText(
      input.id,
      200
    );

  if (!id) {
    throw new Error(
      "Generic fixture candidate requires an exact non-empty ID."
    );
  }

  const label =
    normalizeText(
      input.label,
      300
    );

  const capabilities:
    Record<
      string,
      GenericFixtureScalar
    > = {};

  for (
    const [path, rawValue]
    of Object.entries(
      input.semanticCapabilities ??
        {}
    )
  ) {
    const normalizedPath =
      normalizeText(path, 300);

    if (
      !normalizedPath ||
      !isScalar(rawValue)
    ) {
      throw new Error(
        "Generic fixture semantic capabilities require exact scalar values on non-empty paths."
      );
    }

    if (
      genericFixtureEvidencePathIsUnsafe(
        normalizedPath
      )
    ) {
      throw new Error(
        `Generic fixture semantic capability path "${normalizedPath}" is identity, audit, internal, sensitive, or reference metadata.`
      );
    }

    capabilities[normalizedPath] =
      sanitizeScalar(
        normalizedPath,
        rawValue
      );
  }

  const selectionMode =
    input.selectionMode ??
    (
      input.alreadyAttached === true
        ? "REUSE_EXISTING"
        : "ATTACH_NEW"
    );

  if (
    !SELECTION_MODES.has(
      selectionMode
    )
  ) {
    throw new Error(
      `Unsupported generic fixture candidate selection mode: ${selectionMode}`
    );
  }

  return {
    id,
    selectionKey:
      `candidate-${createHash("sha256")
        .update(id)
        .digest("hex")
        .slice(0, 16)}`,
    ...(
      label
        ? {
            label,
          }
        : {}
    ),
    usable:
      input.usable !== false,
    alreadyAttached:
      input.alreadyAttached ===
        true,
    selectionMode,
    capabilities,
  };
}

function modelCandidateSortKey(
  candidate:
    GenericFixtureCandidate
): string {
  const sortedCapabilities:
    Record<
      string,
      GenericFixtureScalar
    > = {};

  for (
    const key of Object.keys(
      candidate.capabilities
    ).sort()
  ) {
    sortedCapabilities[key] =
      candidate.capabilities[key]!;
  }

  return JSON.stringify({
    label: candidate.label ?? "",
    usable: candidate.usable,
    alreadyAttached:
      candidate.alreadyAttached,
    selectionMode:
      candidate.selectionMode,
    capabilities:
      sortedCapabilities,
  });
}

function parseJsonValue(
  value: unknown
): unknown {
  if (
    typeof value !== "string"
  ) {
    return value;
  }

  const normalized =
    value
      .trim()
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  return JSON.parse(
    normalized
  );
}

export function normalizeGenericFixtureCandidateProposal(
  value: unknown
): GenericFixtureCandidateProposal {
  const parsed =
    parseJsonValue(value);

  if (!isRecord(parsed)) {
    throw new Error(
      "Generic fixture candidate proposal must be a JSON object."
    );
  }

  const decision =
    normalizeText(
      parsed.decision,
      80
    ).toUpperCase() as
      GenericFixtureCandidateDecision;

  if (!DECISIONS.has(decision)) {
    throw new Error(
      `Unsupported generic fixture candidate decision: ${
        decision || "<empty>"
      }`
    );
  }

  const confidence =
    normalizeText(
      parsed.confidence,
      40
    ).toLowerCase() as
      GenericFixtureCandidateConfidence;

  if (
    !CONFIDENCES.has(
      confidence
    )
  ) {
    throw new Error(
      `Unsupported generic fixture candidate confidence: ${
        confidence || "<empty>"
      }`
    );
  }

  const rationale =
    normalizeText(
      parsed.rationale,
      2000
    );

  if (!rationale) {
    throw new Error(
      "Generic fixture candidate proposal requires a rationale."
    );
  }

  const candidateId =
    normalizeText(
      parsed.candidateId,
      200
    );

  if (
    decision ===
      "SELECT_CANDIDATE" &&
    !candidateId
  ) {
    throw new Error(
      "SELECT_CANDIDATE requires an exact candidateId."
    );
  }

  const rawSelectionMode =
    normalizeText(
      parsed.selectionMode,
      40
    ).toUpperCase();

  let selectionMode:
    GenericFixtureCandidateSelectionMode |
    undefined;

  if (
    decision ===
      "SELECT_CANDIDATE"
  ) {
    if (
      !SELECTION_MODES.has(
        rawSelectionMode as
          GenericFixtureCandidateSelectionMode
      )
    ) {
      throw new Error(
        "SELECT_CANDIDATE requires one supported exact selection mode."
      );
    }

    selectionMode =
      rawSelectionMode as
        GenericFixtureCandidateSelectionMode;
  } else if (rawSelectionMode) {
    throw new Error(
      "selectionMode is only valid for SELECT_CANDIDATE."
    );
  }

  const rawEvidence =
    Array.isArray(
      parsed.evidence
    )
      ? parsed.evidence
      : [];

  const evidence:
    GenericFixtureCandidateEvidence[] = [];

  for (
    const item
    of rawEvidence.slice(0, 30)
  ) {
    if (!isRecord(item)) {
      throw new Error(
        "Candidate evidence entries must be JSON objects."
      );
    }

    const path =
      normalizeText(
        item.path,
        300
      );

    if (
      !path ||
      !isScalar(
        item.expected
      )
    ) {
      throw new Error(
        "Candidate evidence requires an exact path and scalar expected value."
      );
    }

    evidence.push({
      path,
      expected:
        item.expected,
    });
  }

  return {
    decision,
    rationale,
    confidence,
    ...(
      selectionMode
        ? {
            selectionMode,
          }
        : {}
    ),
    ...(
      candidateId
        ? {
            candidateId,
          }
        : {}
    ),
    evidence,
  };
}

export function evaluateGenericFixtureCandidateProposal(
  args: {
    proposal:
      GenericFixtureCandidateProposal;
    candidates:
      GenericFixtureCandidate[];
    selectionPolicy?: {
      allowReusePreference?: boolean;
    };
  }
): GenericFixtureCandidateEvaluation {
  const {
    proposal,
    candidates,
  } = args;

  if (
    proposal.decision ===
      "NO_COMPATIBLE_CANDIDATE"
  ) {
    return {
      status:
        "NO_COMPATIBLE_CANDIDATE",
      safeToSelect: false,
      grounded: true,
      reason:
        "The semantic selector found no compatible runtime candidate.",
    };
  }

  if (
    proposal.decision ===
      "NEEDS_MORE_CONTEXT"
  ) {
    return {
      status:
        "NEEDS_MORE_CONTEXT",
      safeToSelect: false,
      grounded: true,
      reason:
        "The semantic selector requires more grounded runtime context.",
    };
  }

  const candidate =
    candidates.find(
      (item) =>
        item.selectionKey ===
        proposal.candidateId
    );

  if (!candidate) {
    return {
      status:
        "CANDIDATE_NOT_FOUND",
      safeToSelect: false,
      grounded: false,
      reason:
        "The proposed candidateId does not exist in the supplied runtime candidate set.",
    };
  }

  if (!candidate.usable) {
    return {
      status:
        "CANDIDATE_UNUSABLE",
      safeToSelect: false,
      grounded: true,
      reason:
        "The proposed runtime candidate is not eligible for use.",
      candidate,
    };
  }

  if (
    proposal.confidence !==
      "high"
  ) {
    return {
      status:
        "LOW_CONFIDENCE",
      safeToSelect: false,
      grounded: true,
      reason:
        "Controlled fixture selection requires a high-confidence semantic proposal.",
      candidate,
    };
  }

  if (
    proposal.evidence.length ===
      0
  ) {
    return {
      status:
        "EVIDENCE_REQUIRED",
      safeToSelect: false,
      grounded: false,
      reason:
        "Controlled fixture selection requires at least one exact metadata evidence assertion.",
      candidate,
    };
  }

  for (
    const evidence
    of proposal.evidence
  ) {
    if (
      genericFixtureEvidencePathIsUnsafe(
        evidence.path
      )
    ) {
      return {
        status:
          "EVIDENCE_PATH_UNSAFE",
        safeToSelect: false,
        grounded: false,
        reason:
          `The proposed evidence path "${evidence.path}" is identity, audit, internal, sensitive, or reference metadata and cannot establish semantic fixture suitability.`,
        candidate,
      };
    }

    if (
      !Object.prototype
        .hasOwnProperty.call(
          candidate.capabilities,
          evidence.path
        )
    ) {
      return {
        status:
          "EVIDENCE_NOT_GROUNDED",
        safeToSelect: false,
        grounded: false,
        reason:
          `The proposed evidence path "${evidence.path}" is not present on the selected runtime candidate.`,
        candidate,
      };
    }

    const actual =
      candidate.capabilities[
        evidence.path
      ];

    if (
      !Object.is(
        actual,
        evidence.expected
      )
    ) {
      return {
        status:
          "EVIDENCE_VALUE_MISMATCH",
        safeToSelect: false,
        grounded: false,
        reason:
          `The proposed evidence value for "${evidence.path}" does not match runtime metadata.`,
        candidate,
      };
    }
  }

  if (!proposal.selectionMode) {
    return {
      status:
        "SELECTION_MODE_REQUIRED",
      safeToSelect: false,
      grounded: true,
      reason:
        "Controlled fixture selection requires an explicit selection mode.",
      candidate,
    };
  }

  if (
    proposal.selectionMode !==
      candidate.selectionMode
  ) {
    return {
      status:
        "SELECTION_MODE_MISMATCH",
      safeToSelect: false,
      grounded: true,
      reason:
        "The proposed selection mode does not match the runtime-discovered transition candidate.",
      candidate,
    };
  }

  const matchingCandidates =
    candidates.filter(
      (alternative) =>
        alternative.usable &&
        proposal.evidence.every(
          (evidence) =>
            Object.prototype
              .hasOwnProperty.call(
                alternative
                  .capabilities,
                evidence.path
              ) &&
            Object.is(
              alternative
                .capabilities[
                  evidence.path
                ],
              evidence.expected
            )
        )
    );

  if (
    matchingCandidates.length > 1
  ) {
    const reusableMatches =
      matchingCandidates.filter(
        (alternative) =>
          alternative
            .selectionMode ===
            "REUSE_EXISTING" &&
          alternative
            .alreadyAttached
      );

    const reusePreferenceResolves =
      args.selectionPolicy
        ?.allowReusePreference ===
        true &&
      proposal.selectionMode ===
        "REUSE_EXISTING" &&
      candidate.alreadyAttached &&
      reusableMatches.length === 1 &&
      reusableMatches[0]
        ?.id === candidate.id;

    if (
      !reusePreferenceResolves
    ) {
      return {
        status:
          "INSUFFICIENT_COMPARATIVE_EVIDENCE",
        safeToSelect: false,
        grounded: false,
        reason:
          "The supplied semantic evidence matches multiple eligible runtime candidates and no approved deterministic policy distinguishes the selection.",
        candidate,
      };
    }
  }

  return {
    status:
      "SAFE_TO_SELECT",
    safeToSelect: true,
    grounded: true,
    reason:
      "The model-selected candidate is exact, usable, high-confidence, grounded by runtime metadata, and consistent with the requested selection mode.",
    candidate,
  };
}

async function requestModelCandidateProposal(
  input:
    GenericFixtureCandidateModelInput
): Promise<unknown> {
  const {
    getReasoningOptions,
    ollamaClient,
  } = await import(
    "../../../llm/ollama-client.js"
  );

  const systemPrompt = `
You are a generic QA fixture candidate selector.

Choose a runtime candidate using only:
- the canonical automated test requirements;
- the supplied opaque candidate references, labels, eligibility flags, transition modes, and explicitly approved semantic capabilities.

The canonical requirements are the goal, successCriteria, automatedChecks, and fixtureRequirements fields together.
Goal and successCriteria remain authoritative when either optional array is empty.
Do not treat an empty automatedChecks or fixtureRequirements array as missing context by itself.
Requirements explicitly described as manual, manual follow-up, or unavailable are out of scope for automated fixture selection; use the remaining automated surface requirements.

Do not execute or propose API, browser, or database actions.
Treat candidateId values as opaque selection references, never as semantic evidence.
Do not use issue-specific, case-specific, environment-specific, or title-specific prior knowledge.
Ignore any requirement that is not supplied in the input.
Prefer a candidate whose exact metadata best supports the automated requirements.
Compare every candidate independently; array order conveys no preference.
When a requirement only needs a representative usable record to render the asserted surface, select the candidate whose semantic metadata best demonstrates that surface.
Evaluate only the fixture candidate's contribution to the requirements.
The domain provider owns attachment and later API/UI verification, so do not require candidates to contain route, target-entity, surrounding-section, or post-attachment UI state metadata.
alreadyAttached is the exact attachment state for the current target runtime; do not ask for a separate contract, job, or target assignment field.
For a representative-record requirement that does not demand a subtype, prefer the usable candidate with the clearest general user-facing label and description over a candidate specialized for an unrelated subtype.
For that representative-record case, high confidence means the chosen candidate is clearly safe and representative under this semantic policy; it does not require proving that every other compatible record is unusable.
Prefer REUSE_EXISTING over a mutating transition only when selectionPolicy.allowReusePreference is true and attachment state is the sole exact differentiator.
If multiple candidates remain equally suitable and metadata cannot distinguish them, return NEEDS_MORE_CONTEXT instead of selecting by position.
Never choose an unusable candidate.
Copy the selected candidate's exact selectionMode.
Return NO_COMPATIBLE_CANDIDATE when no candidate is compatible.
Return NEEDS_MORE_CONTEXT when compatibility cannot be determined from supplied metadata.
Use high confidence only when exact supplied metadata clearly supports the choice.
Do not use opaque IDs, ownership/audit fields, timestamps, internal notes, sensitive fields, or redacted/reference-presence markers as evidence of semantic suitability.
The deterministic evaluator rejects identifier-token, audit, internal, sensitive, and reference evidence paths.
candidateId identifies the proposed candidate but never serves as semantic evidence.
Do not infer a project, company, document, approval, or other scope unless the canonical requirements explicitly call for it.
For a general representative-record requirement, compare user-facing labels and semantic capabilities and choose the uniquely clearest representative when one exists.

Return only one JSON object:

{
  "decision": "SELECT_CANDIDATE | NO_COMPATIBLE_CANDIDATE | NEEDS_MORE_CONTEXT",
  "selectionMode": "an exact supported mode copied from the candidate; required only for SELECT_CANDIDATE",
  "candidateId": "required only for SELECT_CANDIDATE",
  "confidence": "low | medium | high",
  "rationale": "brief evidence-based rationale",
  "evidence": [
    {
      "path": "an exact key copied from the selected candidate capabilities object",
      "expected": "the exact scalar value at that key"
    }
  ]
}

Rules:
- For SELECT_CANDIDATE, selectionMode must exactly match the candidate's supplied selectionMode.
- REUSE_EXISTING is read-only and establishes no cleanup ownership.
- ATTACH_NEW permits the domain provider to begin its controlled attachment transaction after deterministic evaluation.
- For SELECT_CANDIDATE, include one or more exact evidence entries.
- Evidence paths and values must be copied exactly from the selected candidate.
- Do not invent fields, IDs, values, or requirements.
- Do not include markdown.
`.trim();

  const reasoningOptions =
    getReasoningOptions();

  const response =
    await ollamaClient
      .chat
      .completions
      .create({
        model:
          process.env
            .QA_GENERIC_FIXTURE_MODEL ||
          process.env
            .QA_GENERIC_BROWSER_MODEL ||
          process.env.OLLAMA_MODEL ||
          "gpt-4o-mini",
        ...(
          Object.keys(
            reasoningOptions
          ).length > 0
            ? reasoningOptions
            : {
                temperature: 0,
              }
        ),
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content:
              systemPrompt,
          },
          {
            role: "user",
            content:
              JSON.stringify(
                input,
                null,
                2
              ),
          },
        ],
      } as any);

  return (
    response.choices[0]
      ?.message?.content ??
    ""
  );
}

export async function runGenericFixtureCandidateSelection(
  args:
    RunGenericFixtureCandidateSelectionArgs
): Promise<
  GenericFixtureCandidateSelectionResult
> {
  try {
    const candidates =
      args.candidates.map(
        normalizeGenericFixtureCandidate
      );

    if (
      candidates.length === 0
    ) {
      return {
        status: "ERROR",
        note:
          "Generic fixture candidate selection requires at least one runtime candidate.",
      };
    }

    const selectionKeys =
      new Set(
        candidates.map(
          (candidate) =>
            candidate.selectionKey
        )
      );

    if (
      selectionKeys.size !==
      candidates.length
    ) {
      return {
        status: "ERROR",
        note:
          "Generic fixture candidate selection produced a duplicate opaque selection reference.",
      };
    }

    const semanticallyEligible =
      candidates.filter(
        (candidate) =>
          candidate.usable &&
          Object.keys(
            candidate.capabilities
          ).length > 0
      );

    if (
      semanticallyEligible.length === 0
    ) {
      const proposal:
        GenericFixtureCandidateProposal = {
          decision:
            "NEEDS_MORE_CONTEXT",
          rationale:
            "No eligible runtime candidate exposed approved semantic capabilities.",
          confidence: "high",
          evidence: [],
        };

      const evaluation:
        GenericFixtureCandidateEvaluation = {
          status:
            "SEMANTIC_CONTEXT_REQUIRED",
          safeToSelect: false,
          grounded: false,
          reason:
            "Generic fixture selection is blocked because no eligible candidate supplied approved semantic context.",
        };

      return {
        status: "BLOCKED",
        note: evaluation.reason,
        proposal,
        evaluation,
      };
    }

    const modelInput:
      GenericFixtureCandidateModelInput = {
        requirements: {
          goal:
            normalizeText(
              args.requirements.goal,
              2000
            ),

          successCriteria:
            normalizeText(
              args.requirements
                .successCriteria,
              4000
            ),

          automatedChecks:
            args.requirements
              .automatedChecks
              .map(
                (value) =>
                  normalizeText(
                    value,
                    2000
                  )
              )
              .filter(Boolean)
              .slice(0, 40),

          fixtureRequirements:
            args.requirements
              .fixtureRequirements
              .map(
                (value) =>
                  normalizeText(
                    value,
                    2000
                  )
              )
              .filter(Boolean)
              .slice(0, 40),
        },
        selectionPolicy: {
          allowReusePreference:
            args.selectionPolicy
              ?.allowReusePreference ===
              true,
        },
        candidates:
          [...candidates]
          .sort(
            (left, right) => {
              const semanticOrder =
                modelCandidateSortKey(
                  left
                ).localeCompare(
                  modelCandidateSortKey(
                    right
                  )
                );

              return semanticOrder !== 0
                ? semanticOrder
                : left.selectionKey
                    .localeCompare(
                      right.selectionKey
                    );
            }
          )
          .map(
            (candidate) => ({
              candidateId:
                candidate.selectionKey,
              ...(candidate.label
                ? {
                    label:
                      candidate.label,
                  }
                : {}),
              usable:
                candidate.usable,
              alreadyAttached:
                candidate
                  .alreadyAttached,
              selectionMode:
                candidate
                  .selectionMode,
              capabilities:
                candidate
                  .capabilities,
            })
          ),
      };

    const requestProposal =
      args.requestProposal ??
      requestModelCandidateProposal;

    const proposal =
      normalizeGenericFixtureCandidateProposal(
        await requestProposal(
          modelInput
        )
      );

    const evaluation =
      evaluateGenericFixtureCandidateProposal({
        proposal,
        candidates,
        ...(args.selectionPolicy
          ? {
              selectionPolicy:
                args.selectionPolicy,
            }
          : {}),
      });

    if (
      evaluation.safeToSelect &&
      evaluation.candidate
    ) {
      return {
        status: "SELECTED",
        candidate:
          evaluation.candidate,
        proposal,
        evaluation,
      };
    }

    return {
      status: "BLOCKED",
      note:
        evaluation.reason,
      proposal,
      evaluation,
    };
  } catch (error) {
    return {
      status: "ERROR",
      note:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
