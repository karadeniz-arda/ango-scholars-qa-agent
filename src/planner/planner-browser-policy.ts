import {
  applySourceGroundedBrowserFilterCoverage,
  hasSourceGroundedQueryAssertion,
} from "./planner-browser-filter-coverage.js";
import type {
  BrowserAcceptanceScope,
  BrowserOrderingRequirement,
  BrowserOrderingProofFieldBinding,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  SelectedStateRequirement,
} from "./types.js";
import { createHash } from "node:crypto";

export { applySourceGroundedBrowserFilterCoverage };

type RetainedStructuredAcceptanceScope = Pick<
  BrowserAcceptanceScope,
  | "urlTransitionRequirements"
  | "selectedStateRequirements"
  | "collectionFilterRequirements"
  | "localControlStateTransitionRequirements"
>;

function retainStructuredAcceptanceScope(
  scope: BrowserAcceptanceScope | undefined
): Partial<RetainedStructuredAcceptanceScope> {
  return {
    ...(Array.isArray(scope?.urlTransitionRequirements)
      ? {
          urlTransitionRequirements:
            scope.urlTransitionRequirements,
        }
      : {}),
    ...(Array.isArray(scope?.selectedStateRequirements)
      ? {
          selectedStateRequirements:
            scope.selectedStateRequirements,
        }
      : {}),
    ...(Array.isArray(scope?.collectionFilterRequirements)
      ? {
          collectionFilterRequirements:
            scope.collectionFilterRequirements,
        }
      : {}),
    ...(Array.isArray(
      scope?.localControlStateTransitionRequirements
    )
      ? {
          localControlStateTransitionRequirements:
            scope.localControlStateTransitionRequirements,
        }
      : {}),
  };
}

