import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverBrowserRouteCandidates,
  getBestDiscoveredBrowserRoute,
  type RouteCandidate,
} from "./route-candidate-discovery.js";
import {
  findUnambiguousExplicitStaticUiRouteBinding,
  findUniqueStaticUiRouteForArea,
  resolveExplicitStaticUiRouteBinding,
  findRouteCandidatesFromCatalog,
  findRouteCandidatesFromEntries,
  type UiRouteEntry,
} from "./ui-route-catalog.js";
import {
  enrichTestPlanWithDiscovery,
} from "../planner/planner-discovery-enrichment.js";
import {
  recoverStaticSurfaceRoutes,
} from "./static-surface-route-extraction.js";
import type { SourceBackedSurfaceIdentity } from "./source-surface-provenance.js";

function assessmentCase(
  overrides: Record<string, unknown> = {}
): any {
  return {
    id: "web-synthetic",
    persona: "talent",
    goal:
      "Verify the talent assessment list page.",
    startRoute: "UNKNOWN",
    successCriteria:
      "Assessment cards are shown in the expected order.",
    automatedChecks: [],
    manualChecks: [],
    fixtureRequirements: [],
    steps: [],
    ...overrides,
  };
}

function recoveredEntry(
  overrides: Partial<UiRouteEntry> = {}
): UiRouteEntry {
  return {
    path: "/talent/assessments",
    file:
      "src/modules/talent/TalentRoutes.tsx",
    params: [],
    area: "assessments",
    persona: "talent",
    origin: "UI_ROUTE_MANIFEST",
    authoritative: true,
    derivation: "NESTED_COMPOSITION",
    routeKind: "STATIC",
    sourceRef:
      "src/modules/talent/TalentRoutes.tsx:86",
    parentRoute: "/talent",
    parentSourceRef:
      "src/routes/App.routes.tsx:53",
    ...overrides,
  };
}

test("21 recovered static route enters the normal UI route catalog", () => {
  const candidates =
    findRouteCandidatesFromCatalog(
      { summary: "Talent assessments" },
      assessmentCase()
    );

  assert.ok(
    candidates.some(
      (candidate) =>
        candidate.route ===
          "/talent/assessments" &&
        candidate.source ===
          "ui-route-catalog"
    )
  );
});

test("22 persona filtering remains enforced", () => {
  const candidates =
    findRouteCandidatesFromEntries(
      [recoveredEntry()],
      {},
      assessmentCase({
        persona: "company_admin",
      })
    );

  assert.deepEqual(candidates, []);
});

test("23 an existing catalog route remains unaffected", () => {
  const entry: UiRouteEntry = {
    path: "/company/payments",
    file: "src/routes/payments.tsx",
    params: [],
    area: "payments",
    persona: "company_admin",
  };
  const candidates =
    findRouteCandidatesFromEntries(
      [entry],
      {},
      {
        persona: "company_admin",
        goal:
          "Verify the Payments page list.",
        successCriteria: "Invoices appear.",
      }
    );

  assert.equal(
    candidates[0]?.route,
    "/company/payments"
  );
  assert.equal(
    candidates[0]?.origin,
    "UI_ROUTE_CATALOG"
  );
});

test("23a exact surface wording disambiguates existing static manifest routes", () => {
  assert.equal(
    findUnambiguousExplicitStaticUiRouteBinding({
      plan: { summary: "Invoice surfaces" },
      persona: "company_admin",
      surface: "Company Payments table",
    })?.route,
    "/company/payments"
  );
  assert.equal(
    findUnambiguousExplicitStaticUiRouteBinding({
      plan: { summary: "Invoice surfaces" },
      persona: "company_admin",
      surface: "Company All payments table",
    })?.route,
    "/company/all-payments"
  );
});

test("23b weak, conflicting, and persona-incompatible surfaces fail closed", () => {
  for (const input of [
    { persona: "company_admin" as const, surface: "Payments" },
    { persona: "company_admin" as const, surface: "Payments table and All payments table" },
    { persona: "talent" as const, surface: "Company Payments table" },
  ]) {
    assert.equal(
      findUnambiguousExplicitStaticUiRouteBinding({
        plan: { summary: "Invoice surfaces" },
        ...input,
      }),
      undefined
    );
  }
});

