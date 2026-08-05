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
  metadata: unknown;
};

export type GenericFixtureCandidate = {
  id: string;
  label?: string;
  usable: boolean;
  alreadyAttached: boolean;
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
  | "REUSE_EXISTING";

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
  candidates:
    GenericFixtureCandidate[];
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
  | "EVIDENCE_VALUE_MISMATCH";

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

function evidencePathIsUnsafe(
  path: string
): boolean {
  if (
    SECRET_KEY.test(path) ||
    REFERENCE_KEY.test(path)
  ) {
    return true;
  }

  const terminalKey =
    path
      .replace(/\[\d+\]/g, "")
      .split(".")
      .at(-1)
      ?.trim()
      .toLowerCase() ?? "";

  return (
    terminalKey === "id" ||
    terminalKey.endsWith("id") ||
    NON_SEMANTIC_EVIDENCE_KEY.has(
      terminalKey
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
    typeof value === "number" ||
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

export function flattenGenericFixtureMetadata(
  value: unknown,
  options: {
    maxDepth?: number;
    maxEntries?: number;
  } = {}
): Record<
  string,
  GenericFixtureScalar
> {
  const maxDepth =
    options.maxDepth ?? 5;

  const maxEntries =
    options.maxEntries ?? 120;

  const result:
    Record<
      string,
      GenericFixtureScalar
    > = {};

  const seen =
    new Set<unknown>();

  function visit(
    current: unknown,
    prefix: string,
    depth: number
  ): void {
    if (
      Object.keys(result).length >=
        maxEntries ||
      depth > maxDepth ||
      current === null ||
      typeof current !== "object" ||
      seen.has(current)
    ) {
      return;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      const limit =
        Math.min(
          current.length,
          20
        );

      for (
        let index = 0;
        index < limit;
        index += 1
      ) {
        const item =
          current[index];

        const path =
          `${prefix}[${index}]`;

        if (isScalar(item)) {
          result[path] =
            sanitizeScalar(
              path,
              item
            );
        } else {
          visit(
            item,
            path,
            depth + 1
          );
        }
      }

      return;
    }

    for (
      const [key, child]
      of Object.entries(current)
    ) {
      if (
        Object.keys(result).length >=
        maxEntries
      ) {
        break;
      }

      const path =
        prefix
          ? `${prefix}.${key}`
          : key;

      if (isScalar(child)) {
        result[path] =
          sanitizeScalar(
            key,
            child
          );
      } else {
        visit(
          child,
          path,
          depth + 1
        );
      }
    }
  }

  visit(
    value,
    "",
    0
  );

  return result;
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

  return {
    id,
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
    capabilities:
      flattenGenericFixtureMetadata(
        input.metadata
      ),
  };
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
        "SELECT_CANDIDATE requires selectionMode=ATTACH_NEW or REUSE_EXISTING."
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
        item.id ===
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
    candidate.alreadyAttached &&
    proposal.selectionMode !==
      "REUSE_EXISTING"
  ) {
    return {
      status:
        "CANDIDATE_ALREADY_ATTACHED",
      safeToSelect: false,
      grounded: true,
      reason:
        "An already-attached runtime candidate may only be selected with REUSE_EXISTING mode.",
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
      evidencePathIsUnsafe(
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
    !candidate.alreadyAttached &&
    proposal.selectionMode !==
      "ATTACH_NEW"
  ) {
    return {
      status:
        "CANDIDATE_NOT_ATTACHED",
      safeToSelect: false,
      grounded: true,
      reason:
        "REUSE_EXISTING requires a candidate that is already attached in the supplied runtime state.",
      candidate,
    };
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
- the supplied candidate IDs, labels, eligibility flags, and flattened metadata.

The canonical requirements are the goal, successCriteria, automatedChecks, and fixtureRequirements fields together.
Goal and successCriteria remain authoritative when either optional array is empty.
Do not treat an empty automatedChecks or fixtureRequirements array as missing context by itself.
Requirements explicitly described as manual, manual follow-up, or unavailable are out of scope for automated fixture selection; use the remaining automated surface requirements.

Do not execute or propose API, browser, or database actions.
Treat candidate IDs as opaque runtime identifiers.
Do not use issue-specific, case-specific, environment-specific, or title-specific prior knowledge.
Ignore any requirement that is not supplied in the input.
Prefer a candidate whose exact metadata best supports the automated requirements.
Compare every candidate independently; array order conveys no preference.
When a requirement only needs a representative usable record to render the asserted surface, select the candidate whose semantic metadata best demonstrates that surface.
Evaluate only the fixture candidate's contribution to the requirements.
The domain provider owns attachment and later API/UI verification, so do not require candidates to contain route, target-entity, surrounding-section, or post-attachment UI state metadata.
alreadyAttached is the exact attachment state for the current target runtime; do not ask for a separate contract, job, or target assignment field.
For a representative-record requirement that does not demand a subtype, prefer the usable candidate with the clearest general user-facing label and description over a candidate specialized for an unrelated subtype.
Prefer REUSE_EXISTING over ATTACH_NEW when candidates are otherwise equally suitable.
If multiple candidates remain equally suitable and metadata cannot distinguish them, return NEEDS_MORE_CONTEXT instead of selecting by position.
Never choose an unusable candidate.
Use REUSE_EXISTING only for a candidate whose alreadyAttached value is true.
Use ATTACH_NEW only for a candidate whose alreadyAttached value is false.
Return NO_COMPATIBLE_CANDIDATE when no candidate is compatible.
Return NEEDS_MORE_CONTEXT when compatibility cannot be determined from supplied metadata.
Use high confidence only when exact supplied metadata clearly supports the choice.
Do not use opaque IDs, ownership/audit fields, timestamps, internal notes, sensitive fields, or redacted/reference-presence markers as evidence of semantic suitability.
The deterministic evaluator rejects evidence paths whose final key is id or ends in Id, as well as company, createdAt, createdBy, updatedAt, internalNotes, sensitive, and reference paths.
candidateId identifies the proposed candidate but never serves as semantic evidence.
Do not infer a project, company, document, approval, or other scope unless the canonical requirements explicitly call for it.
For a general representative-record requirement, compare user-facing labels and semantic capabilities and choose the uniquely clearest representative when one exists.

Return only one JSON object:

{
  "decision": "SELECT_CANDIDATE | NO_COMPATIBLE_CANDIDATE | NEEDS_MORE_CONTEXT",
  "selectionMode": "ATTACH_NEW | REUSE_EXISTING; required only for SELECT_CANDIDATE",
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
- For SELECT_CANDIDATE, selectionMode must exactly match the candidate's alreadyAttached state.
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
        candidates,
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
