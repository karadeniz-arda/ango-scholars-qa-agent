import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBrowserTextAssertionProvenanceGate,
  applyBrowserUrlAssertionPrerequisiteGate,
  applySourceGroundedBrowserFilterCoverage,
  buildSelectedStateRequirements,
  buildOrderingRequirements,
  normalizePlannerBrowserScopes,
} from "./planner-browser-policy.js";

function withoutOrderingContractMetadata<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, nestedValue) =>
      key === "semanticDimension" ||
      key === "proofFieldBinding"
        ? undefined
        : nestedValue
    )
  ) as T;
}

test("newest first creates a DESC date-time ordering requirement", () => {
  assert.deepEqual(
    withoutOrderingContractMetadata(buildOrderingRequirements(
      ["Records are sorted newest first."],
      "web-1"
    )),
    [
      {
        kind: "ORDERING",
        requirementId: "web-1-ordering-1",
        sourceClaim: "Records are sorted newest first.",
        direction: "DESC",
        comparisonType: "DATE_TIME",
        collectionHint: "records",
      },
    ]
  );
});

test("oldest first creates an ASC date-time ordering requirement", () => {
  assert.equal(
    buildOrderingRequirements([
      "Jobs are sorted oldest first.",
    ])[0]?.direction,
    "ASC"
  );
});

test("generic sorting availability does not imply ordering proof", () => {
  assert.deepEqual(
    buildOrderingRequirements([
      "Sorting is available.",
    ]),
    []
  );
});

test("visible sort options do not imply resulting record order", () => {
  assert.deepEqual(
    buildOrderingRequirements([
      "Newest, Latest, and Oldest sorting options are visible.",
    ]),
    []
  );
});

test("ambiguous ascending and descending wording fails safe", () => {
  assert.deepEqual(
    buildOrderingRequirements([
      "Records are ordered ascending or descending.",
    ]),
    []
  );
});

test("structured ordering derivation is deterministic", () => {
  const scope = [
    "Selecting latest uses update-time descending behavior.",
  ];
  assert.deepEqual(
    buildOrderingRequirements(scope, "web-1"),
    buildOrderingRequirements(scope, "web-1")
  );
});

test("newer assessments before older maps to a grounded DESC date requirement", () => {
  assert.deepEqual(
    withoutOrderingContractMetadata(buildOrderingRequirements([
      "The assessment list displays newer assessments before older assessments.",
      "Verify a newer createdAt appears before an older createdAt.",
    ], "as-1398-web-1")),
    [
      {
        kind: "ORDERING",
        requirementId:
          "as-1398-web-1-ordering-1",
        sourceClaim:
          "The assessment list displays newer assessments before older assessments.",
        direction: "DESC",
        comparisonType: "DATE_TIME",
        collectionHint: "assessments",
        fieldHint: "createdAt",
      },
    ]
  );
});

function planWithBrowserCases(
  browserCases: any[]
): any {
  return {
    issueKey: "TEST-1",
    summary: "Synthetic planner policy test",
    notes: "",
    apiCases: [],
    browserCases,
  };
}

function ordinaryUiFilterSource(): string {
  return `
--- JIRA TICKET ---
Summary: UI - Extend the change request list
Description: Also add a filter for filtering change requests based on types.

--- GITHUB CHANGE CONTEXT ---
- modified: src/api/change-requests.query.ts
const path = "/change-requests?type=publish-request";
`;
}

function visibleTypeFilterSource(): string {
  return `
--- JIRA TICKET ---
Summary: UI - Extend the change request list
Description: Also add a filter for filtering change requests based on types.

--- GITHUB CHANGE CONTEXT ---
- modified: src/pages/change-requests/ChangeRequestFilters.tsx
export function ChangeRequestFilters() {
  return <Select aria-label="Type" options={typeOptions} />;
}
`;
}

function browserCaseWithFilterClaim(
  dimension: string,
  steps: any[] = [
    {
      action: "assertTextNotVisible",
      text: "undefined",
    },
  ]
): any {
  return {
    id: "web-1",
    persona: "company_admin",
    goal: `Verify the ${dimension} filter.`,
    startRoute: "/company/items",
    successCriteria: `The ${dimension} filter is available.`,
    automatedChecks: [
      `Verify the ${dimension} filter can select an option.`,
    ],
    manualChecks: [],
    fixtureRequirements: [],
    steps,
  };
}

test(
  "does not create a browser case from direct rendered filter evidence",
  () => {
    const plan = planWithBrowserCases([]);

    applySourceGroundedBrowserFilterCoverage(plan, visibleTypeFilterSource());

    assert.deepEqual(plan.browserCases, []);
  }
);

test(
  "does not synthesize omitted filter coverage from strong frontend evidence",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify change request review details.",
        startRoute: "/company/changes",
        successCriteria: "Review details are visible.",
        runtimeFixturePolicy: "exact",
        automatedChecks: [],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextNotVisible",
            text: "undefined",
          },
        ],
      },
    ]);

    const beforeCase = plan.browserCases[0];
    applySourceGroundedBrowserFilterCoverage(plan, visibleTypeFilterSource());

    assert.equal(plan.browserCases.length, 1);
    assert.equal(plan.browserCases[0], beforeCase);
    assert.equal(
      plan.browserCases[0].steps.some(
        (step: any) => step.action === "selectRuntimeFilterOption"
      ),
      false
    );
  }
);

test(
  "repairs an incomplete existing filter case without duplicating it",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify the type filter.",
        startRoute: "/company/changes",
        successCriteria:
          "The type filter is available.",
        steps: [
          {
            action: "openMenu",
            text: "filter",
          },
          {
            action: "assertTextNotVisible",
            text: "undefined",
          },
        ],
      },
    ]);

    applySourceGroundedBrowserFilterCoverage(
      plan,
      visibleTypeFilterSource()
    );

    assert.equal(plan.browserCases.length, 1);
    assert.equal(
      plan.browserCases[0].steps.filter(
        (step: any) =>
          step.action ===
            "selectRuntimeFilterOption"
      ).length,
      1
    );
  }
);

test(
  "converts ungrounded URL filtering to visible-state only with direct control evidence",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify the type filter.",
        startRoute: "/company/changes",
        successCriteria:
          "The type filter changes the visible list.",
        steps: [
          {
            action: "openMenu",
            text: "filter",
          },
          {
            action:
              "selectRuntimeFilterOption",
            queryKey: "type",
          },
          {
            action: "assertUrlContains",
            text: "type=",
          },
          { action: "reload" },
          {
            action: "assertUrlContains",
            text: "type=",
          },
        ],
      },
    ]);

    applySourceGroundedBrowserFilterCoverage(
      plan,
      visibleTypeFilterSource()
    );

    const steps = plan.browserCases[0].steps;
    const runtimeStep = steps.find(
      (step: any) =>
        step.action ===
          "selectRuntimeFilterOption"
    );

    assert.equal(runtimeStep.filterKey, "type");
    assert.equal(runtimeStep.queryKey, undefined);
    assert.equal(
      steps.some(
        (step: any) =>
          step.action === "reload" ||
          String(step.text || "") === "type="
      ),
      false
    );
  }
);

