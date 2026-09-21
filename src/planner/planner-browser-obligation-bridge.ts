import {
  createHash,
} from "node:crypto";

import type {
  BrowserCollectionFilterPredicate,
  BrowserCollectionFilterRequirement,
  BrowserLocalControlStateTransitionRequirement,
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  PlannerBrowserObligationBinding,
  PlannerBrowserObligationSemanticFamily,
  TestPlan,
} from "./types.js";
import {
  classifyPlannerBrowserObligationSemanticFamily,
} from "./planner-browser-obligation-semantics.js";

type Allocation = {
  status: "ALLOCATED" | "UNALLOCATED" | "AMBIGUOUS";
  cases: BrowserTestCase[];
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function folded(value: unknown): string {
  return normalize(value).toLowerCase();
}

function stableId(parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 12);
}

function browserCaseFragments(testCase: BrowserTestCase): string[] {
  return [
    testCase.goal,
    testCase.successCriteria,
    testCase.startRoute,
    ...(testCase.automatedChecks ?? []),
    ...(testCase.manualChecks ?? []),
    ...(testCase.fixtureRequirements ?? []),
  ].map(normalize).filter(Boolean);
}

function browserCaseText(testCase: BrowserTestCase): string {
  return browserCaseFragments(testCase).join(" ");
}

function caseFamilies(
  testCase: BrowserTestCase
): Set<PlannerBrowserObligationSemanticFamily> {
  return new Set(
    browserCaseFragments(testCase).map(
      classifyPlannerBrowserObligationSemanticFamily
    )
  );
}

