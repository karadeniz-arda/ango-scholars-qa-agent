import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  inferAcceptanceTargetSurfaceRequirement,
  selectAcceptanceCompatibleRoute,
  type AcceptanceRouteCandidate,
} from "./browser-route-target-compatibility.js";
import {
  resolveDeepRouteBinding,
} from "./browser-deep-route-binding.js";

const authoritativeList:
  AcceptanceRouteCandidate = {
    route: "/talent/assessments",
    origin: "UI_ROUTE_MANIFEST",
    authoritative: true,
    areaCompatible: true,
  };

const authoritativePrepare:
  AcceptanceRouteCandidate = {
    route:
      "/talent/assessments/:assessmentId/prepare",
    origin: "UI_ROUTE_MANIFEST",
    authoritative: true,
    areaCompatible: true,
  };

const authoritativeDetail:
  AcceptanceRouteCandidate = {
    route:
      "/company/assessments/:assessmentId",
    origin: "GITHUB_ROUTER_MAPPING",
    authoritative: true,
    areaCompatible: true,
  };

test("1 LIST requirement excludes PREPARE deep route", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment list." },
    [authoritativePrepare, authoritativeList]
  );

  assert.equal(result.status, "SELECTED");
  assert.equal(
    result.selectedRoute,
    "/talent/assessments"
  );
  assert.deepEqual(result.excludedRoutes, [
    "/talent/assessments/:assessmentId/prepare",
  ]);
});

test("2 HISTORY requirement excludes PREPARE", () => {
  const result = selectAcceptanceCompatibleRoute(
    {
      successCriteria:
        "The talent assessment history displays submitted records.",
    },
    [authoritativeList, authoritativePrepare]
  );

  assert.equal(
    result.requirement.kind,
    "COLLECTION"
  );
  assert.equal(
    result.selectedRoute,
    "/talent/assessments"
  );
});

test("3 PREPARE requirement permits an authoritative parameterized route", () => {
  const result = selectAcceptanceCompatibleRoute(
    {
      goal:
        "Prepare a specific assessment for launch.",
    },
    [authoritativeList, authoritativePrepare]
  );

  assert.equal(result.status, "SELECTED");
  assert.equal(
    result.selectedRoute,
    authoritativePrepare.route
  );
});

test("4 DETAIL requirement permits an authoritative deep detail route", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Inspect assessment details." },
    [authoritativeList, authoritativeDetail]
  );

  assert.equal(result.status, "SELECTED");
  assert.equal(
    result.selectedRoute,
    authoritativeDetail.route
  );
});

test("5 runtime identity availability cannot override LIST", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment list." },
    [
      authoritativeList,
      {
        route:
          "/talent/assessments/500/prepare",
        authoritative: false,
        areaCompatible: true,
      },
    ]
  );

  assert.equal(
    result.selectedRoute,
    authoritativeList.route
  );
});

test("6 a concrete valid deep route cannot self-authorize compatibility", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Prepare an assessment." },
    [
      {
        route:
          "/talent/assessments/500/prepare",
        authoritative: false,
      },
    ]
  );

  assert.equal(
    result.status,
    "NO_COMPATIBLE_ROUTE"
  );
});

test("7 planner literal cannot authorize surface kind", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment list." },
    [
      {
        ...authoritativeList,
        origin: "PLANNER_LITERAL",
      },
    ]
  );

  assert.equal(
    result.status,
    "NO_COMPATIBLE_ROUTE"
  );
});

test("8 model proposal cannot authorize surface kind", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment list." },
    [
      {
        ...authoritativeList,
        origin: "MODEL_PROPOSAL",
      },
    ]
  );

  assert.equal(
    result.status,
    "NO_COMPATIBLE_ROUTE"
  );
});

test("9 authoritative static route remains eligible", () => {
  assert.equal(
    selectAcceptanceCompatibleRoute(
      { goal: "Verify the assessment catalog." },
      [authoritativeList]
    ).status,
    "SELECTED"
  );
});

test("10 incompatible candidate is removed before availability ranking", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify assessment pagination." },
    [
      {
        ...authoritativePrepare,
        route:
          "/talent/assessments/500/prepare",
      },
      authoritativeList,
    ]
  );

  assert.equal(
    result.selectedRoute,
    authoritativeList.route
  );
  assert.ok(
    result.excludedRoutes.includes(
      "/talent/assessments/500/prepare"
    )
  );
});