test(
  "does not create browser filter coverage from API-only evidence",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: API - Add server-side filtering
Description: The API URL endpoint filters responses by type with type=active.

--- GITHUB CHANGE CONTEXT ---
- modified: src/api/change-requests.query.ts
const path = "/change-requests?type=publish-request";
`;
    const plan = planWithBrowserCases([]);

    applySourceGroundedBrowserFilterCoverage(
      plan,
      source
    );

    assert.deepEqual(plan.browserCases, []);
  }
);

test(
  "does not repair an existing Status filter case from API-only query evidence",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: API - Filter records by status
Description: Add a status query field to the backend endpoint.

--- GITHUB CHANGE CONTEXT ---
- modified: src/api/records.query.ts
const path = "/records?status=active";
`;
    const plan = planWithBrowserCases([
      browserCaseWithFilterClaim("Status"),
    ]);

    applySourceGroundedBrowserFilterCoverage(plan, source);

    assert.equal(
      plan.browserCases[0].steps.some(
        (step: any) => step.action === "selectRuntimeFilterOption"
      ),
      false
    );
  }
);

test(
  "does not use a Status control to repair a Language filter case",
  () => {
    const plan = planWithBrowserCases([
      browserCaseWithFilterClaim("Language"),
    ]);

    applySourceGroundedBrowserFilterCoverage(plan, visibleTypeFilterSource().replaceAll("Type", "Status").replaceAll("type", "status"));

    assert.equal(
      plan.browserCases[0].steps.some(
        (step: any) => step.action === "selectRuntimeFilterOption"
      ),
      false
    );
  }
);

test(
  "does not treat a generic Filters trigger as dimension-specific control evidence",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Filter records by status
Description: Add a UI filter based on status.

--- GITHUB CHANGE CONTEXT ---
- modified: src/pages/records/RecordFilters.tsx
export function RecordFilters() {
  return <button aria-label="Filters"><FilterIcon /></button>;
}
`;
    const plan = planWithBrowserCases([
      browserCaseWithFilterClaim("Status"),
    ]);

    applySourceGroundedBrowserFilterCoverage(plan, source);

    assert.equal(
      plan.browserCases[0].steps.some(
        (step: any) => step.action === "selectRuntimeFilterOption"
      ),
      false
    );
  }
);

test(
  "does not synthesize a collateral frontend Language filter case",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Improve the assessment list
Description: Display the assessment list and its empty state.

--- GITHUB CHANGE CONTEXT ---
- modified: src/pages/jobs/JobFilters.tsx
export function JobFilters() {
  return <Select placeholder="Any language" options={languages} />;
}
`;
    const unrelatedCase = {
      ...browserCaseWithFilterClaim("Status"),
      goal: "Verify the assessment empty state.",
      successCriteria: "The assessment empty state is visible.",
      automatedChecks: ["Verify the assessment empty state is visible."],
    };
    const plan = planWithBrowserCases([unrelatedCase]);

    applySourceGroundedBrowserFilterCoverage(plan, source);

    assert.equal(plan.browserCases.length, 1);
    assert.equal(plan.browserCases[0], unrelatedCase);
    assert.equal(
      plan.browserCases[0].steps.some(
        (step: any) => step.action === "selectRuntimeFilterOption"
      ),
      false
    );
  }
);

test(
  "does not turn skillIds query handling into visible-state filter proof",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Load selected skills by ID
Description: Load selected skill data from the supplied IDs without stale values.

--- GITHUB CHANGE CONTEXT ---
- modified: src/pages/skills/useSelectedSkills.tsx
const skillIds = searchParams.get("skillIds");
const request = api.get("/skills", { params: { skillIds } });
`;
    const caseBeforeRepair = {
      ...browserCaseWithFilterClaim("skill IDs"),
      steps: [
        { action: "openMenu", text: "Filters" },
        {
          action: "selectRuntimeFilterOption",
          queryKey: "skillIds",
          hint: "Skill IDs",
        },
      ],
    };
    const plan = planWithBrowserCases([caseBeforeRepair]);

    applySourceGroundedBrowserFilterCoverage(plan, source);

    const runtimeStep = plan.browserCases[0].steps[1];
    assert.equal(runtimeStep.action, "selectRuntimeFilterOption");
    assert.equal(runtimeStep.filterKey, undefined);
    assert.notEqual(runtimeStep.verification, "visible-state");
  }
);

test(
  "preserves URL mode when Jira explicitly grounds the browser query",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Track the project filter
Description: The project filter updates the browser URL query string with project=.

--- GITHUB CHANGE CONTEXT ---
`;
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify the project filter URL behavior.",
        startRoute: "/company/items",
        successCriteria:
          "The project filter updates the browser URL.",
        steps: [
          {
            action: "openMenu",
            text: "filter",
          },
          {
            action:
              "selectRuntimeFilterOption",
            queryKey: "project",
            filterKey: "project",
            verification: "url",
          },
          {
            action: "assertUrlContains",
            text: "project=",
          },
        ],
      },
    ]);

    applySourceGroundedBrowserFilterCoverage(
      plan,
      source
    );

    const runtimeStep =
      plan.browserCases[0].steps.find(
        (step: any) =>
          step.action ===
            "selectRuntimeFilterOption"
      );

    assert.equal(
      runtimeStep.queryKey,
      "project"
    );
    assert.equal(runtimeStep.filterKey, undefined);
    assert.equal(runtimeStep.verification, "url");
  }
);