test("23c exact static surface resolution distinguishes absence from ambiguity", () => {
  assert.deepEqual(
    resolveExplicitStaticUiRouteBinding({
      plan: { summary: "Invoice surfaces" },
      persona: "company_admin",
      surface: "Payments",
    }),
    { kind: "NO_BINDING" }
  );

  assert.deepEqual(
    resolveExplicitStaticUiRouteBinding({
      plan: { summary: "Invoice surfaces" },
      persona: "company_admin",
      surface: "Payments table and All payments table",
    }),
    {
      kind: "AMBIGUOUS_BINDING",
      routes: ["/company/all-payments", "/company/payments"],
    }
  );

  const unique = resolveExplicitStaticUiRouteBinding({
    plan: { summary: "Invoice surfaces" },
    persona: "company_admin",
    surface: "Company Payments table",
  });
  assert.equal(unique.kind, "UNIQUE_EXACT_BINDING");
  if (unique.kind === "UNIQUE_EXACT_BINDING") {
    assert.equal(unique.binding.route, "/company/payments");
  }
});

test("24 duplicate catalog and planner candidates deduplicate deterministically", () => {
  const candidates =
    discoverBrowserRouteCandidates(
      { summary: "Talent assessments" },
      assessmentCase({
        goal:
          "Open /talent/assessments and verify the assessment list page.",
      })
    ).filter(
      (candidate) =>
        candidate.route ===
        "/talent/assessments"
    );

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0]?.source,
    "ui-route-catalog"
  );
});

test("25 competing catalog routes remain separate", () => {
  const candidates =
    findRouteCandidatesFromEntries(
      [
        recoveredEntry(),
        recoveredEntry({
          path:
            "/talent/assessment-history",
          sourceRef:
            "src/modules/talent/HistoryRoutes.tsx:20",
        }),
      ],
      {},
      assessmentCase({
        goal:
          "Verify the assessments page and assessment history page.",
      })
    );

  assert.deepEqual(
    candidates.map(
      (candidate) => candidate.route
    ).sort(),
    [
      "/talent/assessment-history",
      "/talent/assessments",
    ]
  );
});

test("26 an explicitly grounded case selects one recovered static route", () => {
  const selected =
    getBestDiscoveredBrowserRoute(
      { summary: "Talent assessments" },
      assessmentCase()
    );

  assert.equal(
    selected?.route,
    "/talent/assessments"
  );
  assert.equal(
    selected?.origin,
    "UI_ROUTE_MANIFEST"
  );
});

test("27 weak feature similarity cannot make recovered route grounding high", () => {
  const candidate =
    findRouteCandidatesFromEntries(
      [recoveredEntry()],
      {},
      assessmentCase({
        goal:
          "Check assessment-related copy.",
        successCriteria:
          "Assessment terminology is consistent.",
      })
    )[0];

  assert.equal(candidate?.confidence, "medium");
});

test("28 equally grounded structural candidates abstain", () => {
  const testCase = assessmentCase();
  const plan = {
    summary: "Talent assessments",
    apiCases: [],
    browserCases: [testCase],
  };
  const candidates: RouteCandidate[] = [
    {
      route: "/talent/assessments",
      confidence: "high",
      source: "ui-route-catalog",
      origin: "UI_ROUTE_MANIFEST",
      authoritative: true,
      groundingScore: 700,
      reason: "Structural candidate A.",
    },
    {
      route:
        "/talent/assessment-history",
      confidence: "high",
      source: "ui-route-catalog",
      origin: "UI_ROUTE_MANIFEST",
      authoritative: true,
      groundingScore: 700,
      reason: "Structural candidate B.",
    },
  ];

  enrichTestPlanWithDiscovery(plan, {
    discoverBrowserRouteCandidates:
      () => candidates,
  });

  assert.equal(
    testCase.routeResolution?.status,
    "AMBIGUOUS"
  );
  assert.equal(testCase.startRoute, "UNKNOWN");
});

test("29 planner concrete route cannot self-confirm", () => {
  const testCase = assessmentCase({
    goal: "Verify authenticated content.",
    successCriteria:
      "The intended content is present.",
    startRoute: "/talent/assessments",
  });
  const plan = {
    apiCases: [],
    browserCases: [testCase],
  };

  enrichTestPlanWithDiscovery(plan);

  assert.equal(testCase.startRoute, "UNKNOWN");
  assert.equal(
    testCase.routeResolution?.status,
    "UNVERIFIED"
  );
});

test("30 UNKNOWN remains when no authoritative route exists", () => {
  const testCase = assessmentCase({
    goal: "Verify an unnamed surface.",
    successCriteria:
      "The unnamed surface is present.",
  });
  const plan = {
    apiCases: [],
    browserCases: [testCase],
  };

  enrichTestPlanWithDiscovery(plan, {
    discoverBrowserRouteCandidates:
      () => [],
  });

  assert.equal(testCase.startRoute, "UNKNOWN");
  assert.equal(
    testCase.routeResolution?.status,
    "UNRESOLVED"
  );
});

test("31 static route recovery has no verdict field", () => {
  const candidate =
    findRouteCandidatesFromEntries(
      [recoveredEntry()],
      {},
      assessmentCase()
    )[0];

  assert.equal(
    (candidate as { verdict?: string })
      .verdict,
    undefined
  );
});