test("11 ambiguous compatible routes abstain", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment history." },
    [
      authoritativeList,
      {
        ...authoritativeList,
        route:
          "/talent/assessment-history",
      },
    ]
  );

  assert.equal(
    result.status,
    "AMBIGUOUS_COMPATIBLE_ROUTES"
  );
  assert.equal(result.selectedRoute, undefined);
});

test("12 candidate order cannot select a first route", () => {
  const candidates = [
    authoritativeList,
    {
      ...authoritativeList,
      route: "/talent/assessment-history",
    },
  ];

  assert.equal(
    selectAcceptanceCompatibleRoute(
      { goal: "Verify the assessment history." },
      candidates
    ).status,
    selectAcceptanceCompatibleRoute(
      { goal: "Verify the assessment history." },
      [...candidates].reverse()
    ).status
  );
});

test("13 target verification remains outside route selection", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment list." },
    [authoritativeList]
  );

  assert.equal(result.status, "SELECTED");
  assert.equal(
    "targetVerified" in result,
    false
  );
});

test("14 route selection cannot create a verdict", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the assessment list." },
    [authoritativeList]
  );

  assert.equal("status" in result, true);
  assert.equal("verdict" in result, false);
  assert.equal("passed" in result, false);
});

test("15 Current-13 list, pagination, and history shapes resolve to COLLECTION", () => {
  for (const testCase of [
    {
      goal:
        "Verify the talent assessment list is ordered newest first.",
    },
    {
      goal:
        "Verify pagination on the talent assessments page.",
    },
    {
      goal:
        "Verify the talent assessment history duration.",
    },
  ]) {
    assert.equal(
      inferAcceptanceTargetSurfaceRequirement(
        testCase
      ).kind,
      "COLLECTION"
    );
  }
});

test("16 production compatibility code contains no issue or workflow-specific branches", () => {
  const source = fs.readFileSync(
    new URL(
      "./browser-route-target-compatibility.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /AS-\d+|Language Requirements|assessmentId\s*===\s*["'`]/
  );
});

test("17 LIST excludes authoritative editor and create surfaces", () => {
  const result = selectAcceptanceCompatibleRoute(
    { goal: "Verify the record list." },
    [
      authoritativeList,
      {
        route: "/talent/assessments/editor",
        origin: "UI_ROUTE_MANIFEST",
        authoritative: true,
      },
      {
        route: "/talent/assessments/create",
        origin: "UI_ROUTE_MANIFEST",
        authoritative: true,
      },
    ]
  );

  assert.equal(
    result.selectedRoute,
    authoritativeList.route
  );
});

test("18 editor and create requirements retain their matching authoritative surfaces", () => {
  const editor = {
    route: "/company/records/:recordId/editor",
    origin:
      "GITHUB_ROUTER_MAPPING" as const,
    authoritative: true,
  };
  const create = {
    route: "/company/records/create",
    origin:
      "GITHUB_ROUTER_MAPPING" as const,
    authoritative: true,
  };

  assert.equal(
    selectAcceptanceCompatibleRoute(
      { goal: "Open the record editor." },
      [editor, create]
    ).selectedRoute,
    editor.route
  );
  assert.equal(
    selectAcceptanceCompatibleRoute(
      { goal: "Create a new record." },
      [editor, create]
    ).selectedRoute,
    create.route
  );
});

test("19 deep-route positive control binds a verified runtime identity after PREPARE compatibility", () => {
  const selection =
    selectAcceptanceCompatibleRoute(
      {
        goal:
          "Prepare a specific assessment for launch.",
      },
      [authoritativePrepare]
    );

  assert.equal(selection.status, "SELECTED");

  const binding = resolveDeepRouteBinding({
    template: {
      template:
        authoritativePrepare.route,
      sourceOrigin:
        "UI_ROUTE_MANIFEST",
      authoritative: true,
      persona: "talent",
      requiredBindings: [
        {
          param: "assessmentId",
          entityKind: "assessment",
        },
      ],
    },
    persona: "talent",
    requirements: [
      {
        param: "assessmentId",
        entityKind: "assessment",
        persona: "talent",
      },
    ],
    candidates: [
      {
        entityKind: "assessment",
        entityId: "500",
        source: "AUTHENTICATED_GET",
        persona: "talent",
        identityVerified: true,
      },
    ],
  });

  assert.equal(binding.status, "RESOLVED");
  assert.equal(
    binding.boundRoute?.route,
    "/talent/assessments/500/prepare"
  );
});