test(
  "URL provenance gate rejects an API-only query literal",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: API - Filter records
Description: Filter records through the endpoint.

--- GITHUB CHANGE CONTEXT ---
- modified: src/api/records.query.ts
const path = "/records?type=active";
`;
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify URL filtering.",
        startRoute: "/company/records",
        successCriteria: "The URL contains type.",
        steps: [
          {
            action: "openMenu",
            text: "filter",
          },
          {
            action:
              "selectRuntimeFilterOption",
            queryKey: "type",
          },
          {
            action: "assertUrlContains",
            text: "type=",
          },
        ],
      },
    ]);

    applyBrowserUrlAssertionPrerequisiteGate(
      plan,
      source
    );

    assert.match(
      plan.browserCases[0]
        .runtimeUrlAssertionPrerequisiteFailure,
      /no source-grounded browser URL contract/i
    );
  }
);

test(
  "a signed resource URL does not imply browser address-bar synchronization",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-resource-url",
        persona: "talent",
        goal:
          "Download the attached contract PDF through its signed URL.",
        startRoute:
          "/talent/dashboard?tab=contracts",
        successCriteria:
          "The contract data contains a signed PDF URL that allows the file to be downloaded.",
        steps: [
          {
            action:
              "assertTextNotVisible",
            text: "undefined",
          },
        ],
      },
    ]);

    applyBrowserUrlAssertionPrerequisiteGate(
      plan,
      "Signed PDF download URL"
    );

    assert.equal(
      plan.browserCases[0]
        .runtimeUrlAssertionPrerequisiteFailure,
      undefined
    );
  }
);

test(
  "explicit browser URL synchronization still requires a deterministic URL assertion",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-browser-url",
        persona: "company_admin",
        goal:
          "Verify the filter updates the browser URL.",
        startRoute:
          "/company/items",
        successCriteria:
          "The browser URL reflects the selected filter.",
        steps: [],
      },
    ]);

    applyBrowserUrlAssertionPrerequisiteGate(
      plan,
      "The browser URL reflects the selected filter."
    );

    assert.match(
      plan.browserCases[0]
        .runtimeUrlAssertionPrerequisiteFailure,
      /requires URL\/query synchronization/i
    );
  }
);

test(
  "URL provenance gate accepts Jira page query language and frontend search params",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Support Tab and Filter Tracking in Query Parameters
Description: On the page, track the active tab with tab parameter and track the filters in the URL.

--- GITHUB CHANGE CONTEXT ---
- modified: src/pages/items/useItemFilters.tsx
import { useSearchParams } from "react-router-dom";
const project = searchParams.get("project");
`;
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify page query tracking.",
        startRoute: "/company/items",
        successCriteria:
          "The active tab and project filter are tracked.",
        steps: [
          { action: "selectRuntimeTopTab" },
          {
            action: "assertUrlContains",
            text: "tab=",
          },
          {
            action: "openMenu",
            text: "filter",
          },
          {
            action:
              "selectRuntimeFilterOption",
            queryKey: "project",
          },
          {
            action: "assertUrlContains",
            text: "project=",
          },
        ],
      },
    ]);

    applyBrowserUrlAssertionPrerequisiteGate(
      plan,
      source
    );

    assert.equal(
      plan.browserCases[0]
        .runtimeUrlAssertionPrerequisiteFailure,
      undefined
    );
  }
);

test(
  "URL provenance gate scopes frontend query keys to the matching browser surface",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Track payment filters in query parameters
Description: On the Payments and All Payments pages, track filters in the browser URL.

--- GITHUB CHANGE CONTEXT ---
Patch for src/pages/payments/CompanyPayments.route.tsx:
import { useSearchParams } from "react-router-dom";
const projectId = searchParams.get("project");

Patch for src/pages/payments/useCompanyAllPaymentsFilters.tsx:
import { useSearchParams } from "react-router-dom";
const projectId = searchParams.get("projectId");
`;
    const filterCase = (
      id: string,
      startRoute: string,
      queryKey: string
    ) => ({
      id,
      persona: "company_admin",
      goal: "Verify the project filter URL behavior.",
      startRoute,
      successCriteria:
        "The project filter updates the browser URL.",
      steps: [
        {
          action: "openMenu",
          text: "Filters",
        },
        {
          action: "selectRuntimeFilterOption",
          queryKey,
          verification: "url",
        },
        {
          action: "assertUrlContains",
          text: `${queryKey}=`,
        },
      ],
    });
    const plan = planWithBrowserCases([
      filterCase(
        "web-payments",
        "/company/payments",
        "project"
      ),
      filterCase(
        "web-all-payments-wrong",
        "/company/all-payments",
        "project"
      ),
      filterCase(
        "web-all-payments-correct",
        "/company/all-payments",
        "projectId"
      ),
    ]);

    applyBrowserUrlAssertionPrerequisiteGate(
      plan,
      source
    );

    assert.equal(
      plan.browserCases[0]
        .runtimeUrlAssertionPrerequisiteFailure,
      undefined
    );
    assert.match(
      plan.browserCases[1]
        .runtimeUrlAssertionPrerequisiteFailure,
      /no source-grounded browser URL contract/i
    );
    assert.equal(
      plan.browserCases[2]
        .runtimeUrlAssertionPrerequisiteFailure,
      undefined
    );
  }
);

test(
  "URL provenance gate fails safe for competing query keys on one browser surface",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Track item filters in query parameters
Description: Track item filters in the browser URL.

--- GITHUB CHANGE CONTEXT ---
Patch for src/pages/items/useItemFilters.tsx:
import { useSearchParams } from "react-router-dom";
const legacyProject = searchParams.get("project");
const currentProject = searchParams.get("projectId");
`;
    const plan = planWithBrowserCases([
      {
        id: "web-ambiguous",
        persona: "company_admin",
        goal: "Verify the project filter URL behavior.",
        startRoute: "/company/items",
        successCriteria:
          "The project filter updates the browser URL.",
        steps: [
          {
            action: "openMenu",
            text: "Filters",
          },
          {
            action: "selectRuntimeFilterOption",
            queryKey: "project",
            verification: "url",
          },
          {
            action: "assertUrlContains",
            text: "project=",
          },
        ],
      },
    ]);

    applyBrowserUrlAssertionPrerequisiteGate(
      plan,
      source
    );

    assert.match(
      plan.browserCases[0]
        .runtimeUrlAssertionPrerequisiteFailure,
      /no source-grounded browser URL contract/i
    );
  }
);

test(
  "does not invent a semantic filter dimension from vague plural filter wording",
  () => {
    const source = `
--- JIRA TICKET ---
Summary: UI - Track page state in query parameters
Description: Track the active tab with tab parameter and track the rest of the filters in the URL as well.

--- GITHUB CHANGE CONTEXT ---
`;
    const plan = planWithBrowserCases([
      {
        id: "web-1",
        persona: "company_admin",
        goal: "Verify page query tracking.",
        startRoute: "/company/items",
        successCriteria:
          "The active tab is tracked in the URL.",
        steps: [
          { action: "selectRuntimeTopTab" },
          {
            action: "assertUrlContains",
            text: "tab=",
          },
        ],
      },
    ]);

    applySourceGroundedBrowserFilterCoverage(
      plan,
      source
    );

    assert.equal(plan.browserCases.length, 1);
  }
);

test(
  "ordinary visible-text automated scope does not require behavior proof",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-1",
        persona: "company_admin",
        goal:
          "Verify the Skills page displays the Skills heading.",
        startRoute: "/company/skills",
        successCriteria:
          "The Skills heading is visible.",
        automatedChecks: [
          'Verify "Skills" is visible.',
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Skills",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
  requiresBehaviorProof: false,
  behaviorClaims: [],
}
    );
  }
);