test("32 navigation metadata cannot satisfy acceptance", () => {
  const candidate =
    findRouteCandidatesFromEntries(
      [recoveredEntry()],
      {},
      assessmentCase()
    )[0];

  assert.equal(
    (
      candidate as {
        deterministicEvidence?: unknown;
      }
    ).deterministicEvidence,
    undefined
  );
});

test("33 screenshot text cannot authorize a route", () => {
  const routes = recoverStaticSurfaceRoutes([
    {
      file: "src/routes/screenshot.tsx",
      source:
        'const screenshotText = "/talent/assessments";',
    },
  ]);

  assert.deepEqual(routes, []);
});

test("34 route candidates contain no mutation policy", () => {
  const candidate =
    findRouteCandidatesFromEntries(
      [recoveredEntry()],
      {},
      assessmentCase()
    )[0];

  assert.equal(
    (candidate as { mutationPolicy?: unknown })
      .mutationPolicy,
    undefined
  );
});

test("35 recovered candidate exposes bounded structural provenance", () => {
  const candidate =
    findRouteCandidatesFromEntries(
      [recoveredEntry()],
      {},
      assessmentCase()
    )[0];

  assert.equal(
    candidate?.derivation,
    "NESTED_COMPOSITION"
  );
  assert.equal(candidate?.parentRoute, "/talent");
  assert.match(
    candidate?.sourceRef ?? "",
    /TalentRoutes\.tsx:86/
  );
});

test("36 a semantic history surface grounds its structural resource route", () => {
  const selected =
    getBestDiscoveredBrowserRoute(
      { summary: "Submission duration" },
      assessmentCase({
        goal:
          "Verify the talent assessment history view.",
        successCriteria:
          "Submitted assessment duration is visible.",
      })
    );

  assert.equal(
    selected?.route,
    "/talent/assessments"
  );
});