function normalizeSurface(value: string): string {
  return folded(value)
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sourceBackedPageSurfaces(value: string): string[] {
  const text = normalize(value);
  const match =
    text.match(
      /\b(?:for|to|on|in)\s+(?:the\s+)?(.+?)\s+(?:pages?|tables?)\b/i
    ) ??
    text.match(
      /^(?:the\s+)?(.+?)\s+(?:pages?|tables?)\b/i
    );

  if (!match?.[1]) return [];

  return [...new Set(match[1]
    .split(/\s*(?:&|\band\b)\s*/i)
    .map(normalizeSurface)
    .filter(Boolean))];
}

export function sourceBackedSurfaceMemberId(surface: string): string {
  return normalizeSurface(surface).replace(/\s+/g, "-");
}

function pageSurfacesInText(value: string): string[] {
  const text = normalize(value);
  const surfaces: string[] = [];
  const pattern =
    /(?:^\s*(?:(?:the|on|to|for)\s+)?|\b(?:the|on|to|for)\s+)([a-z0-9][a-z0-9 /&-]{0,60}?)\s+pages?\b/gi;

  for (const match of text.matchAll(pattern)) {
    const surface = normalizeSurface(match[1] ?? "");
    if (surface) surfaces.push(surface);
  }
  return [...new Set(surfaces)];
}

export function browserCasePageSurfaces(testCase: BrowserTestCase): string[] {
  const text = browserCaseText(testCase);
  return pageSurfacesInText(text);
}

/** Candidate text can bind only to an already source-defined member. */
export function sourceBackedSurfaceMatches(
  value: string,
  sourceSurfaces: string[]
): string[] {
  const text = ` ${normalizeSurface(value)} `;
  const matches = sourceSurfaces.filter((surface) => {
    const normalized = normalizeSurface(surface);
    return normalized && text.includes(` ${normalized} `);
  });
  const maximal = matches.filter((surface) => !matches.some((other) =>
    other !== surface &&
    normalizeSurface(other).endsWith(` ${normalizeSurface(surface)}`)
  ));
  return [...new Set(maximal)].sort();
}

function directionFacets(value: string): string[] {
  const text = folded(value);
  const facets: string[] = [];

  if (/\b(?:markdown )?editor\b|\bauthoring\b/.test(text)) {
    facets.push("EDITOR");
  }
  if (/\bradio\b|\bcheckbox\b/.test(text)) {
    facets.push("CHOICE_CONTROLS");
  }
  if (/\blist\b|\bblockquote\b|\btable(?:-cell)?\b/.test(text)) {
    facets.push("RICH_BLOCKS");
  }
  if (/\benglish\b.+\b(?:urdu|mixed)\b|\bmixed\b.+\bdirection/.test(text)) {
    facets.push("MIXED_DIRECTION");
  }
  if (/\bheadings?\b.+\bparagraphs?\b|\bparagraphs?\b.+\bheadings?\b/.test(text)) {
    facets.push("BLOCK_DIRECTION");
  }

  return facets;
}

function stateFacets(value: string): string[] {
  const text = folded(value);
  const facets: string[] = [];

  if (/\breset\b.+\b(?:default|restore)|\brestore\b.+\bdefault/.test(text)) {
    facets.push("RESET_DEFAULT");
  }
  if (/\bevents?\b.+\b(?:score|pass)\b/.test(text)) {
    facets.push("EVENT_SCORE");
  }
  if (/\bstored\b.+\boverrides?\b/.test(text)) {
    facets.push("STORED_OVERRIDE");
  }
  if (/\b(?:completed\s+)?results?\b.+\bunchanged\b/.test(text)) {
    facets.push("HISTORY_PRESERVATION");
  }
  if (/\b(?:instead\s+use|instead of|rather than)\b/.test(text)) {
    facets.push("CONFIG_SOURCE");
  }

  return facets;
}

function groupedControlFacets(value: string): string[] {
  const text = folded(value);
  const facets: string[] = [];

  if (/\bradio\b|\bcheckbox\b/.test(text)) {
    facets.push("CHOICE_CONTROLS");
  }
  if (/\bcustom scoring\b/.test(text)) {
    facets.push("CUSTOM_SCORING");
  }

  return facets;
}

function containsAllFacets(
  required: string[],
  available: string[]
): boolean {
  const availableSet = new Set(available);
  return (
    required.length > 0 &&
    required.every((facet) =>
      availableSet.has(facet)
    )
  );
}

function semanticCompatible(
  obligation: PlannerAcceptanceObligation,
  family: PlannerBrowserObligationSemanticFamily,
  testCase: BrowserTestCase
): boolean {
  if (!caseFamilies(testCase).has(family)) return false;

  if (family === "LAYOUT_DIRECTION") {
    return containsAllFacets(
      directionFacets(obligation.text),
      directionFacets(browserCaseText(testCase))
    );
  }

  if (family === "STATE_TRANSITION") {
    return containsAllFacets(
      stateFacets(obligation.text),
      stateFacets(browserCaseText(testCase))
    );
  }

  if (family === "GROUPED_CONTROLS") {
    return containsAllFacets(
      groupedControlFacets(obligation.text),
      groupedControlFacets(browserCaseText(testCase))
    );
  }

  if (family === "SERVER_LIFECYCLE_NON_BROWSER") {
    return false;
  }

  if (family === "OTHER") {
    return false;
  }

  return true;
}

function allocateObligation(
  obligation: PlannerAcceptanceObligation,
  family: PlannerBrowserObligationSemanticFamily,
  browserCases: BrowserTestCase[]
): Allocation {
  const compatible = browserCases.filter(
    (testCase) =>
      semanticCompatible(
        obligation,
        family,
        testCase
      )
  );
  const explicit = compatible.filter(
    (testCase) =>
      testCase.acceptanceObligationIds
        ?.includes(obligation.id)
  );

  if (family === "SEARCH_FILTER") {
    const surfaces = sourceBackedPageSurfaces(
      obligation.text
    );

    if (surfaces.length > 0) {
      const selected = new Set<BrowserTestCase>();

      for (const surface of surfaces) {
        const matches = compatible.filter(
          (testCase) =>
            browserCasePageSurfaces(testCase)
              .includes(surface)
        );

        if (matches.length === 0) {
          return {
            status: "UNALLOCATED",
            cases: [],
          };
        }
        if (matches.length > 1) {
          return {
            status: "AMBIGUOUS",
            cases: [],
          };
        }

        selected.add(matches[0]!);
      }

      return {
        status: "ALLOCATED",
        cases: [...selected],
      };
    }
  }

  if (explicit.length > 0) {
    return {
      status: "ALLOCATED",
      cases: explicit,
    };
  }

  if (
    family === "LAYOUT_DIRECTION" &&
    directionFacets(obligation.text).length > 0 &&
    compatible.length > 0
  ) {
    return {
      status: "ALLOCATED",
      cases: compatible,
    };
  }

  if (compatible.length === 0) {
    return {
      status: "UNALLOCATED",
      cases: [],
    };
  }

  if (compatible.length > 1) {
    return {
      status: "AMBIGUOUS",
      cases: [],
    };
  }

  return {
    status: "ALLOCATED",
    cases: compatible,
  };
}

function manualByNature(value: string): boolean {
  return /\b(?:subjective|visually pleasing|professional tone|aesthetically pleasing)\b/i.test(
    value
  );
}

function explicitFilterField(
  value: string
): string | undefined {
  const quoted = value.match(
    /\bvisible\s+["“]([^"”]+)["”]\s+field\b/i
  );
  return normalize(quoted?.[1]) || undefined;
}

function explicitFilterPredicate(
  value: string
): BrowserCollectionFilterPredicate | undefined {
  if (/\b(?:exact text|exact match|matches exactly)\b/i.test(value)) {
    return "EXACT_TEXT";
  }
  if (/\bcase-insensitive contains\b/i.test(value)) {
    return "CASE_INSENSITIVE_CONTAINS";
  }
  return undefined;
}

type SourceAuthorizedResetDefault = {
  expectedValue: number;
  sourceLabel: string;
  sourceUnitId: string;
  sourceRef: string;
};

type FrontendDefaultValueBinding = {
  sourceEvidenceRef: string;
  sourceLabel: string;
  sourceProperty: string;
};

function finiteNumericLiteral(
  value: unknown
): number | undefined {
  const text = normalize(value);

  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) {
    return undefined;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function sourceAuthorizedResetDefault(args: {
  obligation: PlannerAcceptanceObligation;
  sourceLedger: PlannerAcceptanceSourceLedger;
}): SourceAuthorizedResetDefault | undefined {
  const { obligation, sourceLedger } = args;

  if (
    obligation.sourceRole !== "ACCEPTANCE" ||
    obligation.sourceUnitIds.length !== 1 ||
    sourceLedger.sourceStatus !== "RESOLVED"
  ) {
    return undefined;
  }

  const sourceUnit = sourceLedger.sourceUnits.find(
    (unit) => unit.id === obligation.sourceUnitIds[0]
  );

  if (
    !sourceUnit ||
    normalize(sourceUnit.text) !== normalize(obligation.text) ||
    !/^jira\./i.test(sourceUnit.sourceRef)
  ) {
    return undefined;
  }

  const text = normalize(obligation.text)
    .replace(/^\[[ xX]\]\s*/, "");
  const reset = text.match(
    /\breset(?:\s+to)?\s+defaults?\b[^;.!?]{0,100}\brestores?\s+(?:the\s+)?(?:default(?:\s+value)?\s+)?(?:to\s+)?(-?(?:\d+(?:\.\d+)?|\.\d+))\b/i
  );
  const visibleValue = text.match(
    /\b(?:shows?|displays?)\s+(.{1,100}?)\s+(?:as|with(?:\s+(?:a|the))?\s+(?:default\s+)?value(?:\s+of)?)\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\b/i
  );
  const explicitDefault = text.match(
    /\b([A-Za-z][A-Za-z0-9 _/-]{0,80}?)\s+(?:has\s+)?(?:a\s+)?default(?:\s+value)?\s+(?:of|is|becomes|=)\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\b/i
  );
  const valueClause = visibleValue ?? explicitDefault;
  const expectedValue = finiteNumericLiteral(valueClause?.[2]);
  const resetValue = finiteNumericLiteral(reset?.[1]);
  const sourceLabel = normalize(valueClause?.[1])
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();

  if (
    expectedValue === undefined ||
    resetValue === undefined ||
    !Object.is(expectedValue, resetValue) ||
    !sourceLabel ||
    !/\b(?:new|initial|default)\b/i.test(text)
  ) {
    return undefined;
  }

  return {
    expectedValue,
    sourceLabel,
    sourceUnitId: sourceUnit.id,
    sourceRef: sourceUnit.sourceRef,
  };
}

function frontendPatchBlocks(
  sourceContext: string
): Array<{ file: string; source: string }> {
  return sourceContext
    .split(/(?=^Patch for\s+)/gm)
    .flatMap((source) => {
      const file = /^Patch for\s+([^:\r\n]+):/m
        .exec(source)?.[1]
        ?.trim();

      if (
        !file ||
        !file.startsWith("src/") ||
        file.split("/").includes("..") ||
        !/\.[jt]sx?$/.test(file)
      ) {
        return [];
      }

      return [{ file, source }];
    });
}

function frontendDefaultValueBinding(args: {
  sourceContext: string;
  sourceLabel: string;
  expectedValue: number;
}): FrontendDefaultValueBinding | undefined {
  const matches = new Map<
    string,
    FrontendDefaultValueBinding
  >();

  for (const block of frontendPatchBlocks(args.sourceContext)) {
    const changedDefault =
      /^\+\s*(default[A-Za-z0-9_]*)\s*:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,?/gim;

    for (const propertyMatch of block.source.matchAll(changedDefault)) {
      const value = finiteNumericLiteral(propertyMatch[2]);
      if (!Object.is(value, args.expectedValue)) continue;

      const prefix = block.source.slice(
        Math.max(0, (propertyMatch.index ?? 0) - 600),
        propertyMatch.index
      );
      const labels = [
        ...prefix.matchAll(
          /\blabel\s*:\s*["'`]([^"'`]+)["'`]/gi
        ),
      ];
      const nearestLabel = labels.at(-1)?.[1]?.trim();

      if (
        !nearestLabel ||
        folded(nearestLabel) !==
          folded(args.sourceLabel)
      ) {
        continue;
      }

      const sourceProperty = propertyMatch[1]!;
      const signature = [
        block.file,
        folded(nearestLabel),
        sourceProperty,
      ].join("\u0000");
      matches.set(signature, {
        sourceEvidenceRef: block.file,
        sourceLabel: nearestLabel,
        sourceProperty,
      });
    }
  }

  return matches.size === 1
    ? [...matches.values()][0]
    : undefined;
}

function buildAuthorizedLocalStateRequirement(args: {
  obligation: PlannerAcceptanceObligation;
  sourceLedger: PlannerAcceptanceSourceLedger;
  sourceContext: string;
}): {
  recognized: boolean;
  requirement?: BrowserLocalControlStateTransitionRequirement;
  missingAuthority: string[];
} {
  const contract = sourceAuthorizedResetDefault(args);

  if (!contract) {
    return {
      recognized: false,
      missingAuthority: [],
    };
  }

  const binding = frontendDefaultValueBinding({
    sourceContext: args.sourceContext,
    sourceLabel: contract.sourceLabel,
    expectedValue: contract.expectedValue,
  });

  if (!binding) {
    return {
      recognized: true,
      missingAuthority: [
        "FRONTEND_LABELLED_DEFAULT_PROPERTY",
      ],
    };
  }

  const requirementId =
    `local-control-state-transition-${stableId([
      args.obligation.id,
      contract.sourceUnitId,
      "RESET_RESTORES_DEFAULT",
      String(contract.expectedValue),
    ])}`;

  return {
    recognized: true,
    missingAuthority: [],
    requirement: {
      kind:
        "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
      requirementId,
      obligationId: args.obligation.id,
      sourceRefs: [{
        sourceUnitId: contract.sourceUnitId,
        sourceRef: contract.sourceRef,
        sourceRole: "ACCEPTANCE",
      }],
      authority: {
        sourceRole: "ACCEPTANCE",
        proofAuthority: "ACCEPTANCE",
      },
      transition: {
        semantic: "RESET_RESTORES_DEFAULT",
        expectedValue: contract.expectedValue,
        expectedValueAuthority:
          "JIRA_AUTHORIZED",
      },
      structuralBinding: {
        sourceEvidenceRefs: [
          binding.sourceEvidenceRef,
        ],
        valueBinding: {
          evidenceKind:
            "LABELLED_DEFAULT_PROPERTY",
          sourceLabel: binding.sourceLabel,
          sourceProperty:
            binding.sourceProperty,
        },
      },
    },
  };
}

function buildAuthorizedFilterRequirement(args: {
  obligation: PlannerAcceptanceObligation;
  sourceLedger: PlannerAcceptanceSourceLedger;
  testCase: BrowserTestCase;
}): {
  requirement?: BrowserCollectionFilterRequirement;
  missingAuthority: string[];
} {
  const sourceUnit =
    args.sourceLedger.sourceUnits.find(
      (unit) =>
        args.obligation.sourceUnitIds.includes(
          unit.id
        )
    );
  const field = explicitFilterField(
    args.obligation.text
  );
  const predicate = explicitFilterPredicate(
    args.obligation.text
  );
  const matchingExpectation =
    /\bmatching\s+(?:rows?|records?|items?|results?)\s+(?:are\s+)?(?:included|shown|displayed|returned)\b/i.test(
      args.obligation.text
    );
  const missingAuthority = [
    ...(!field ? ["VISIBLE_FILTER_FIELD"] : []),
    ...(!predicate ? ["FILTER_PREDICATE"] : []),
    ...(!matchingExpectation
      ? ["MATCHING_RESULT_EXPECTATION"]
      : []),
  ];

  if (!sourceUnit || missingAuthority.length > 0) {
    return { missingAuthority };
  }

  const requirementId =
    `${args.obligation.id}:${args.testCase.id}:collection-filter`;
  const sourceRef =
    `${sourceUnit.sourceRef}#${sourceUnit.id}`;
  const bindingId =
    `collection-filter-binding-${stableId([
      requirementId,
      field!,
      sourceRef,
    ])}`;

  return {
    missingAuthority: [],
    requirement: {
      kind: "COLLECTION_FILTER",
      requirementId,
      sourceClaim: args.obligation.text,
      interactionKind: "TEXT_SEARCH",
      controlSemantic: "SEARCH",
      authority: "AUTHORITATIVE",
      sourceRef,
      probes: [{
        probeId: `${requirementId}:visible-field`,
        querySource: "RUNTIME_VISIBLE_FIELD",
        predicate: predicate!,
        fieldScope: {
          kind: "VISIBLE_FIELD",
          visibleLabel: field!,
          proofFieldBinding: {
            bindingId,
            requirementId,
            proposedField: field!,
            proposalSource: "AC_EXPLICIT",
            authority: "AUTHORITATIVE",
            sourceRef,
          },
        },
        expectation: "MATCHING_ROW_INCLUDED",
        manualCheck: args.obligation.text,
      }],
    },
  };
}

function addObligationId(
  testCase: BrowserTestCase,
  obligationId: string
): void {
  testCase.acceptanceObligationIds = [
    ...new Set([
      ...(testCase.acceptanceObligationIds ?? []),
      obligationId,
    ]),
  ].sort();
}

function addFilterRequirement(
  testCase: BrowserTestCase,
  requirement: BrowserCollectionFilterRequirement
): void {
  const acceptanceScope =
    testCase.acceptanceScope ?? {
      requiresBehaviorProof: false,
      behaviorClaims: [],
    };
  const existing =
    acceptanceScope.collectionFilterRequirements ?? [];

  testCase.acceptanceScope = {
    ...acceptanceScope,
    requiresBehaviorProof: true,
    behaviorClaims: [
      ...new Set([
        ...acceptanceScope.behaviorClaims,
        requirement.sourceClaim,
      ]),
    ],
    collectionFilterRequirements: [
      ...existing.filter(
        (item) =>
          item.requirementId !==
          requirement.requirementId
      ),
      requirement,
    ],
  };
}

function addLocalStateRequirement(
  testCase: BrowserTestCase,
  requirement:
    BrowserLocalControlStateTransitionRequirement,
  sourceClaim: string
): void {
  const acceptanceScope =
    testCase.acceptanceScope ?? {
      requiresBehaviorProof: false,
      behaviorClaims: [],
    };
  const existing =
    acceptanceScope
      .localControlStateTransitionRequirements ?? [];

  testCase.acceptanceScope = {
    ...acceptanceScope,
    requiresBehaviorProof: true,
    behaviorClaims: [
      ...new Set([
        ...acceptanceScope.behaviorClaims,
        sourceClaim,
      ]),
    ],
    localControlStateTransitionRequirements: [
      ...existing.filter(
        (item) =>
          item.requirementId !==
          requirement.requirementId
      ),
      requirement,
    ],
  };
}

export function applySourceBackedBrowserObligationBridge(
  plan: TestPlan,
  args: {
    sourceLedger: PlannerAcceptanceSourceLedger;
    obligationLedger: PlannerAcceptanceObligationLedger;
    sourceContext?: string;
  }
): TestPlan {
  const browserCases = Array.isArray(plan.browserCases)
    ? plan.browserCases
    : [];
  const bindings: PlannerBrowserObligationBinding[] = [];
  const authoritativeObligationIds = new Set(
    args.obligationLedger.obligations.map(
      (obligation) => obligation.id
    )
  );

  // Model-proposed proof contracts are candidates only. V0 rebuilds the sole
  // supported contract family from authoritative source or leaves it unbound.
  for (const testCase of browserCases) {
    const proposedObligationIds =
      testCase.acceptanceObligationIds ?? [];
    const validatedObligationIds =
      proposedObligationIds.filter((id) =>
        authoritativeObligationIds.has(id)
      );

    if (validatedObligationIds.length > 0) {
      testCase.acceptanceObligationIds = [
        ...new Set(validatedObligationIds),
      ].sort();
    } else {
      delete testCase.acceptanceObligationIds;
    }

    if (
      testCase.acceptanceScope
        ?.collectionFilterRequirements ||
      testCase.acceptanceScope
        ?.localControlStateTransitionRequirements
    ) {
      const {
        collectionFilterRequirements: _ignored,
        localControlStateTransitionRequirements:
          _ignoredLocalState,
        ...acceptanceScope
      } = testCase.acceptanceScope;
      testCase.acceptanceScope = acceptanceScope;
    }
  }

  for (const obligation of args.obligationLedger.obligations) {
    const semanticFamily =
      classifyPlannerBrowserObligationSemanticFamily(
        obligation.text
      );
    const allocation = allocateObligation(
      obligation,
      semanticFamily,
      browserCases
    );

    if (manualByNature(obligation.text)) {
      bindings.push({
        obligationId: obligation.id,
        sourceUnitIds: obligation.sourceUnitIds,
        semanticFamily,
        state: "MANUAL_BY_NATURE",
        allocatedCaseIds: allocation.cases.map((item) => item.id),
        reason: "The authoritative requirement explicitly requires subjective human judgment.",
      });
      continue;
    }

    if (allocation.status === "UNALLOCATED") {
      bindings.push({
        obligationId: obligation.id,
        sourceUnitIds: obligation.sourceUnitIds,
        semanticFamily,
        state: "UNALLOCATED_AUTHORITATIVE_OBLIGATION",
        allocatedCaseIds: [],
        reason: "No compatible retained browser case was deterministically available.",
      });
      continue;
    }

    if (allocation.status === "AMBIGUOUS") {
      bindings.push({
        obligationId: obligation.id,
        sourceUnitIds: obligation.sourceUnitIds,
        semanticFamily,
        state: "AMBIGUOUS_CASE_ALLOCATION",
        allocatedCaseIds: [],
        reason: "Multiple compatible cases remained without authoritative allocation metadata.",
      });
      continue;
    }

    for (const testCase of allocation.cases) {
      addObligationId(testCase, obligation.id);
    }

    const localState =
      buildAuthorizedLocalStateRequirement({
        obligation,
        sourceLedger: args.sourceLedger,
        sourceContext:
          args.sourceContext ?? "",
      });

    if (localState.recognized) {
      if (!localState.requirement) {
        bindings.push({
          obligationId: obligation.id,
          sourceUnitIds: obligation.sourceUnitIds,
          semanticFamily,
          state: "SUPPORTED_BUT_UNBOUND",
          allocatedCaseIds:
            allocation.cases.map((item) => item.id),
          reason:
            "The reset-to-default behavior is source-authorized, but bounded frontend value-binding evidence is unavailable or ambiguous.",
          missingAuthority:
            localState.missingAuthority,
        });
        continue;
      }

      for (const testCase of allocation.cases) {
        addLocalStateRequirement(
          testCase,
          localState.requirement,
          obligation.text
        );
      }

      bindings.push({
        obligationId: obligation.id,
        sourceUnitIds: obligation.sourceUnitIds,
        semanticFamily,
        state: "SUPPORTED_AND_BOUND",
        allocatedCaseIds:
          allocation.cases.map((item) => item.id),
        emittedRequirementIds: [
          localState.requirement.requirementId,
        ],
        reason:
          "The exact reset-to-default contract is Jira-authorized and its labelled default property is bounded by frontend source evidence.",
      });
      continue;
    }

    if (semanticFamily !== "SEARCH_FILTER") {
      bindings.push({
        obligationId: obligation.id,
        sourceUnitIds: obligation.sourceUnitIds,
        semanticFamily,
        state: "UNSUPPORTED_AUTOMATION_SEMANTIC",
        allocatedCaseIds: allocation.cases.map((item) => item.id),
        reason: "The obligation is objective, but V0 has no deterministic proof adapter for this semantic family.",
      });
      continue;
    }

    const built = allocation.cases.map(
      (testCase) => ({
        testCase,
        ...buildAuthorizedFilterRequirement({
          obligation,
          sourceLedger: args.sourceLedger,
          testCase,
        }),
      })
    );
    const missingAuthority = [
      ...new Set(
        built.flatMap(
          (item) => item.missingAuthority
        )
      ),
    ];

    if (
      missingAuthority.length > 0 ||
      built.some((item) => !item.requirement)
    ) {
      bindings.push({
        obligationId: obligation.id,
        sourceUnitIds: obligation.sourceUnitIds,
        semanticFamily,
        state: "SUPPORTED_BUT_UNBOUND",
        allocatedCaseIds: allocation.cases.map((item) => item.id),
        reason: "Search/filter is supported, but the authoritative source does not bind every property required by the existing proof contract.",
        missingAuthority,
      });
      continue;
    }

    const emittedRequirementIds: string[] = [];
    for (const item of built) {
      addFilterRequirement(
        item.testCase,
        item.requirement!
      );
      emittedRequirementIds.push(
        item.requirement!.requirementId
      );
    }

    bindings.push({
      obligationId: obligation.id,
      sourceUnitIds: obligation.sourceUnitIds,
      semanticFamily,
      state: "SUPPORTED_AND_BOUND",
      allocatedCaseIds: allocation.cases.map((item) => item.id),
      emittedRequirementIds,
      reason: "Every property required by the existing search/filter contract is explicitly source-authorized.",
    });
  }

  plan.browserCases = browserCases;
  plan.browserObligationBindings = bindings;
  return plan;
}