test(
  "link navigation claim requires behavior proof when automation only proves visibility",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-2",
        persona: "talent",
        goal:
          "Verify the PDF link opens its target.",
        startRoute: "/talent/profile",
        successCriteria:
          "The document link is clickable and opens its target.",
        automatedChecks: [
          "Verify the document link is visible and opens its target.",
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "View PDF",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
  requiresBehaviorProof: true,
  behaviorClaims: [
    "The document link is clickable and opens its target.",
  ],
}
    );
  }
);

test(
  "link activation wording remains a behavioral requirement",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-link-activation",
        persona: "company_admin",
        goal: "Verify clickable document links.",
        startRoute: "/documents/1",
        successCriteria:
          "Native PDF links activate their intended destinations.",
        automatedChecks: [
          'Verify "Compliance Document" is visible.',
        ],
        manualChecks: [
          "Click a native PDF link and verify its destination.",
        ],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Compliance Document",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "Native PDF links activate their intended destinations.",
        ],
      }
    );
  }
);

test(
  "record-ordering claim requires behavior proof when automation only proves sort controls",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-3",
        persona: "company_admin",
        goal:
          "Verify jobs are sorted in the correct date order.",
        startRoute: "/company/all-jobs",
        successCriteria:
          "Applying the sort option orders the job records correctly.",
        automatedChecks: [
          "Verify applying the sort option orders the records correctly.",
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Sort",
          },
          {
            action: "assertTextVisible",
            text: "Newest",
          },
          {
            action: "assertTextVisible",
            text: "Oldest",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
  requiresBehaviorProof: true,
  behaviorClaims: [
    "Applying the sort option orders the job records correctly.",
  ],
}
    );
  }
);

test(
  "sorting with explicit timestamp direction requires behavior proof",
  () => {
    const successCriteria =
      "The Jobs list supports newest, latest, and oldest sorting, " +
      "with newest based on createdAt descending, " +
      "latest based on updatedAt descending, " +
      "and oldest based on updatedAt ascending.";

    const plan = planWithBrowserCases([
      {
        id: "web-scope-ordering-sorting-parity",
        persona: "company_admin",
        goal:
          "Verify the Jobs list sorting choices.",
        startRoute: "/company/all-jobs",
        successCriteria,
        automatedChecks: [
          'Verify "newest" is visible.',
          'Verify "latest" is visible.',
          'Verify "oldest" is visible.',
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Sort",
          },
          {
            action: "assertTextVisible",
            text: "newest",
          },
          {
            action: "assertTextVisible",
            text: "latest",
          },
          {
            action: "assertTextVisible",
            text: "oldest",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      withoutOrderingContractMetadata(
        plan.browserCases[0].acceptanceScope
      ),
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          successCriteria,
        ],
        orderingRequirements: [
          {
            kind: "ORDERING",
            requirementId:
              "web-scope-ordering-sorting-parity-ordering-1",
            sourceClaim: successCriteria,
            direction: "DESC",
            comparisonType: "DATE_TIME",
            fieldHint: "createdAt",
            collectionHint: "jobs",
            selectionHint: "Newest",
          },
          {
            kind: "ORDERING",
            requirementId:
              "web-scope-ordering-sorting-parity-ordering-2",
            sourceClaim: successCriteria,
            direction: "DESC",
            comparisonType: "DATE_TIME",
            fieldHint: "updatedAt",
            collectionHint: "jobs",
            selectionHint: "Latest",
          },
          {
            kind: "ORDERING",
            requirementId:
              "web-scope-ordering-sorting-parity-ordering-3",
            sourceClaim: successCriteria,
            direction: "ASC",
            comparisonType: "DATE_TIME",
            fieldHint: "updatedAt",
            collectionHint: "jobs",
            selectionHint: "Oldest",
          },
        ],
      }
    );
  }
);

test(
  "ordering behavior distributed across success criteria sentences requires behavior proof",
  () => {
    const successCriteria =
      "The Jobs list provides newest, latest, and oldest sorting choices. " +
      "Selecting newest uses creation-time descending behavior, " +
      "selecting latest uses update-time descending behavior, " +
      "and selecting oldest uses update-time ascending behavior.";

    const plan = planWithBrowserCases([
      {
        id: "web-scope-compositional-ordering",
        persona: "company_admin",
        goal:
          "Verify the Jobs list sorting behavior.",
        startRoute: "/company/all-jobs",
        successCriteria,
        automatedChecks: [
          'Verify "newest" is visible.',
          'Verify "latest" is visible.',
          'Verify "oldest" is visible.',
        ],
        manualChecks: [
          "Verify the resulting record ordering.",
        ],
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Sort",
          },
          {
            action: "assertTextVisible",
            text: "newest",
          },
          {
            action: "assertTextVisible",
            text: "latest",
          },
          {
            action: "assertTextVisible",
            text: "oldest",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      withoutOrderingContractMetadata(
        plan.browserCases[0].acceptanceScope
      ),
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          successCriteria,
        ],
        orderingRequirements: [
          {
            kind: "ORDERING",
            requirementId:
              "web-scope-compositional-ordering-ordering-1",
            sourceClaim:
              "Selecting newest uses creation-time descending behavior, selecting latest uses update-time descending behavior, and selecting oldest uses update-time ascending behavior.",
            direction: "DESC",
            comparisonType: "DATE_TIME",
            fieldHint: "createdAt",
            selectionHint: "Newest",
          },
          {
            kind: "ORDERING",
            requirementId:
              "web-scope-compositional-ordering-ordering-2",
            sourceClaim:
              "Selecting newest uses creation-time descending behavior, selecting latest uses update-time descending behavior, and selecting oldest uses update-time ascending behavior.",
            direction: "DESC",
            comparisonType: "DATE_TIME",
            fieldHint: "updatedAt",
            selectionHint: "Latest",
          },
          {
            kind: "ORDERING",
            requirementId:
              "web-scope-compositional-ordering-ordering-3",
            sourceClaim:
              "Selecting newest uses creation-time descending behavior, selecting latest uses update-time descending behavior, and selecting oldest uses update-time ascending behavior.",
            direction: "ASC",
            comparisonType: "DATE_TIME",
            fieldHint: "updatedAt",
            selectionHint: "Oldest",
          },
        ],
      }
    );
  }
);

test(
  "optional empty-state flow continuity requires behavior proof when automation only proves a wizard label",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-empty-flow",
        persona: "company_admin",
        goal: "Verify an optional wizard step.",
        startRoute: "/company/jobs/create",
        successCriteria:
          "The wizard supports a job without optional items and allows the remaining flow to continue normally.",
        automatedChecks: [
          'Verify "Optional items" is visible.',
        ],
        manualChecks: [
          "Verify the empty step does not prevent the remaining flow.",
        ],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Optional items",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "The wizard supports a job without optional items and allows the remaining flow to continue normally.",
        ],
      }
    );
  }
);

