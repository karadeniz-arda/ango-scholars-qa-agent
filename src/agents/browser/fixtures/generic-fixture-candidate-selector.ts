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

export type GenericFixtureCandidateProposal = {
  decision:
    GenericFixtureCandidateDecision;
  rationale: string;
  confidence:
    GenericFixtureCandidateConfidence;
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
  | "LOW_CONFIDENCE"
  | "EVIDENCE_REQUIRED"
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

const SECRET_KEY =
  /token|secret|password|credential|authorization|cookie/i;

const REFERENCE_KEY =
  /url|signed|download|documentPath|filePath/i;

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
    candidate.alreadyAttached
  ) {
    return {
      status:
        "CANDIDATE_ALREADY_ATTACHED",
      safeToSelect: false,
      grounded: true,
      reason:
        "The proposed runtime candidate is already attached and cannot establish provider ownership.",
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

  return {
    status:
      "SAFE_TO_SELECT",
    safeToSelect: true,
    grounded: true,
    reason:
      "The model-selected candidate is exact, usable, unattached, high-confidence, and grounded by runtime metadata.",
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

Do not execute or propose API, browser, or database actions.
Treat candidate IDs as opaque runtime identifiers.
Do not use issue-specific, case-specific, environment-specific, or title-specific prior knowledge.
Ignore any requirement that is not supplied in the input.
Prefer a candidate whose exact metadata best supports the automated requirements.
Never choose an unusable or already-attached candidate.
Return NO_COMPATIBLE_CANDIDATE when no candidate is compatible.
Return NEEDS_MORE_CONTEXT when compatibility cannot be determined from supplied metadata.
Use high confidence only when exact supplied metadata clearly supports the choice.

Return only one JSON object:

{
  "decision": "SELECT_CANDIDATE | NO_COMPATIBLE_CANDIDATE | NEEDS_MORE_CONTEXT",
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
- For SELECT_CANDIDATE, include one or more exact evidence entries.
- Evidence paths and values must be copied exactly from the selected candidate.
- Do not invent fields, IDs, values, or requirements.
- Do not include markdown.
`.trim();

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
        ...getReasoningOptions(),
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