function collectBrowserIntentText(
  testCase: any
): string {
  const steps = Array.isArray(testCase?.steps)
    ? testCase.steps
        .map((step: any) =>
          [
            step?.action,
            step?.text,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ")
    : "";

  return [
    testCase?.goal,
    testCase?.successCriteria,
    steps,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isDeepBrowserCase(testCase: any): boolean {
  const text = collectBrowserIntentText(testCase);

  const explicitDeepTerms = [
    "details page",
    "detail page",
    "job details",
    "details panel",
    "detail panel",
    "action area",
    "comparison view",
    "comparison modal",
    "review modal",
    "review controls",
    "current versus proposed",
    "current-versus-proposed",
    "open a publish request",
    "opening a publish request",
    "open a seeded",
    "opening a seeded",
    "apply and reject",
    "apply or reject",
    "approve and reject",
    "approve or reject",
  ];

  if (
    explicitDeepTerms.some((term) =>
      text.includes(term)
    )
  ) {
    return true;
  }

  const normalizedText = text.replace(
    /[-_]+/g,
    " "
  );

  const needsSpecificJobState =
    normalizedText.includes("job") &&
    (
      normalizedText.includes("draft job") ||
      normalizedText.includes("non draft job") ||
      normalizedText.includes("active job") ||
      normalizedText.includes("job details") ||
      normalizedText.includes("existing job")
    );

  return needsSpecificJobState;
}

export function isGenericBrowserEntryRoute(
  route: string
): boolean {
  const normalizedRoute = route
    .trim()
    .replace(/\/$/, "");

  if (
    normalizedRoute === "/company/jobs/create" ||
    normalizedRoute === "/company/jobs/new"
  ) {
    return true;
  }

  return new Set([
    "/company/jobs",
    "/company/all-jobs",
    "/company/work-setups",
    "/company/all-work-setups",
    "/company/all-payments",
    "/company/contracts",
    "/talent/jobs",
    "/talent/payments",
  ]).has(normalizedRoute);
}

function getUrlAssertionQueryKey(
  expected: string
): string | null {
  const match =
    String(expected || "")
      .trim()
      .match(
        /(?:^|[?&])([A-Za-z][A-Za-z0-9_.-]*)=/
      );

  return match?.[1]?.toLowerCase() ?? null;
}

function isGenericPaymentsNavigationLabel(
  value: unknown
): boolean {
  const normalized =
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  return new Set([
    "payment",
    "payments",
    "all payment",
    "all payments",
    "timesheet",
    "timesheets",
    "all timesheet",
    "all timesheets",
  ]).has(normalized);
}

function hasOrderedBrowserActions(
  steps: any[],
  firstAction: string,
  secondAction: string
): boolean {
  let firstActionSeen = false;

  for (const step of steps) {
    const action =
      String(step?.action || "");

    if (action === firstAction) {
      firstActionSeen = true;
      continue;
    }

    if (
      firstActionSeen &&
      action === secondAction
    ) {
      return true;
    }
  }

  return false;
}

function hasRuntimeFilterSelectionPrerequisite(
  steps: any[],
  expectedQueryKey: string
): boolean {
  let menuOpened = false;

  for (const step of steps) {
    const action =
      String(step?.action || "");

    if (action === "openMenu") {
      menuOpened = true;
      continue;
    }

    if (
      menuOpened &&
      action ===
        "selectRuntimeFilterOption" &&
      String(
        step?.queryKey || ""
      )
        .trim()
        .toLowerCase() ===
        expectedQueryKey
          .trim()
          .toLowerCase()
    ) {
      return true;
    }
  }

  return false;
}

function hasUrlAssertionStatePrerequisite(
  args: {
    stepsBeforeAssertion: any[];
    expected: string;
    startRoute: string;
  }
): boolean {
  const {
    stepsBeforeAssertion,
    expected,
    startRoute,
  } = args;

  if (
    expected &&
    startRoute.includes(expected)
  ) {
    return true;
  }

  const hasJobCreationRedirectAction =
    stepsBeforeAssertion.some(
      (step: any) =>
        step?.action ===
        "createDraftJobAndVerifyRedirect"
    );

  if (
    hasJobCreationRedirectAction &&
    new Set([
      "/company/jobs/",
      "/company/all-jobs/",
      "project=",
    ]).has(expected)
  ) {
    return true;
  }

  const queryKey =
    getUrlAssertionQueryKey(expected);

  /*
   * Positive query assertions must use an exact
   * query-key substring such as "tab=".
   *
   * Bare strings such as "tab" or "project" are
   * too broad and can accidentally match unrelated
   * paths, text, or parameter names.
   */
  if (!queryKey) {
    return false;
  }

  if (queryKey === "tab") {
    return stepsBeforeAssertion.some(
      (step: any) =>
        step?.action ===
          "selectRuntimeTopTab" ||
        (
          step?.action ===
            "clickTopTab" &&
          String(
            step?.text || ""
          ).trim() &&
          !isGenericPaymentsNavigationLabel(
            step?.text
          )
        )
    );
  }

  if (queryKey === "project") {
    return (
      hasRuntimeFilterSelectionPrerequisite(
        stepsBeforeAssertion,
        queryKey
      ) ||
      hasOrderedBrowserActions(
        stepsBeforeAssertion,
        "clickProjectDropdown",
        "selectLastDropdownOption"
      ) ||
      hasOrderedBrowserActions(
        stepsBeforeAssertion,
        "openMenu",
        "selectOption"
      )
    );
  }

  /*
   * Generic filter query keys require an actual
   * option selection. Merely opening a menu does
   * not establish URL state.
   */
  if (
    hasRuntimeFilterSelectionPrerequisite(
      stepsBeforeAssertion,
      queryKey
    ) ||
    hasOrderedBrowserActions(
      stepsBeforeAssertion,
      "openMenu",
      "selectOption"
    )
  ) {
    return true;
  }

  /*
   * Non-filter tab-like URL keys may be established
   * by a real tab interaction, but generic sidebar
   * navigation labels are deliberately excluded.
   */
  return stepsBeforeAssertion.some(
    (step: any) =>
      step?.action === "clickTopTab" &&
      String(step?.text || "").trim() &&
      !isGenericPaymentsNavigationLabel(
        step?.text
      )
  );
}

export function escapeRegularExpression(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function normalizeSourceGroundedVisibleText(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasVerbatimSourceGroundedVisibleText(
  expectedText: string,
  sourceContext: string
): boolean {
  const expected =
    normalizeSourceGroundedVisibleText(
      expectedText
    );

  if (!expected) {
    return false;
  }

  const source =
    normalizeSourceGroundedVisibleText(
      sourceContext
    );

  return source.includes(expected);
}

function normalizePlannerScopeList(
  value: unknown
): string[] {
  const values =
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : [];

  return [
    ...new Set(
      values
        .map((item) =>
          String(item ?? "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean)
    ),
  ];
}

function isStructuralEntityRequirement(
  value: unknown
): boolean {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const structuredEntityPattern =
    /\b(?:fields?|controls?|selectors?|dropdowns?|comboboxes?|inputs?|skills?|entities?)\b/;

  return (
    (
      /\b(?:separate|distinct|individual|independent)\b/.test(
        text
      ) &&
      structuredEntityPattern.test(
        text
      )
    ) ||
    /\b(?:two|three|four|five|six|seven|eight|nine|ten|multiple|several|\d+)\b.{0,80}\b(?:fields?|controls?|selectors?|dropdowns?|comboboxes?|inputs?|skills?|entities?)\b/.test(
      text
    )
  );
}

function isBrowserLinkNavigationClaim(
  value: unknown
): boolean {
  const text =
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  if (!text) {
    return false;
  }

  return (
    /\b(?:link|pdf|document)\b.{0,120}\b(?:open|opens|opened|activate|activates|activated|navigate|navigates|navigated|redirect|redirects|redirected|download|downloads|downloaded)\b/
      .test(text) ||
    /\b(?:open|opens|opened|activate|activates|activated|navigate|navigates|navigated|redirect|redirects|redirected|download|downloads|downloaded)\b.{0,120}\b(?:link|pdf|document|destination|destinations|target|page|route|url)\b/
      .test(text)
  );
}

function isBrowserBehaviorClaim(
  value: string
): boolean {
  const text =
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  if (!text) {
    return false;
  }

  /*
   * PHASE_2_ACCEPTANCE_SCOPE_V1
   *
   * Keep this deliberately narrow.
   *
   * This classifies declared automated claims that
   * require proof beyond static visibility.
   *
   * It does not decide whether that proof was
   * actually satisfied.
   */
const linkNavigationClaim =
  isBrowserLinkNavigationClaim(text);

const hasRecordCollection =
  /\b(?:record|records|row|rows|item|items|job|jobs)\b/
    .test(text);

/*
 * PLANNER_ORDERING_SORTING_LEXICAL_PARITY_V1
 *
 * "sorting" expresses the same ordering intent as
 * "sort"/"ordering". Keep this lexical classifier aligned
 * with the browser acceptance-coverage guard.
 */
const hasOrderingLanguage =
  /\b(?:sort|sorting|sorted|order|orders|ordered|ordering)\b/
    .test(text);

const hasOrderingOutcome =
  /\b(?:correct|correctly|ascending|descending|newest-first|oldest-first)\b/
    .test(text);

const recordOrderingClaim =
  hasRecordCollection &&
  hasOrderingLanguage &&
  hasOrderingOutcome;

  const optionalEmptyStateFlowClaim =
    /\b(?:zero|none|no|without)\b/.test(text) &&
    /\b(?:flow|wizard|process)\b/.test(text) &&
    /\b(?:continue|continues|continued|continuing|work|works|working|prevent|prevents|prevented|preventing|block|blocks|blocked|blocking)\b/
      .test(text);

  const selectedStateClaim =
    isBrowserSelectedStateClaim(
      text
    );

  return (
    linkNavigationClaim ||
    recordOrderingClaim ||
    optionalEmptyStateFlowClaim ||
    selectedStateClaim
  );
}

function isBrowserSelectedStateClaim(
  value: unknown
): boolean {
  const text =
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  if (!text) {
    return false;
  }

  return (
    /\b(?:select|selects|selected|selecting|choose|chooses|chosen|choosing)\b.{0,120}\b(?:value|state|option|item|type|tab|filter|chip|radio|dropdown|combobox)\b/
      .test(text) ||
    /\b(?:value|state|option|item|type|tab|filter|chip|radio|dropdown|combobox)\b.{0,120}\b(?:select|selects|selected|selecting|choose|chooses|chosen|choosing)\b/
      .test(text)
  );
}

function getBrowserBehaviorClaims(
  requirementScope: string[]
): string[] {
  const directClaims =
    requirementScope.filter(
      (claim) =>
        isBrowserBehaviorClaim(claim)
    );

  if (directClaims.length > 0) {
    return directClaims;
  }

  /*
   * PLANNER_COMPOSITIONAL_BEHAVIOR_CLAIM_V1
   *
   * A single canonical acceptance requirement may
   * distribute one behavior across adjacent sentences.
   *
   * Example:
   *   "Jobs ... sorting choices."
   *   "Selecting newest uses ... descending behavior."
   *
   * Preserve exact sentence-level claims when available.
   * Only when none classify independently, evaluate the
   * complete declared requirement scope as one claim.
   */
  const combinedClaim =
    requirementScope
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  return (
    combinedClaim &&
    isBrowserBehaviorClaim(
      combinedClaim
    )
  )
    ? [combinedClaim]
    : [];
}

function deriveOrderingDirection(
  text: string
): "ASC" | "DESC" | null {
  const hasAscending =
    /\b(?:ascending|asc|oldest first|earliest first|smallest first)\b/.test(
      text
    );
  const hasDescending =
    (
      /\b(?:descending|desc|newest first|latest first|most recent first|largest first)\b/.test(
        text
      ) ||
      /\bnewer\b.{0,80}\bbefore\b.{0,80}\bolder\b/.test(
        text
      )
    );

  if (hasAscending === hasDescending) {
    return null;
  }

  return hasAscending ? "ASC" : "DESC";
}

function deriveOrderingField(
  text: string
): string | undefined {
  const explicitField = text.match(
    /\b(createdAt|updatedAt|completedAt|submittedAt|startedAt)\b/i
  )?.[1];

  if (explicitField) {
    const canonical = new Map([
      ["createdat", "createdAt"],
      ["updatedat", "updatedAt"],
      ["completedat", "completedAt"],
      ["submittedat", "submittedAt"],
      ["startedat", "startedAt"],
    ]).get(explicitField.toLowerCase());
    return canonical;
  }

  const mappings: Array<[RegExp, string]> = [
    [/\b(?:creation|created)[ -](?:time|date)\b/, "createdAt"],
    [/\b(?:update|updated|modification|modified)[ -](?:time|date)\b/, "updatedAt"],
    [/\b(?:completion|completed)[ -](?:time|date)\b/, "completedAt"],
    [/\b(?:submission|submitted)[ -](?:time|date)\b/, "submittedAt"],
    [/\b(?:start|started)[ -](?:time|date)\b/, "startedAt"],
    [/\bscore\b/, "score"],
    [/\bamount\b/, "amount"],
    [/\bcount\b/, "count"],
    [/\bname\b/, "name"],
    [/\btitle\b/, "title"],
  ];

  return mappings.find(([pattern]) =>
    pattern.test(text)
  )?.[1];
}

function deriveOrderingComparisonType(
  text: string
): BrowserOrderingRequirement["comparisonType"] | null {
  const dateTime =
    /\b(?:newest|latest|newer|oldest|older|earliest|recent|date|time|createdAt|updatedAt|completedAt|submittedAt|startedAt)\b/i.test(
      text
    );
  const numeric =
    /\b(?:numeric|number|score|amount|count|smallest|largest)\b/.test(
      text
    );
  const lexical =
    /\b(?:lexical|alphabetical|alphabetically|name|title)\b/.test(
      text
    );
  const matches = [dateTime, numeric, lexical]
    .filter(Boolean).length;

  if (matches !== 1) {
    return null;
  }

  return dateTime
    ? "DATE_TIME"
    : numeric
      ? "NUMERIC"
      : "LEXICAL";
}

function semanticDimensionForComparisonType(
  comparisonType: BrowserOrderingRequirement["comparisonType"]
): NonNullable<BrowserOrderingRequirement["semanticDimension"]> {
  switch (comparisonType) {
    case "DATE_TIME":
      return "RECENCY";
    case "NUMERIC":
      return "NUMERIC_MAGNITUDE";
    case "LEXICAL":
      return "LEXICAL_ORDER";
  }
}

function normalizeAuthorityText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function containsExactIdentifier(
  text: string,
  identifier: string
): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)) {
    return false;
  }

  const escaped = identifier.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  return new RegExp(
    `(?:^|[^A-Za-z0-9_$])${escaped}(?=$|[^A-Za-z0-9_$])`
  ).test(text);
}

export type BrowserOrderingAuthorityContext = {
  acceptanceSourceLedger?: PlannerAcceptanceSourceLedger;
  acceptanceObligationLedger?: PlannerAcceptanceObligationLedger;
};

function authoritativeBindingSource(args: {
  sourceClaim: string;
  proposedField: string;
  authorityContext?: BrowserOrderingAuthorityContext;
}): string | undefined {
  const sourceLedger =
    args.authorityContext?.acceptanceSourceLedger;
  const obligationLedger =
    args.authorityContext?.acceptanceObligationLedger;

  if (
    sourceLedger?.sourceStatus !== "RESOLVED" ||
    obligationLedger?.sourceStatus !== "RESOLVED"
  ) {
    return undefined;
  }

  const normalizedClaim = normalizeAuthorityText(
    args.sourceClaim
  );
  const eligibleSourceUnitIds = new Set(
    obligationLedger.obligations
      .filter(
        (obligation) =>
          normalizeAuthorityText(obligation.text) ===
            normalizedClaim &&
          containsExactIdentifier(
            obligation.text,
            args.proposedField
          )
      )
      .flatMap((obligation) => obligation.sourceUnitIds)
  );

  const sourceUnit = sourceLedger.sourceUnits.find(
    (unit) =>
      eligibleSourceUnitIds.has(unit.id) &&
      containsExactIdentifier(
        unit.text,
        args.proposedField
      )
  );

  return sourceUnit
    ? `${sourceUnit.sourceRef}#${sourceUnit.id}`.slice(0, 240)
    : undefined;
}

export function buildOrderingProofFieldBinding(args: {
  requirementId: string;
  semanticDimension: NonNullable<BrowserOrderingRequirement["semanticDimension"]>;
  proposedField: string;
  sourceClaim: string;
  authorityContext?: BrowserOrderingAuthorityContext;
  proposalSource?: BrowserOrderingProofFieldBinding["proposalSource"];
  sourceRef?: string;
}): BrowserOrderingProofFieldBinding {
  const authoritativeSourceRef = authoritativeBindingSource({
    sourceClaim: args.sourceClaim,
    proposedField: args.proposedField,
    ...(args.authorityContext
      ? { authorityContext: args.authorityContext }
      : {}),
  });
  const proposalSource = authoritativeSourceRef
    ? "AC_EXPLICIT"
    : args.proposalSource ?? "PLANNER_HEURISTIC";
  const authority = authoritativeSourceRef
    ? "AUTHORITATIVE"
    : "CANDIDATE";
  const bindingId = `ordering-binding-${createHash("sha256")
    .update(
      [
        args.requirementId,
        args.semanticDimension,
        args.proposedField,
        proposalSource,
      ].join("\u0000")
    )
    .digest("hex")
    .slice(0, 12)}`;

  return {
    bindingId,
    requirementId: args.requirementId,
    semanticDimension: args.semanticDimension,
    proposedField: args.proposedField,
    proposalSource,
    authority,
    ...((authoritativeSourceRef || args.sourceRef)
      ? {
          sourceRef: (
            authoritativeSourceRef || args.sourceRef!
          ).slice(0, 240),
        }
      : {}),
  };
}

function deriveCollectionHint(
  text: string
): string | undefined {
  const match = text.match(
    /\b(jobs|assessments|records|rows|items)\b/
  );
  return match?.[1];
}

function orderingClaimSegments(
  claim: string
): string[] {
  const normalized = claim
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const selectingStarts = Array.from(
    normalized.matchAll(
      /\b(?:selecting\s+)?(?:newest|latest|oldest)\b(?=\s+(?:uses|based))/g
    )
  );

  if (selectingStarts.length === 0) {
    return [normalized];
  }

  return selectingStarts.map(
    (match, index) =>
      normalized.slice(
        match.index,
        selectingStarts[index + 1]
          ?.index ?? normalized.length
      )
  );
}

export function buildOrderingRequirements(
  requirementScope: string[],
  caseId = "browser-case",
  authorityContext?: BrowserOrderingAuthorityContext
): BrowserOrderingRequirement[] {
  const candidates: Array<
    Omit<BrowserOrderingRequirement, "requirementId">
  > = [];

  for (const sourceClaim of requirementScope) {
    for (const segment of
      orderingClaimSegments(sourceClaim)) {
      const hasResultingOrder =
        (
          /\b(?:newest first|latest first|most recent first|oldest first|earliest first|smallest first|largest first|ascending|descending)\b/.test(
            segment
          ) ||
          /\bnewer\b.{0,80}\bbefore\b.{0,80}\bolder\b/.test(
            segment
          )
        );

      if (!hasResultingOrder) {
        continue;
      }

      const direction =
        deriveOrderingDirection(segment);
      const comparisonType =
        deriveOrderingComparisonType(segment);

      if (!direction || !comparisonType) {
        continue;
      }

      const selectionHint = segment.match(
        /\b(?:selecting\s+)?(newest|latest|oldest)\b(?=\s+(?:uses|based))/
      )?.[1];

      const collectionHint =
        deriveCollectionHint(segment) ||
        deriveCollectionHint(
          sourceClaim.toLowerCase()
        );
      const fieldHint =
        deriveOrderingField(segment);
      const semanticDimension =
        semanticDimensionForComparisonType(
          comparisonType
        );

      candidates.push({
        kind: "ORDERING",
        sourceClaim,
        semanticDimension,
        direction,
        comparisonType,
        ...(collectionHint
          ? { collectionHint }
          : {}),
        ...(fieldHint
          ? { fieldHint }
          : {}),
        ...(selectionHint
          ? {
              selectionHint:
                selectionHint.charAt(0).toUpperCase() +
                selectionHint.slice(1),
            }
          : {}),
      });
    }
  }

  const unique: Array<
    Omit<BrowserOrderingRequirement, "requirementId">
  > = [];

  for (const candidate of candidates) {
    const existing = unique.find((item) =>
      item.direction === candidate.direction &&
      item.comparisonType ===
        candidate.comparisonType &&
      (
        !item.fieldHint ||
        !candidate.fieldHint ||
        item.fieldHint === candidate.fieldHint
      ) &&
      (
        !item.selectionHint ||
        !candidate.selectionHint ||
        item.selectionHint ===
          candidate.selectionHint
      ) &&
      (
        !item.collectionHint ||
        !candidate.collectionHint ||
        item.collectionHint ===
          candidate.collectionHint
      )
    );

    if (!existing) {
      unique.push({ ...candidate });
      continue;
    }

    if (
      !existing.fieldHint &&
      candidate.fieldHint
    ) {
      existing.fieldHint =
        candidate.fieldHint;
    }

    if (
      !existing.collectionHint &&
      candidate.collectionHint
    ) {
      existing.collectionHint =
        candidate.collectionHint;
    }

    if (
      !existing.selectionHint &&
      candidate.selectionHint
    ) {
      existing.selectionHint =
        candidate.selectionHint;
    }
  }

  return unique.map((requirement, index) => {
    const requirementId =
      `${caseId}-ordering-${index + 1}`;

    return {
      ...requirement,
      requirementId,
      ...(requirement.fieldHint
        ? {
            proofFieldBinding:
              buildOrderingProofFieldBinding({
                requirementId,
                semanticDimension:
                  requirement.semanticDimension!,
                proposedField:
                  requirement.fieldHint,
                sourceClaim:
                  requirement.sourceClaim,
                ...(authorityContext
                  ? { authorityContext }
                  : {}),
              }),
          }
        : {}),
    };
  });
}

function buildUrlTransitionRequirements(
  behaviorClaims: string[],
  steps: any[]
) {
  const navigationClaims =
    behaviorClaims.filter(
      (claim) =>
        isBrowserLinkNavigationClaim(
          claim
        )
    );

  const interactionSteps =
    steps.filter(
      (step: any) =>
        (
          step?.action ===
            "clickButton" ||
          step?.action ===
            "clickText"
        ) &&
        String(
          step?.interactionId || ""
        ).trim()
    );

  const positiveUrlAssertions =
    steps.filter(
      (step: any) =>
        step?.action ===
          "assertUrlContains" &&
        String(
          step?.oracleId || ""
        ).trim()
    );

  if (
    navigationClaims.length !== 1 ||
    interactionSteps.length !== 1 ||
    positiveUrlAssertions.length !== 1
  ) {
    return [];
  }

  return [
    {
      kind:
        "URL_TRANSITION" as const,
      sourceClaim:
        navigationClaims[0]!,
      interactionId:
        String(
          interactionSteps[0]
            .interactionId
        ).trim(),
      urlAssertionOracleId:
        String(
          positiveUrlAssertions[0]
            .oracleId
        ).trim(),
    },
  ];
}

export function buildSelectedStateRequirements(
  behaviorClaims: string[],
  steps: any[]
): SelectedStateRequirement[] {
  const selectedStateClaims =
    behaviorClaims.filter(
      (claim) =>
        isBrowserSelectedStateClaim(
          claim
        )
    );

  const visibleStateSelections =
    steps.filter(
      (step: any) =>
        step?.action ===
          "selectRuntimeFilterOption" &&
        step?.verification ===
          "visible-state" &&
        String(
          step?.interactionId || ""
        ).trim() &&
        String(
          step?.oracleId || ""
        ).trim()
    );

  if (
    selectedStateClaims.length !== 1 ||
    visibleStateSelections.length !== 1
  ) {
    return [];
  }

  return [
    {
      kind: "SELECTED_STATE",
      sourceClaim:
        selectedStateClaims[0]!,
      interactionId:
        String(
          visibleStateSelections[0]
            .interactionId
        ).trim(),
      selectionOracleId:
        String(
          visibleStateSelections[0]
            .oracleId
        ).trim(),
    },
  ];
}

function splitPlannerCriteria(
  value: unknown
): string[] {
  const text =
    Array.isArray(value)
      ? value.join("\n")
      : String(value ?? "");

  return text
    .split(
      /(?:\r?\n)+|(?<=[.!?])\s+/
    )
    .map((item) =>
      item.replace(/\s+/g, " ").trim()
    )
    .filter(Boolean);
}

function buildAutomatedCheckFromStep(
  step: any
): string | null {
  const action = String(
    step?.action || ""
  );

  const text = String(
    step?.text ||
      step?.target ||
      ""
  ).trim();

  if (
    action === "assertTextVisible" &&
    text
  ) {
    return `Verify "${text}" is visible.`;
  }

  if (
    action === "assertTextNotVisible" &&
    text
  ) {
    return `Verify "${text}" is not visible.`;
  }

  if (
    action === "assertUrlContains" &&
    text
  ) {
    return `Verify the URL contains "${text}".`;
  }

  if (
    action === "assertUrlNotContains" &&
    text
  ) {
    return `Verify the URL does not contain "${text}".`;
  }

  if (
    action === "openRuntimeControl" &&
    text
  ) {
    return `Verify the runtime control "${text}" opens.`;
  }

  if (
    action ===
      "selectRuntimeFilterOption" &&
    step?.verification ===
      "visible-state"
  ) {
    const filterLabel =
      String(
        step?.hint ||
          step?.filterKey ||
          ""
      ).trim();

    if (filterLabel) {
      return (
        `Verify runtime filter ` +
        `"${filterLabel}" selects one safe ` +
        `option and visibly reflects its ` +
        `selected state.`
      );
    }
  }

  if (
    action ===
    "createDraftJobAndVerifyRedirect"
  ) {
    return (
      "Verify the QA-owned draft job is created, " +
      "redirected to its concrete details route, " +
      "and cleaned up exactly."
    );
  }

  return null;
}

/*
 * PLANNER_URL_SYNC_STEP_NORMALIZER_V1
 *
 * Canonicalize the safe browser flow that verifies one
 * runtime tab and one runtime filter through URL query keys.
 *
 * This prevents harmless LLM variation such as reloading
 * once per query key versus reloading once after both
 * interactions from creating structural planner drift.
 *
 * Cases containing any additional action are left unchanged.
 */
export function normalizePlannerUrlSynchronizationSteps(
  plan: any
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const allowedActions =
    new Set([
      "selectRuntimeTopTab",
      "assertUrlContains",
      "openMenu",
      "selectRuntimeFilterOption",
      "reload",
    ]);

  let normalizedCases = 0;

  for (const browserCase of browserCases) {
    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

    if (
      steps.length === 0 ||
      steps.some(
        (step: any) =>
          !allowedActions.has(
            String(step?.action || "")
          )
      )
    ) {
      continue;
    }

    const tabSteps =
      steps.filter(
        (step: any) =>
          step?.action ===
          "selectRuntimeTopTab"
      );

    const menuSteps =
      steps.filter(
        (step: any) =>
          step?.action === "openMenu"
      );

    const filterSteps =
      steps.filter(
        (step: any) =>
          step?.action ===
          "selectRuntimeFilterOption"
      );

    const reloadSteps =
      steps.filter(
        (step: any) =>
          step?.action === "reload"
      );

    if (
      tabSteps.length !== 1 ||
      menuSteps.length !== 1 ||
      filterSteps.length !== 1 ||
      reloadSteps.length < 1
    ) {
      continue;
    }

    const filterStep =
      filterSteps[0];

    const queryKey =
      String(
        filterStep?.queryKey || ""
      ).trim();

    if (!queryKey) {
      continue;
    }

    const expectedFilterAssertion =
      `${queryKey}=`;

    const urlAssertions =
      steps.filter(
        (step: any) =>
          step?.action ===
          "assertUrlContains"
      );

    const hasTabAssertion =
      urlAssertions.some(
        (step: any) =>
          String(step?.text || "")
            .trim() === "tab="
      );

    const hasFilterAssertion =
      urlAssertions.some(
        (step: any) =>
          String(step?.text || "")
            .trim() ===
          expectedFilterAssertion
      );

    const containsOnlyCanonicalAssertions =
      urlAssertions.every(
        (step: any) => {
          const expected =
            String(step?.text || "")
              .trim();

          return (
            expected === "tab=" ||
            expected ===
              expectedFilterAssertion
          );
        }
      );

    if (
      !hasTabAssertion ||
      !hasFilterAssertion ||
      !containsOnlyCanonicalAssertions
    ) {
      continue;
    }

    browserCase.steps = [
      {
        ...tabSteps[0],
      },
      {
        action: "assertUrlContains",
        text: "tab=",
      },
      {
        ...menuSteps[0],
      },
      {
        ...filterStep,
        queryKey,
      },
      {
        action: "assertUrlContains",
        text: expectedFilterAssertion,
      },
      {
        action: "reload",
      },
      {
        action: "assertUrlContains",
        text: "tab=",
      },
      {
        action: "assertUrlContains",
        text: expectedFilterAssertion,
      },
    ];

    normalizedCases += 1;
  }

  if (normalizedCases > 0) {
    console.log(
      ` Planner URL synchronization normalization: ` +
        `${normalizedCases} browser case(s) normalized.`
    );
  }

  return plan;
}

/*
 * PLANNER_VERDICT_SCOPE_NORMALIZER_V1
 *
 * Keep automatically verifiable behavior separate from
 * manual coverage and runtime fixture prerequisites.
 */
export function normalizePlannerBrowserScopes(
  plan: any,
  authorityContext?: BrowserOrderingAuthorityContext
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

const manualPattern =
  /\b(?:manual_required|manual required|manual|manually|human|checked separately|verify separately|external verification|unsupported interaction|unavailable deterministic oracle)\b/i;

  const fixturePattern =
    /\b(?:fixture|prerequisite|test data|runtime data|lifecycle state|ownership|permission combination|exact permission|route (?:is )?not supplied|record (?:is )?(?:unavailable|missing))\b/i;

  for (const browserCase of browserCases) {
    const criteria =
      splitPlannerCriteria(
        browserCase?.successCriteria
      );

    const plannerAutomatedChecks =
  normalizePlannerScopeList(
    browserCase?.automatedChecks
  );

    const manualChecks =
      normalizePlannerScopeList(
        browserCase?.manualChecks
      );

    const fixtureRequirements =
      normalizePlannerScopeList(
        browserCase?.fixtureRequirements
      );

    const retainedCriteria: string[] = [];

    for (const criterion of criteria) {
      const isManual =
        manualPattern.test(criterion);

      const isFixture =
        fixturePattern.test(criterion);

      if (isManual) {
        manualChecks.push(criterion);
      }

      if (isFixture) {
        fixtureRequirements.push(
          criterion
        );
      }

      if (!isManual && !isFixture) {
        retainedCriteria.push(
          criterion
        );
      }
    }

    /*
     * Acceptance requirements own claim existence;
     * automated/manual allocation only describes how
     * those claims may be verified.
     *
     * Capture the original success criteria before
     * manual markers are moved and before executable
     * steps replace planner-authored automated checks.
     * Fixture-only criteria are prerequisites rather
     * than product behavior. The automated fallback is
     * retained only for malformed legacy cases that do
     * not declare success criteria.
     */
    const declaredRequirementScope =
      criteria.filter(
        (criterion) =>
          !fixturePattern.test(criterion)
      );

    const behaviorClaimSource =
      declaredRequirementScope.length > 0
        ? declaredRequirementScope
        : plannerAutomatedChecks;

    const behaviorClaims =
      getBrowserBehaviorClaims(
        behaviorClaimSource
      );

    const caseId =
      String(
        browserCase?.id ||
          "browser-case"
      ).trim() || "browser-case";

    const orderingRequirements =
      buildOrderingRequirements(
        [
          ...behaviorClaimSource,
          ...manualChecks,
        ],
        caseId,
        authorityContext
      );

    browserCase.acceptanceScope = {
      ...retainStructuredAcceptanceScope(
        browserCase.acceptanceScope
      ),
      requiresBehaviorProof:
        behaviorClaims.length > 0 ||
        orderingRequirements.length > 0,
      behaviorClaims,
      ...(orderingRequirements.length > 0
        ? { orderingRequirements }
        : {}),
    };

    const rawSteps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

    /*
     * BROWSER_ASSERTION_ORACLE_ID_V1
     *
     * Runtime step indices are not stable because later browser
     * preparation can insert, reorder, or expand steps.
     *
     * Assign stable identities to canonical deterministic
     * assertions at this normalized planner boundary.
     *
     * Existing IDs are always preserved.
     */
    const assertionActions = new Set([
      "assertUrlContains",
      "assertUrlNotContains",
      "assertTextVisible",
      "assertTextNotVisible",
    ]);

    const usedOracleIds =
  new Set<string>(
    rawSteps
      .map((step: any) =>
        String(
          step?.oracleId || ""
        ).trim()
      )
      .filter(Boolean)
  );

const usedInteractionIds =
  new Set<string>(
    rawSteps
      .map((step: any) =>
        String(
          step?.interactionId || ""
        ).trim()
      )
      .filter(Boolean)
  );

const interactionActions =
  new Set([
    "clickButton",
    "clickText",
  ]);

let nextOracleOrdinal = 1;
let nextInteractionOrdinal = 1;

const steps = rawSteps.map(
  (step: any) => {
    const action =
      String(step?.action || "");

    if (
      interactionActions.has(action)
    ) {
      const existingInteractionId =
        String(
          step?.interactionId || ""
        ).trim();

      if (existingInteractionId) {
        return step;
      }

      let interactionId =
        `${caseId}:interaction-${nextInteractionOrdinal}`;

      while (
        usedInteractionIds.has(
          interactionId
        )
      ) {
        nextInteractionOrdinal += 1;

        interactionId =
          `${caseId}:interaction-${nextInteractionOrdinal}`;
      }

      usedInteractionIds.add(
        interactionId
      );
      nextInteractionOrdinal += 1;

      return {
        ...step,
        interactionId,
      };
    }

    if (
      !assertionActions.has(action)
    ) {
      return step;
    }

    const existingOracleId =
      String(
        step?.oracleId || ""
      ).trim();

    if (existingOracleId) {
      return step;
    }

    let oracleId =
      `${caseId}:assertion-${nextOracleOrdinal}`;

    while (
      usedOracleIds.has(oracleId)
    ) {
      nextOracleOrdinal += 1;

      oracleId =
        `${caseId}:assertion-${nextOracleOrdinal}`;
    }

    usedOracleIds.add(oracleId);
    nextOracleOrdinal += 1;

    return {
      ...step,
      oracleId,
    };
  }
);

/*
 * Preserve the established click/assertion numbering
 * above. Visible-state runtime selections receive IDs
 * only after those existing allocations are complete,
 * so introducing this oracle family cannot renumber a
 * canonical click or assertion.
 */
const stepsWithAssertionCriticality =
  steps.map((step: any, index: number) => {
    const previousStep =
      index > 0
        ? steps[index - 1]
        : undefined;

    const assertionText =
      normalizeSourceGroundedVisibleText(
        step?.text
      ).toLowerCase();
    const menuText =
      normalizeSourceGroundedVisibleText(
        previousStep?.text
      ).toLowerCase();

    /*
     * A same-target label observation immediately after
     * openMenu is supporting evidence. The menu action
     * already requires a deterministic expanded-surface
     * signal, while an icon-only control may legitimately
     * have no visible copy matching its semantic target.
     * Preserve the assertion and its evidence, but do not
     * give that redundant label observation FAIL veto power.
     */
    if (
      step?.action ===
        "assertTextVisible" &&
      step?.acceptanceCritical ===
        undefined &&
      previousStep?.action ===
        "openMenu" &&
      assertionText &&
      assertionText === menuText
    ) {
      return {
        ...step,
        acceptanceCritical: false,
      };
    }

    return step;
  });

const stepsWithSelectedStateIds =
  stepsWithAssertionCriticality.map((step: any) => {
    if (
      step?.action !==
        "selectRuntimeFilterOption" ||
      step?.verification !==
        "visible-state"
    ) {
      return step;
    }

    let interactionId =
      String(
        step?.interactionId || ""
      ).trim();

    if (!interactionId) {
      interactionId =
        `${caseId}:interaction-${nextInteractionOrdinal}`;

      while (
        usedInteractionIds.has(
          interactionId
        )
      ) {
        nextInteractionOrdinal += 1;
        interactionId =
          `${caseId}:interaction-${nextInteractionOrdinal}`;
      }

      usedInteractionIds.add(
        interactionId
      );
      nextInteractionOrdinal += 1;
    }

    let oracleId =
      String(
        step?.oracleId || ""
      ).trim();

    if (!oracleId) {
      oracleId =
        `${caseId}:assertion-${nextOracleOrdinal}`;

      while (
        usedOracleIds.has(oracleId)
      ) {
        nextOracleOrdinal += 1;
        oracleId =
          `${caseId}:assertion-${nextOracleOrdinal}`;
      }

      usedOracleIds.add(oracleId);
      nextOracleOrdinal += 1;
    }

    return {
      ...step,
      interactionId,
      oracleId,
    };
  });

browserCase.steps =
  stepsWithSelectedStateIds;

const urlTransitionRequirements =
  buildUrlTransitionRequirements(
    behaviorClaims,
    stepsWithSelectedStateIds
  );

if (
  urlTransitionRequirements.length >
  0
) {
  browserCase.acceptanceScope
    .urlTransitionRequirements =
    urlTransitionRequirements;
}

const selectedStateRequirements =
  buildSelectedStateRequirements(
    behaviorClaims,
    stepsWithSelectedStateIds
  );

if (
  selectedStateRequirements.length >
  0
) {
  browserCase.acceptanceScope
    .selectedStateRequirements =
    selectedStateRequirements;
}

const derivedAutomatedChecks =
  normalizePlannerScopeList(
    stepsWithSelectedStateIds
      .map((step: any) =>
        buildAutomatedCheckFromStep(step)
      )
      .filter(Boolean)
  );

const automatedChecks =
  derivedAutomatedChecks.length > 0
    ? derivedAutomatedChecks
    : plannerAutomatedChecks.length > 0
      ? plannerAutomatedChecks
      : retainedCriteria;

    browserCase.automatedChecks =
      normalizePlannerScopeList(
        automatedChecks
      );

    browserCase.manualChecks =
      normalizePlannerScopeList(
        manualChecks
      );

    browserCase.fixtureRequirements =
      normalizePlannerScopeList(
        fixtureRequirements
      );

    if (retainedCriteria.length > 0) {
      browserCase.successCriteria =
        retainedCriteria.join(" ");
    } else if (
      browserCase.automatedChecks.length > 0
    ) {
      browserCase.successCriteria =
        browserCase.automatedChecks.join(
          " "
        );
    } else {
      browserCase.successCriteria =
        String(
          browserCase?.goal ||
            "Verify the scoped product behavior."
        ).trim();
    }
  }

  return plan;
}

/*
 * MULTIWORD_UI_ASSERTION_PROVENANCE_GATE_V1
 *
 * Positive multi-word visible-text assertions are executable
 * only when the exact case-sensitive UI text occurs verbatim
 * in Jira/change-context/GitHub input.
 *
 * Semantic prose such as "document requirement" must not be
 * transformed into an invented title-cased UI oracle such as
 * "Document Requirement".
 */
export function applyBrowserTextAssertionProvenanceGate(
  plan: any,
  sourceContext: string
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const groundedSourceContext =
    String(sourceContext || "");

  const jiraSourceContext =
    groundedSourceContext.split(
      "--- GITHUB CHANGE CONTEXT ---"
    )[0] ?? "";

  const jiraGroundsStructuralEntities =
    isStructuralEntityRequirement(
      jiraSourceContext
    ) &&
    /\b(?:ui|client|display|show|shows|shown|field|fields|form|profile)\b/i.test(
      jiraSourceContext
    );

  let blockedCases = 0;

  for (const browserCase of browserCases) {
    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
      : [];

    /*
     * SOURCE_GROUNDED_ENUM_TEXT_CRITICALITY_V1
     *
     * Lowercase hyphen/underscore tokens commonly come
     * from API enums or implementation constants. GitHub
     * can explain such a token, but it cannot make that
     * exact internal spelling an acceptance-critical UI
     * label when Jira never requires the literal text.
     * Keep the observation and evidence, but remove its
     * deterministic FAIL veto unless Jira grounds it.
     */
    for (const step of steps) {
      if (
        step?.action !==
          "assertTextVisible" ||
        step?.acceptanceCritical !==
          undefined
      ) {
        continue;
      }

      const expected =
        normalizeSourceGroundedVisibleText(
          step?.text
        );

      if (
        !/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(
          expected
        )
      ) {
        continue;
      }

      const jiraGroundsExactLiteral =
        new RegExp(
          `(^|[^A-Za-z0-9_-])` +
            `${escapeRegularExpression(expected)}` +
            `([^A-Za-z0-9_-]|$)`,
          "i"
        ).test(jiraSourceContext);

      if (!jiraGroundsExactLiteral) {
        step.acceptanceCritical = false;
      }
    }

    /*
     * SOURCE_GROUNDED_NEGATIVE_LABEL_REFINEMENT_V1
     *
     * A Jira-grounded single-word legacy field name can
     * collide with unrelated longer copy (for example a
     * different word sharing the same prefix). When source
     * context supplies the exact compound UI label, use it
     * as the negative assertion target. GitHub may refine
     * the UI label but cannot introduce a Jira-absent term.
     */
    for (const step of steps) {
      if (
        step?.action !==
          "assertTextNotVisible"
      ) {
        continue;
      }

      const expected =
        normalizeSourceGroundedVisibleText(
          step?.text
        );

      if (!/^[A-Za-z][A-Za-z-]*$/.test(expected)) {
        continue;
      }

      const escapedExpected =
        escapeRegularExpression(expected);
      const jiraMentionsExpected =
        new RegExp(
          `\\b${escapedExpected}\\b`,
          "i"
        ).test(jiraSourceContext);
      const exactSourceLabel =
        groundedSourceContext.match(
          new RegExp(
            `\\b${escapedExpected}\\s+` +
              `(?:Level|Field|Control|Label)\\b`,
            "i"
          )
        )?.[0];

      if (
        jiraMentionsExpected &&
        exactSourceLabel
      ) {
        step.text = exactSourceLabel;
      }
    }

    const structuralClaim = [
      browserCase?.goal,
      browserCase?.successCriteria,
    ]
      .map((value) =>
        normalizeSourceGroundedVisibleText(
          value
        )
      )
      .find((value) =>
        isStructuralEntityRequirement(value)
      );

    const hasPositiveVisibleTextAssertion =
      steps.some(
        (step: any) =>
          step?.action ===
            "assertTextVisible"
      );

    /*
     * STRUCTURAL_TEXT_PROOF_SAFETY_GATE_V1
     *
     * Jira may require separate fields or controls while
     * plain text assertions prove only that their words
     * occur somewhere on the page. Preserve that stronger
     * claim as unproven acceptance scope. GitHub context
     * alone cannot activate this gate.
     */
    if (
      jiraGroundsStructuralEntities &&
      structuralClaim &&
      hasPositiveVisibleTextAssertion
    ) {
      const existingBehaviorClaims =
        normalizePlannerScopeList(
          browserCase?.acceptanceScope
            ?.behaviorClaims
        );

      browserCase.acceptanceScope = {
        ...(browserCase.acceptanceScope ?? {}),
        requiresBehaviorProof: true,
        behaviorClaims: [
          ...new Set([
            ...existingBehaviorClaims,
            structuralClaim,
          ]),
        ],
      };
    }

    const unsupportedAssertions =
      steps
        .filter(
          (step: any) =>
            step?.action ===
            "assertTextVisible"
        )
        .map((step: any) =>
          normalizeSourceGroundedVisibleText(
            step?.text
          )
        )
        .filter((expected: string) => {
          const wordCount =
            expected
              .split(/\s+/)
              .filter(Boolean)
              .length;

          return (
            wordCount >= 2 &&
            !hasVerbatimSourceGroundedVisibleText(
              expected,
              groundedSourceContext
            )
          );
        });

    if (unsupportedAssertions.length === 0) {
      delete browserCase
        .runtimeTextAssertionProvenanceFailure;

      continue;
    }

    const uniqueUnsupportedAssertions =
      [...new Set(unsupportedAssertions)];

    const failureReason =
      `Browser text assertion provenance gate blocked ` +
      `${browserCase?.id || "case"}: positive visible-text ` +
      `assertion(s) ${uniqueUnsupportedAssertions
        .map((value) => `"${value}"`)
        .join(", ")} do not occur verbatim with matching ` +
      `case in Jira, change context, or GitHub diff input.`;

    browserCase
      .runtimeTextAssertionProvenanceFailure =
        failureReason;

    blockedCases += 1;

    console.log(` ${failureReason}`);
  }

  console.log(
    ` Browser text assertion provenance gate: ` +
      `${blockedCases} case(s) blocked.`
  );

  return plan;
}

export function applyBrowserUrlAssertionPrerequisiteGate(
  plan: any,
  sourceContext: string
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const groundedSourceContext =
    String(sourceContext || "");

  let blockedCases = 0;

  for (const browserCase of browserCases) {
    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

    const startRoute =
      String(
        browserCase?.startRoute || ""
      );

    const caseText = [
      browserCase?.goal,
      browserCase?.successCriteria,
      JSON.stringify(steps),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    /*
     * BROWSER_URL_INTENT_CLASSIFICATION_V1
     *
     * Resource URLs (signed downloads, storage objects, API
     * responses) are not browser address-bar synchronization.
     * Require query language or explicit navigation/state
     * semantics before demanding a browser URL assertion.
     */
    const hasExplicitBrowserUrlIntent =
      /\b(?:browser|page|address bar|navigation)\s+url\b/
        .test(caseText);
    const hasResourceUrlIntent =
      /\b(?:signed|download|pdf|document|file|storage|artifact|resource|api)\b.{0,50}\burl\b/
        .test(caseText) ||
      /\burl\b.{0,50}\b(?:download|pdf|document|file|storage|artifact|resource)\b/
        .test(caseText);
    const hasGenericUrlStateIntent =
      /\burl\b.{0,40}\b(?:sync|synchroniz|persist|reflect|update|change|contain|include)\w*\b/
        .test(caseText) ||
      /\b(?:sync|synchroniz|persist|reflect|update|change|track)\w*\b.{0,40}\burl\b/
        .test(caseText);
    const hasUrlSynchronizationIntent =
      caseText.includes(
        "query parameter"
      ) ||
      caseText.includes(
        "query key"
      ) ||
      caseText.includes(
        "query string"
      ) ||
      hasExplicitBrowserUrlIntent ||
      (
        hasGenericUrlStateIntent &&
        !hasResourceUrlIntent
      );

    const hasUrlAssertion =
      steps.some(
        (step: any) =>
          step?.action ===
            "assertUrlContains" ||
          step?.action ===
            "assertUrlNotContains"
      );

    let failureReason = "";

    /*
     * A case whose acceptance goal is URL/query
     * synchronization cannot PASS from visual text
     * assertions alone.
     */
    if (
      hasUrlSynchronizationIntent &&
      !hasUrlAssertion
    ) {
      failureReason =
        `Browser URL assertion gate blocked ` +
        `${browserCase?.id || "case"}: ` +
        `the case requires URL/query synchronization ` +
        `but contains no deterministic URL assertion.`;
    }

    if (!failureReason) {
      for (
        let index = 0;
        index < steps.length;
        index += 1
      ) {
        const step = steps[index];

        if (
          step?.action !==
          "assertUrlContains"
        ) {
          continue;
        }

        const expected =
          String(step?.text || "").trim();

        /*
         * EXACT_QUERY_ASSERTION_PROVENANCE_GATE_V1
         *
         * An executable exact query assertion must occur
         * verbatim in Jira/change-context/GitHub input.
         * Prompt examples and planner inference are not
         * sufficient product contracts.
         */
        const queryAssertion =
          /^[A-Za-z][A-Za-z0-9_.-]*=[^\s&#]*$/
            .test(expected);

        if (
          queryAssertion &&
          !hasSourceGroundedQueryAssertion(
            expected,
            groundedSourceContext,
            startRoute
          )
        ) {
          failureReason =
            `Browser URL assertion provenance gate blocked ` +
            `${browserCase?.id || "case"}: query assertion ` +
            `"${expected}" has no source-grounded ` +
            `browser URL contract. API endpoint and network ` +
            `request query parameters are not browser URL ` +
            `evidence.`;

          break;
        }

        const stepsBeforeAssertion =
          steps.slice(0, index);

        const prerequisiteEstablished =
          hasUrlAssertionStatePrerequisite({
            stepsBeforeAssertion,
            expected,
            startRoute,
          });

        if (prerequisiteEstablished) {
          continue;
        }

        const bareQueryKey =
          /^[A-Za-z][A-Za-z0-9_.-]*$/
            .test(expected);

        failureReason =
          `Browser URL assertion gate blocked ` +
          `${browserCase?.id || "case"}: ` +
          `positive URL assertion ` +
          `"${expected || "(empty)"}" ` +
          (
            bareQueryKey
              ? `must use an exact query-key substring ` +
                `including "=" and `
              : ""
          ) +
          `has no matching preceding state-establishing ` +
          `interaction and is not already present in ` +
          `startRoute "${startRoute || "UNKNOWN"}".`;

        break;
      }
    }

    if (failureReason) {
      browserCase
        .runtimeUrlAssertionPrerequisiteFailure =
          failureReason;

      blockedCases += 1;

      console.log(
        ` ${failureReason}`
      );
    } else {
      delete browserCase
        .runtimeUrlAssertionPrerequisiteFailure;
    }
  }

  console.log(
    ` Browser URL assertion prerequisite gate: ` +
      `${blockedCases} case(s) blocked.`
  );

  return plan;
}