test(
  "Jira-grounded separate UI entities remain unproven when the plan uses only visible-text assertions",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-structural-text",
        persona: "talent",
        goal:
          "Verify the four new proficiency skills.",
        startRoute: "/talent/profile",
        successCriteria:
          "Listening, Speaking, Writing, and Reading are visible.",
        automatedChecks: [
          'Verify "Listening" is visible.',
          'Verify "Speaking" is visible.',
          'Verify "Writing" is visible.',
          'Verify "Reading" is visible.',
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Listening",
          },
          {
            action: "assertTextVisible",
            text: "Speaking",
          },
          {
            action: "assertTextVisible",
            text: "Writing",
          },
          {
            action: "assertTextVisible",
            text: "Reading",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);
    applyBrowserTextAssertionProvenanceGate(
      plan,
      `
--- JIRA TICKET ---
Description: The client UI must display four separate proficiency controls.
--- GITHUB CHANGE CONTEXT ---
const copy = "Listening Speaking Writing Reading";
`
    );

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "Verify the four new proficiency skills.",
        ],
      }
    );
  }
);

test(
  "text-only Jira scope does not invent a structural acceptance gap",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-text-only",
        persona: "talent",
        goal: "Verify Listening is visible.",
        startRoute: "/talent/profile",
        successCriteria:
          "Listening is visible.",
        automatedChecks: [
          'Verify "Listening" is visible.',
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Listening",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);
    applyBrowserTextAssertionProvenanceGate(
      plan,
      `
--- JIRA TICKET ---
Description: Listening should be visible in the client UI.
--- GITHUB CHANGE CONTEXT ---
const SeparateControl = () => <input aria-label="Listening" />;
`
    );

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: false,
        behaviorClaims: [],
      }
    );
  }
);

test(
  "GitHub-only control structure does not expand Jira text scope",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-github-only-structure",
        persona: "talent",
        goal:
          "Verify four separate proficiency controls.",
        startRoute: "/talent/profile",
        successCriteria:
          "Listening is visible.",
        automatedChecks: [
          'Verify "Listening" is visible.',
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Listening",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);
    applyBrowserTextAssertionProvenanceGate(
      plan,
      `
--- JIRA TICKET ---
Description: Listening should be visible in the client UI.
--- GITHUB CHANGE CONTEXT ---
The implementation renders four separate proficiency controls.
`
    );

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: false,
        behaviorClaims: [],
      }
    );
  }
);

test(
  "GitHub-only enum spelling remains a non-critical visible-text observation",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-enum-copy",
        persona: "company_admin",
        goal:
          "Verify publish requests can be filtered.",
        startRoute: "/change-requests",
        successCriteria:
          "The table visibly reflects the selected request type filter.",
        automatedChecks: [],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "publish-request",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);
    applyBrowserTextAssertionProvenanceGate(
      plan,
      `
--- JIRA TICKET ---
Description: Add a Publish request type filter to the client UI.
--- GITHUB CHANGE CONTEXT ---
const requestType = "publish-request";
`
    );

    assert.equal(
      plan.browserCases[0].steps[0]
        .acceptanceCritical,
      false
    );
  }
);

test(
  "Jira-grounded exact enum spelling retains default assertion criticality",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-enum-copy-jira",
        persona: "company_admin",
        goal:
          "Verify the exact status token is visible.",
        startRoute: "/change-requests",
        successCriteria:
          "The UI displays publish-request exactly.",
        automatedChecks: [],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "publish-request",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);
    applyBrowserTextAssertionProvenanceGate(
      plan,
      `
--- JIRA TICKET ---
Description: The UI must display publish-request exactly.
--- GITHUB CHANGE CONTEXT ---
const requestType = "publish-request";
`
    );

    assert.equal(
      plan.browserCases[0].steps[0]
        .acceptanceCritical,
      undefined
    );
  }
);

test(
  "source-grounded compound UI labels refine single-word negative assertions",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-negative-label",
        persona: "talent",
        goal:
          "Verify the former model is absent.",
        startRoute: "/talent/profile",
        successCriteria:
          "Receptive and Productive are not shown.",
        automatedChecks: [],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextNotVisible",
            text: "Receptive",
          },
          {
            action: "assertTextNotVisible",
            text: "Productive",
          },
          {
            action: "assertTextNotVisible",
            text: "Deprecated",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);
    applyBrowserTextAssertionProvenanceGate(
      plan,
      `
--- JIRA TICKET ---
Description: Receptive and Productive are no longer shown in the client UI.
--- GITHUB CHANGE CONTEXT ---
const receptiveLevelLabel = "Receptive Level";
const productiveLevelLabel = "Productive Level";
const deprecatedFieldLabel = "Deprecated Field";
`
    );

    assert.deepEqual(
      plan.browserCases[0].steps.map(
        (step: any) => step.text
      ),
      [
        "Receptive Level",
        "Productive Level",
        "Deprecated",
      ]
    );
  }
);

test(
  "behavior explicitly assigned to manual checks does not expand automated acceptance scope",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-4",
        persona: "talent",
        goal:
          "Verify Work Setups appear and support the no-document completion path.",
        startRoute: "/talent/contracts/387",
        successCriteria:
          "Work Setups are visible and a compatible Work Setup can be completed.",
        automatedChecks: [
          "Verify the Work Setups section is visible.",
          "Verify the Compliance Requirements section is visible.",
        ],
        manualChecks: [
          "Open the compatible Work Setup card and verify the Complete button.",
          "Complete the Work Setup and verify its status refreshes to completed.",
        ],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Work Setups",
          },
          {
            action: "assertTextVisible",
            text: "Compliance Requirements",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
  requiresBehaviorProof: false,
  behaviorClaims: [],
}
    );
  }
);

test(
  "behavior claim existence is independent from automated or manual allocation",
  () => {
    const buildCase = (
      automatedChecks: string[],
      manualChecks: string[]
    ) => ({
      id: "web-scope-allocation",
      persona: "company_admin",
      goal:
        "Verify the document link behavior.",
      startRoute: "/documents/1",
      successCriteria:
        "Clicking View document opens the intended document.",
      automatedChecks,
      manualChecks,
      fixtureRequirements: [],
      steps: [
        {
          action: "assertTextVisible",
          text: "View document",
        },
      ],
    });
    const automatedPlan = planWithBrowserCases([
      buildCase(
        [
          "Clicking View document opens the intended document.",
        ],
        []
      ),
    ]);
    const manualPlan = planWithBrowserCases([
      buildCase(
        ['Verify "View document" is visible.'],
        [
          "Click View document and verify the intended document opens.",
        ]
      ),
    ]);

    normalizePlannerBrowserScopes(automatedPlan);
    normalizePlannerBrowserScopes(manualPlan);

    assert.deepEqual(
      manualPlan.browserCases[0].acceptanceScope,
      automatedPlan.browserCases[0].acceptanceScope
    );
    assert.deepEqual(
      manualPlan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "Clicking View document opens the intended document.",
        ],
      }
    );
  }
);