function sourceBackedPlan(surface: string, persona: "talent" | "company_admin" = "talent") {
  return {
    summary: "Unrelated summary text",
    acceptanceSourceLedger: {
      sourceUnits: [{ id: "source-1", sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira.ac:1" }],
    },
    acceptanceObligationLedger: {
      obligations: [{ id: "obligation-1", sourceUnitIds: ["source-1"], sourceRole: "ACCEPTANCE", text: "A source-backed requirement" }],
    },
    browserSemanticIr: {
      candidates: [{
        proposedCaseId: "web-source",
        obligationIds: ["obligation-1"],
        sourceUnitIds: ["source-1"],
        proposedTargetSurface: surface,
        proposedPersona: persona,
      }],
    },
  };
}

function sourceIdentity(route: string, persona: "talent" | "company_admin", aliases: string[]): SourceBackedSurfaceIdentity {
  return {
    canonicalSurface: aliases[0]!,
    aliases,
    routeRef: route,
    persona,
    provenance: aliases.map((value, index) => ({
      sourceRef: `src/source-${index + 1}.tsx:1`,
      evidenceKind: index === 0 ? "DOCUMENT_TITLE" : "NAVIGATION_LABEL",
      value,
    })),
    evidenceKind: "DOCUMENT_TITLE",
    authority: "SOURCE_CORROBORATION",
  };
}

test("37 independent source surface provenance resolves lexical-different target", () => {
  const candidates = findRouteCandidatesFromEntries(
    [{
      ...recoveredEntry({ path: "/talent/profile" }),
      surfaceIdentity: sourceIdentity("/talent/profile", "talent", ["Profile", "Skills & Languages"]),
    }],
    sourceBackedPlan("Talent or scholar profile language section"),
    {
      ...assessmentCase({ id: "web-source" }),
      goal: "Verify a source-backed behavior",
    }
  );
  assert.equal(candidates[0]?.confidence, "high");
  assert.equal(candidates[0]?.authoritative, true);
  assert.ok(candidates[0]?.evidence?.includes("SOURCE_SURFACE_PROVENANCE"));
  assert.equal(candidates[0]?.surfaceIdentity?.routeRef, "/talent/profile");
});

test("38 source provenance remains fail-closed for generic, summary-only, and wrong-persona targets", () => {
  const identity = sourceIdentity("/talent/profile", "talent", ["Profile", "Skills & Languages"]);
  const entry = { ...recoveredEntry(), surfaceIdentity: identity };
  const neutralCase = { ...assessmentCase({ id: "web-source", goal: "Verify a source-backed behavior" }), successCriteria: "" };
  assert.deepEqual(
    findRouteCandidatesFromEntries(entry ? [entry] : [], sourceBackedPlan("Profile"), neutralCase),
    []
  );
  const summaryOnly: any = { ...sourceBackedPlan("Talent profile language section") };
  delete summaryOnly.acceptanceSourceLedger;
  assert.equal(
    findRouteCandidatesFromEntries([entry], summaryOnly, neutralCase).length,
    0
  );
  assert.equal(
    findRouteCandidatesFromEntries([entry], sourceBackedPlan("Talent profile language section", "company_admin"), { ...assessmentCase({ id: "web-source", persona: "company_admin" }) }).length,
    0
  );
});

test("39 equally corroborated source surfaces remain ambiguous", () => {
  const plan = sourceBackedPlan("Talent profile language section");
  const testCase = { ...assessmentCase({ id: "web-source" }) };
  const candidates = findRouteCandidatesFromEntries([
    { ...recoveredEntry({ path: "/talent/profile" }), surfaceIdentity: sourceIdentity("/talent/profile", "talent", ["Profile", "Skills & Languages"]) },
    { ...recoveredEntry({ path: "/talent/onboarding" }), surfaceIdentity: sourceIdentity("/talent/onboarding", "talent", ["Profile", "Skills & Languages"]) },
  ], plan, testCase);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.groundingScore, candidates[1]?.groundingScore);
});


test("source corroboration requires existing source units and a unique case candidate", () => {
  const entry = { ...recoveredEntry({ path: "/talent/profile" }),
    surfaceIdentity: sourceIdentity("/talent/profile", "talent", ["Profile", "Skills & Languages"]) };
  const testCase = assessmentCase({ id: "web-source", goal: "Verify source-backed behavior", successCriteria: "" });
  for (const corrupt of [
    (plan: any) => { plan.acceptanceSourceLedger.sourceUnits = []; },
    (plan: any) => { plan.acceptanceSourceLedger.sourceUnits[0].sourceKind = "SUMMARY"; },
    (plan: any) => { plan.browserSemanticIr.candidates.push({ ...plan.browserSemanticIr.candidates[0] }); },
  ]) {
    const plan = sourceBackedPlan("Talent profile language section");
    corrupt(plan);
    assert.equal(findRouteCandidatesFromEntries([entry], plan, testCase)
      .some((candidate) => candidate.evidence?.includes("SOURCE_SURFACE_PROVENANCE")), false);
  }
});

test("surface identity cannot be transferred to a different route or persona", () => {
  const testCase = assessmentCase({ id: "web-source", goal: "Verify source-backed behavior", successCriteria: "" });
  for (const identity of [
    sourceIdentity("/talent/other", "talent", ["Profile", "Skills & Languages"]),
    sourceIdentity("/talent/profile", "company_admin", ["Profile", "Skills & Languages"]),
  ]) {
    const entry = { ...recoveredEntry({ path: "/talent/profile" }), surfaceIdentity: identity };
    assert.equal(findRouteCandidatesFromEntries([entry], sourceBackedPlan("Talent profile language section"), testCase)
      .some((candidate) => candidate.evidence?.includes("SOURCE_SURFACE_PROVENANCE")), false);
  }
});

test("child Work Setups labels cannot corroborate a job wizard onto the management route", () => {
  const entry = {
    ...recoveredEntry({ path: "/company/work-setups", persona: "company_admin" }),
    surfaceIdentity: sourceIdentity("/company/work-setups", "company_admin", ["Work Setups", "work setups"]),
  };
  const testCase = assessmentCase({ id: "web-source", persona: "company_admin", goal: "Verify source-backed behavior", successCriteria: "" });
  for (const surface of ["Job wizard Work Setups step", "Job create or edit wizard Work Setups step"]) {
    const candidates = findRouteCandidatesFromEntries([entry], sourceBackedPlan(surface, "company_admin"), testCase);
    assert.equal(candidates.some((candidate) => candidate.evidence?.includes("SOURCE_SURFACE_PROVENANCE")), false);
  }
  const management = findRouteCandidatesFromEntries([entry], sourceBackedPlan("Work Setups page", "company_admin"), testCase);
  assert.equal(management.some((candidate) => candidate.evidence?.includes("SOURCE_SURFACE_PROVENANCE")), true);
});

test("a unique static manifest area route is available only as a navigation seed", () => {
  assert.deepEqual(
    findUniqueStaticUiRouteForArea({
      persona: "talent",
      area: "contracts",
    }),
    {
      route: "/talent/dashboard?tab=contracts",
      sourceRefs: [
        "src/modules/talent/contracts/routes/TalentContractDetails.route.tsx",
      ],
    }
  );
});

test("ambiguous static manifest areas do not select an arbitrary navigation seed", () => {
  assert.equal(
    findUniqueStaticUiRouteForArea({
      persona: "company_admin",
      area: "work-setups",
    }),
    undefined
  );
});