test(
  "supporting behavioral wording does not override static requirement semantics",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-supporting",
        persona: "company_admin",
        goal: "Verify document availability.",
        startRoute: "/documents/1",
        successCriteria:
          "The View document label is visible.",
        automatedChecks: [
          "Supporting observation: the document may open in a new tab.",
        ],
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "View document",
            acceptanceCritical: false,
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: false,
        behaviorClaims: [],
      }
    );
  }
);

test(
  "implementation-only behavior does not expand static requirement semantics",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-implementation-only",
        persona: "company_admin",
        goal: "Verify document availability.",
        startRoute: "/documents/1",
        successCriteria:
          "The View document label is visible.",
        automatedChecks: [
          'Verify "View document" is visible.',
        ],
        manualChecks: [],
        fixtureRequirements: [],
        sourceContext:
          "Frontend implementation automatically opens PDF links.",
        steps: [
          {
            action: "assertTextVisible",
            text: "View document",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: false,
        behaviorClaims: [],
      }
    );
  }
);

test(
  "explicit MANUAL_REQUIRED criteria stay outside automated acceptance scope",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-manual-marker",
        persona: "talent",
        goal:
          "Verify a document is available and its link behavior can be reviewed.",
        startRoute: "/documents/1",
        successCriteria:
          "The document is visible. " +
          "MANUAL_REQUIRED: open the native link and verify that it navigates to its intended destination.",
        automatedChecks: null,
        manualChecks: null,
        fixtureRequirements: [],
        steps: [
          {
            action: "assertTextVisible",
            text: "Document",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].manualChecks,
      [
        "MANUAL_REQUIRED: open the native link and verify that it navigates to its intended destination.",
      ]
    );

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
  requiresBehaviorProof: true,
  behaviorClaims: [
    "MANUAL_REQUIRED: open the native link and verify that it navigates to its intended destination.",
  ],
}
    );

    assert.equal(
      plan.browserCases[0].automatedChecks.some(
        (check: string) =>
          /navigat/i.test(check)
      ),
      false
    );
  }
);


test(
  "selected-state claim requires behavior proof when automation only proves option visibility",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-selected-state",
        persona: "company_admin",
        goal:
          "Verify a sorting control exposes its options and selected state.",
        startRoute: "/items",
        successCriteria:
          "Newest and Oldest are available as options. " +
          "After an option is selected, the visible selected value is correct. " +
          "MANUAL_REQUIRED: verify the resulting backend record ordering separately.",
        automatedChecks: null,
        manualChecks: null,
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Sort",
          },
          {
            action: "assertTextVisible",
            text: "Newest",
          },
          {
            action: "assertTextVisible",
            text: "Oldest",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].manualChecks,
      [
        "MANUAL_REQUIRED: verify the resulting backend record ordering separately.",
      ]
    );

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
  requiresBehaviorProof: true,
  behaviorClaims: [
    "After an option is selected, the visible selected value is correct.",
  ],
}
    );
  }
);

test(
  "selecting inflection builds selected-state provenance and a redundant menu-label observation is non-critical",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-filter-selected-state",
        persona: "company_admin",
        goal:
          "Verify the table supports filtering by request type.",
        startRoute: "/items",
        successCriteria:
          "The table supports selecting a request type filter and displays the matching requests.",
        automatedChecks: null,
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Filters",
          },
          {
            action: "assertTextVisible",
            text: "Filters",
          },
          {
            action: "selectRuntimeFilterOption",
            filterKey: "type",
            verification: "visible-state",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0].steps[1]
        .acceptanceCritical,
      false
    );
    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "The table supports selecting a request type filter and displays the matching requests.",
        ],
        selectedStateRequirements: [
          {
            kind: "SELECTED_STATE",
            sourceClaim:
              "The table supports selecting a request type filter and displays the matching requests.",
            interactionId:
              "web-filter-selected-state:interaction-1",
            selectionOracleId:
              "web-filter-selected-state:assertion-2",
          },
        ],
      }
    );
  }
);

test(
  "selected runtime type reflected in the UI builds selected-state provenance",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-reflected-type-state",
        persona: "company_admin",
        goal:
          "Verify a request type filter visibly applies a runtime selection.",
        startRoute: "/items",
        successCriteria:
          "The table provides type-based filtering and the selected type is visibly reflected without malformed data.",
        automatedChecks: null,
        manualChecks: [],
        fixtureRequirements: [],
        steps: [
          {
            action: "selectRuntimeFilterOption",
            filterKey: "type",
            verification: "visible-state",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0].acceptanceScope,
      {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "The table provides type-based filtering and the selected type is visibly reflected without malformed data.",
        ],
        selectedStateRequirements: [
          {
            kind: "SELECTED_STATE",
            sourceClaim:
              "The table provides type-based filtering and the selected type is visibly reflected without malformed data.",
            interactionId:
              "web-reflected-type-state:interaction-1",
            selectionOracleId:
              "web-reflected-type-state:assertion-1",
          },
        ],
      }
    );
  }
);


test(
  "acceptance scope preserves the behavioral claim when executable checks are normalized to visibility",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-behavior-claim",
        persona: "company_admin",
        goal:
          "Verify a control exposes options and preserves its selected state.",
        startRoute: "/items",
        successCriteria:
          "Alpha and Beta are available as options. " +
          "After an option is selected, the visible selected value is correct. " +
          "MANUAL_REQUIRED: verify backend effects separately.",
        automatedChecks: null,
        manualChecks: null,
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Options",
          },
          {
            action: "assertTextVisible",
            text: "Alpha",
          },
          {
            action: "assertTextVisible",
            text: "Beta",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0]
        .acceptanceScope
        ?.behaviorClaims,
      [
        "After an option is selected, the visible selected value is correct.",
      ]
    );

    assert.deepEqual(
      plan.browserCases[0].automatedChecks,
      [
        'Verify "Alpha" is visible.',
        'Verify "Beta" is visible.',
      ]
    );
  }
);

test(
  "opening a sorting control is not misclassified as a record-ordering claim",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-scope-ordering-boundary",
        persona: "company_admin",
        goal:
          "Verify an items list exposes sorting and selected-state behavior.",
        startRoute: "/items",
        successCriteria:
          "The runner resolves the items list route and opens the safe sorting control. " +
          "After each option is selected, the visible selected value is correct. " +
          "MANUAL_REQUIRED: verify the actual record ordering separately.",
        automatedChecks: null,
        manualChecks: null,
        fixtureRequirements: [],
        steps: [
          {
            action: "openMenu",
            text: "Sort",
          },
          {
            action: "assertTextVisible",
            text: "Newest",
          },
          {
            action: "assertTextVisible",
            text: "Oldest",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0]
        .acceptanceScope
        ?.behaviorClaims,
      [
        "After each option is selected, the visible selected value is correct.",
      ]
    );

    assert.deepEqual(
      plan.browserCases[0].manualChecks,
      [
        "MANUAL_REQUIRED: verify the actual record ordering separately.",
      ]
    );
  }
);

test(
  "assigns stable interaction identity separately from assertion oracle identity",
  () => {
    const plan: any = {
      browserCases: [
        {
          id: "web-url-transition",
          persona: "company_admin",
          goal:
            "Open Details and verify navigation to the details route.",
          startRoute: "/company/items",
          successCriteria:
            "Opening Details navigates to the item details route.",
          automatedChecks: [
            "Opening Details navigates to the item details route.",
          ],
          manualChecks: [],
          fixtureRequirements: [],
          steps: [
            {
              action: "clickText",
              text: "Details",
            },
            {
              action: "assertUrlContains",
              text: "/details",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(plan);

    const interactionStep =
      plan.browserCases[0].steps[0];

    const urlAssertionStep =
      plan.browserCases[0].steps[1];

    assert.equal(
      interactionStep.interactionId,
      "web-url-transition:interaction-1"
    );

    /*
     * interactionId and oracleId identify
     * different concepts.
     */
    assert.equal(
      interactionStep.oracleId,
      undefined
    );

    assert.equal(
      urlAssertionStep.oracleId,
      "web-url-transition:assertion-1"
    );

    assert.equal(
      urlAssertionStep.interactionId,
      undefined
    );
  }
);

test(
  "builds one URL_TRANSITION requirement from one navigation claim, interaction, and positive URL oracle",
  () => {
    const plan: any = {
      browserCases: [
        {
          id: "web-url-transition",
          persona: "company_admin",
          goal:
            "Open the Details link and navigate to the details page.",
          startRoute: "/company/items",
          successCriteria:
            "Opening the Details link navigates to the details page.",
          automatedChecks: [
            "Opening the Details link navigates to the details page.",
          ],
          manualChecks: [],
          fixtureRequirements: [],
          steps: [
            {
              action: "clickText",
              text: "Details",
            },
            {
              action: "assertUrlContains",
              text: "/details",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      plan.browserCases[0]
        .acceptanceScope
        .urlTransitionRequirements,
      [
        {
          kind: "URL_TRANSITION",
          sourceClaim:
            "Opening the Details link navigates to the details page.",
          interactionId:
            "web-url-transition:interaction-1",
          urlAssertionOracleId:
            "web-url-transition:assertion-1",
        },
      ]
    );
  }
);

test(
  "does not build URL_TRANSITION requirement from a negative URL assertion",
  () => {
    const plan: any = {
      browserCases: [
        {
          id: "web-negative-url",
          persona: "company_admin",
          goal:
            "Open the Details link.",
          startRoute: "/company/items",
          successCriteria:
            "Opening the Details link navigates to the details page.",
          automatedChecks: [
            "Opening the Details link navigates to the details page.",
          ],
          manualChecks: [],
          fixtureRequirements: [],
          steps: [
            {
              action: "clickText",
              text: "Details",
            },
            {
              action: "assertUrlNotContains",
              text: "/items",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .urlTransitionRequirements,
      undefined
    );
  }
);

test(
  "does not turn a selected-state behavior claim into a URL_TRANSITION requirement",
  () => {
    const plan: any = {
      browserCases: [
        {
          id: "web-selected-state",
          persona: "company_admin",
          goal:
            "Choose the Active filter.",
          startRoute: "/company/items",
          successCriteria:
            "The selected filter value is Active.",
          automatedChecks: [
            "The selected filter value is Active.",
          ],
          manualChecks: [],
          fixtureRequirements: [],
          steps: [
            {
              action: "clickText",
              text: "Active",
            },
            {
              action: "assertUrlContains",
              text: "status=active",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .urlTransitionRequirements,
      undefined
    );
  }
);

test(
  "does not guess URL_TRANSITION linkage when multiple interactions are candidates",
  () => {
    const plan: any = {
      browserCases: [
        {
          id: "web-ambiguous-transition",
          persona: "company_admin",
          goal:
            "Open the item and navigate to its details page.",
          startRoute: "/company/items",
          successCriteria:
            "Opening the item navigates to the details page.",
          automatedChecks: [
            "Opening the item navigates to the details page.",
          ],
          manualChecks: [],
          fixtureRequirements: [],
          steps: [
            {
              action: "clickText",
              text: "Items",
            },
            {
              action: "clickText",
              text: "Details",
            },
            {
              action: "assertUrlContains",
              text: "/details",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .urlTransitionRequirements,
      undefined
    );
  }
);

test(
  "does not guess URL_TRANSITION linkage when multiple positive URL assertions are candidates",
  () => {
    const plan: any = {
      browserCases: [
        {
          id:
            "web-ambiguous-url-transition",
          persona: "company_admin",
          goal:
            "Open the Details link and navigate to the details page.",
          startRoute:
            "/company/items",
          successCriteria:
            "Opening the Details link navigates to the details page.",
          automatedChecks: [
            "Opening the Details link navigates to the details page.",
          ],
          manualChecks: [],
          fixtureRequirements: [],
          steps: [
            {
              action: "clickText",
              text: "Details",
            },
            {
              action:
                "assertUrlContains",
              text: "/details",
            },
            {
              action:
                "assertUrlContains",
              text: "itemId=",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(
      plan
    );

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .urlTransitionRequirements,
      undefined
    );
  }
);

test(
  "builds one SELECTED_STATE requirement from one claim and one visible-state runtime selection",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-selected-filter",
        persona: "company_admin",
        goal:
          "Verify the selected filter state.",
        startRoute: "/company/items",
        successCriteria:
          "After an option is selected, the visible selected filter value is correct.",
        automatedChecks: [
          "After an option is selected, the visible selected filter value is correct.",
        ],
        steps: [
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "status",
            hint: "Status",
            verification:
              "visible-state",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    const selectionStep =
      plan.browserCases[0].steps[0];

    assert.equal(
      selectionStep.interactionId,
      "web-selected-filter:interaction-1"
    );
    assert.equal(
      selectionStep.oracleId,
      "web-selected-filter:assertion-1"
    );

    assert.deepEqual(
      plan.browserCases[0]
        .acceptanceScope
        .selectedStateRequirements,
      [
        {
          kind: "SELECTED_STATE",
          sourceClaim:
            "After an option is selected, the visible selected filter value is correct.",
          interactionId:
            "web-selected-filter:interaction-1",
          selectionOracleId:
            "web-selected-filter:assertion-1",
        },
      ]
    );
  }
);

test(
  "does not build SELECTED_STATE from URL-mode runtime selection",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-url-filter",
        persona: "company_admin",
        goal:
          "Verify the selected filter state.",
        startRoute: "/company/items",
        successCriteria:
          "After an option is selected, the selected filter value is correct.",
        automatedChecks: [
          "After an option is selected, the selected filter value is correct.",
        ],
        steps: [
          {
            action:
              "selectRuntimeFilterOption",
            queryKey: "status",
            verification: "url",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .selectedStateRequirements,
      undefined
    );
  }
);

test(
  "does not guess SELECTED_STATE linkage across multiple visible-state selections",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-multiple-filters",
        persona: "company_admin",
        goal:
          "Verify the selected filter state.",
        startRoute: "/company/items",
        successCriteria:
          "After an option is selected, the selected filter value is correct.",
        automatedChecks: [
          "After an option is selected, the selected filter value is correct.",
        ],
        steps: [
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "status",
            verification:
              "visible-state",
          },
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "type",
            verification:
              "visible-state",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .selectedStateRequirements,
      undefined
    );
  }
);

test(
  "does not guess SELECTED_STATE linkage across multiple selected-state claims",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-multiple-claims",
        persona: "company_admin",
        goal:
          "Verify the selected filter state.",
        startRoute: "/company/items",
        successCriteria:
          "The selected filter value is visible. " +
          "After an option is chosen, the selected state is correct.",
        automatedChecks: [
          "The selected filter value is visible.",
          "After an option is chosen, the selected state is correct.",
        ],
        steps: [
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "status",
            verification:
              "visible-state",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    assert.equal(
      plan.browserCases[0]
        .acceptanceScope
        .selectedStateRequirements,
      undefined
    );
  }
);

test(
  "requires both stable IDs before linking SELECTED_STATE",
  () => {
    const claim =
      "After an option is selected, the selected filter value is correct.";

    assert.deepEqual(
      buildSelectedStateRequirements(
        [claim],
        [
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "status",
            verification:
              "visible-state",
            interactionId:
              "web-1:interaction-1",
          },
        ]
      ),
      []
    );

    assert.deepEqual(
      buildSelectedStateRequirements(
        [claim],
        [
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "status",
            verification:
              "visible-state",
            oracleId:
              "web-1:assertion-1",
          },
        ]
      ),
      []
    );
  }
);

test(
  "adding selected-state IDs does not renumber existing click or assertion IDs",
  () => {
    const plan = planWithBrowserCases([
      {
        id: "web-stable-numbering",
        persona: "company_admin",
        goal:
          "Select a filter and open its details.",
        startRoute: "/company/items",
        successCriteria:
          "The selected filter value is visible and Details opens.",
        automatedChecks: [
          "The selected filter value is visible.",
        ],
        steps: [
          {
            action:
              "selectRuntimeFilterOption",
            filterKey: "status",
            verification:
              "visible-state",
          },
          {
            action: "clickText",
            text: "Details",
          },
          {
            action:
              "assertTextVisible",
            text: "Details",
          },
        ],
      },
    ]);

    normalizePlannerBrowserScopes(plan);

    const [selection, click, assertion] =
      plan.browserCases[0].steps;

    assert.equal(
      click.interactionId,
      "web-stable-numbering:interaction-1"
    );
    assert.equal(
      assertion.oracleId,
      "web-stable-numbering:assertion-1"
    );
    assert.equal(
      selection.interactionId,
      "web-stable-numbering:interaction-2"
    );
    assert.equal(
      selection.oracleId,
      "web-stable-numbering:assertion-2"
    );
  }
);

test(
  "scope normalization retains every canonical structured requirement family",
  () => {
    const structuredScope = {
      urlTransitionRequirements: [{
        kind: "URL_TRANSITION",
        requirementId: "url-1",
      }],
      selectedStateRequirements: [{
        kind: "SELECTED_STATE",
        requirementId: "selected-1",
      }],
      collectionFilterRequirements: [{
        kind: "COLLECTION_FILTER",
        requirementId: "filter-1",
      }],
      localControlStateTransitionRequirements: [{
        kind:
          "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
        requirementId: "local-state-1",
      }],
    };
    const plan = planWithBrowserCases([{
      id: "web-structured-scope",
      persona: "company_admin",
      goal: "Verify structured acceptance scope retention.",
      startRoute: "/settings",
      successCriteria: "The settings heading is visible.",
      automatedChecks: [
        'Verify "Settings" is visible.',
      ],
      manualChecks: [],
      fixtureRequirements: [],
      steps: [],
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: ["stale planner claim"],
        ...structuredScope,
        untrustedPlannerField: "must be stripped",
      },
    }]);

    normalizePlannerBrowserScopes(plan);

    assert.deepEqual(
      {
        urlTransitionRequirements:
          plan.browserCases[0].acceptanceScope
            .urlTransitionRequirements,
        selectedStateRequirements:
          plan.browserCases[0].acceptanceScope
            .selectedStateRequirements,
        collectionFilterRequirements:
          plan.browserCases[0].acceptanceScope
            .collectionFilterRequirements,
        localControlStateTransitionRequirements:
          plan.browserCases[0].acceptanceScope
            .localControlStateTransitionRequirements,
      },
      structuredScope
    );
    assert.equal(
      "untrustedPlannerField" in
        plan.browserCases[0].acceptanceScope,
      false
    );
  }
);

test(
  "scope normalization never reconstructs authority from emitted IDs or prose",
  () => {
    const plan = planWithBrowserCases([{
      id: "web-no-reconstruction",
      persona: "company_admin",
      goal: "Reset to defaults restores the value.",
      startRoute: "/settings",
      successCriteria:
        "Reset to defaults restores the value.",
      automatedChecks: [],
      manualChecks: [
        "Reset to defaults restores the value.",
      ],
      fixtureRequirements: [],
      steps: [],
    }]);
    plan.browserObligationBindings = [{
      obligationId: "obligation-1",
      sourceUnitIds: ["source-1"],
      semanticFamily: "GROUPED_CONTROLS",
      state: "SUPPORTED_AND_BOUND",
      allocatedCaseIds: ["web-no-reconstruction"],
      emittedRequirementIds: ["local-state-1"],
      reason: "Synthetic transport guard.",
    }];

    normalizePlannerBrowserScopes(plan);
    const reloaded = JSON.parse(
      JSON.stringify(plan)
    );

    assert.equal(
      reloaded.browserCases[0].acceptanceScope
        .localControlStateTransitionRequirements,
      undefined
    );
  }
);
