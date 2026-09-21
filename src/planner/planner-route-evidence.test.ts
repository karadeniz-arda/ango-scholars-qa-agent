import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPlannerRouteEvidence,
} from "./planner-route-evidence.js";

test("extracts exact internal Jira routes without accepting resource or external URLs", () => {
  const evidence = extractPlannerRouteEvidence({
    jiraDescription: [
      "Open /company/payments for the browser flow.",
      "Download https://storage.example.test/company/archive.pdf?signature=secret.",
      "See https://external.example.test/company/payments.",
      "Call /api/company/payments?type=processed.",
    ].join("\n"),
  });

  assert.deepEqual(
    evidence.map((item) => ({
      route: item.route,
      origin: item.origin,
      authoritative: item.authoritative,
      disposition: item.disposition,
    })),
    [
      {
        route: "/company/payments",
        origin: "JIRA_EXPLICIT_ROUTE",
        authoritative: true,
        disposition: "CURRENT",
      },
    ]
  );
});

function jiraEvidence(text: string) {
  return extractPlannerRouteEvidence({
    jiraDescription: text,
  }).map((item) => ({
    route: item.route,
    authoritative: item.authoritative,
    disposition: item.disposition,
  }));
}

const singleRouteCases = [
  [
    "Navigate to /company/payments",
    "CURRENT",
    true,
  ],
  [
    "Do not use /company/payments",
    "NEGATED",
    false,
  ],
  [
    "/company/payments is deprecated",
    "LEGACY",
    false,
  ],
  [
    "The old route was /company/payments",
    "LEGACY",
    false,
  ],
  [
    "The page no longer uses /talent/jobs",
    "NEGATED",
    false,
  ],
  [
    "Verify /company/payments does not contain jobId=",
    "CURRENT",
    true,
  ],
  [
    "Do not include jobId= in /company/payments",
    "CURRENT",
    true,
  ],
  [
    "The old API endpoint /company/payments is unused",
    "RESOURCE_OR_API",
    false,
  ],
  [
    "Download the signed URL /company/payments",
    "RESOURCE_OR_API",
    false,
  ],
  [
    "  NAVIGATE   TO   /COMPANY/PAYMENTS  ",
    "CURRENT",
    true,
  ],
  [
    "The browser URL becomes /company/payments?tab=processed",
    "CURRENT",
    true,
  ],
  [
    "Navigate to /talent/assessments/:assessmentId/prepare",
    "CURRENT",
    true,
  ],
  [
    "The page is available at /company/payments",
    "CURRENT",
    true,
  ],
] as const;

for (const [text, disposition, authoritative] of singleRouteCases) {
  test(`classifies Jira route context: ${text}`, () => {
    const evidence = jiraEvidence(text);

    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.disposition, disposition);
    assert.equal(evidence[0]?.authoritative, authoritative);
  });
}

test("classifies replaced-from and current routes independently", () => {
  assert.deepEqual(
    jiraEvidence(
      "/company/jobs was replaced by /company/payments"
    ),
    [
      {
        route: "/company/jobs",
        authoritative: false,
        disposition: "REPLACED_FROM",
      },
      {
        route: "/company/payments",
        authoritative: true,
        disposition: "CURRENT",
      },
    ]
  );
});

test("associates do-not-use with only the old route", () => {
  assert.deepEqual(
    jiraEvidence(
      "Do not use /company/jobs; use /company/payments instead."
    ),
    [
      {
        route: "/company/jobs",
        authoritative: false,
        disposition: "REPLACED_FROM",
      },
      {
        route: "/company/payments",
        authoritative: true,
        disposition: "CURRENT",
      },
    ]
  );
});

test("unrelated negation in a previous sentence does not poison a route", () => {
  assert.deepEqual(
    jiraEvidence(
      "Do not use the obsolete filter. Navigate to /company/payments."
    )[0],
    {
      route: "/company/payments",
      authoritative: true,
      disposition: "CURRENT",
    }
  );
});

test("unrelated negation in a following sentence does not poison a route", () => {
  assert.deepEqual(
    jiraEvidence(
      "Navigate to /company/payments. Do not use the obsolete filter."
    )[0],
    {
      route: "/company/payments",
      authoritative: true,
      disposition: "CURRENT",
    }
  );
});

test("an external URL remains excluded", () => {
  assert.deepEqual(
    jiraEvidence(
      "Navigate to https://external.example.test/company/payments."
    ),
    []
  );
});

test("a bare Jira route mention is retained as ambiguous diagnostics", () => {
  assert.deepEqual(
    jiraEvidence("Related route: /company/payments"),
    [
      {
        route: "/company/payments",
        authoritative: false,
        disposition: "AMBIGUOUS",
      },
    ]
  );
});

test("structured Jira source units preserve independent route-local context", () => {
  const evidence = extractPlannerRouteEvidence({
    jiraSourceUnits: [
      {
        id: "unit-old",
        sourceKind: "DESCRIPTION",
        sourceRef: "jira.description",
        sectionHeading: "Migration",
        text: "Do not use /company/jobs.",
      },
      {
        id: "unit-current",
        sourceKind: "DESCRIPTION",
        sourceRef: "jira.description",
        sectionHeading: "Expected Behavior",
        text: "Navigate to /company/payments.",
      },
    ],
  });

  assert.deepEqual(
    evidence.map((item) => ({
      route: item.route,
      disposition: item.disposition,
      sourceRef: item.sourceRef,
    })),
    [
      {
        route: "/company/jobs",
        disposition: "NEGATED",
        sourceRef: "jira.description#unit-old",
      },
      {
        route: "/company/payments",
        disposition: "CURRENT",
        sourceRef: "jira.description#unit-current",
      },
    ]
  );
});

test("classifies structural GitHub router mappings separately from incidental frontend literals", () => {
  const evidence = extractPlannerRouteEvidence({
    githubContext: [
      "Patch for src/routes/payments.route.tsx:",
      "```diff",
      '+  <Route path="/company/payments" element={<Payments />} />',
      "```",
      "Patch for src/components/PaymentLink.tsx:",
      "```diff",
      '+  const fallback = "/company/all-jobs";',
      "```",
    ].join("\n"),
  });

  assert.deepEqual(
    evidence.map((item) => ({
      route: item.route,
      origin: item.origin,
      authoritative: item.authoritative,
    })),
    [
      {
        route: "/company/payments",
        origin: "GITHUB_ROUTER_MAPPING",
        authoritative: true,
      },
      {
        route: "/company/all-jobs",
        origin: "GITHUB_FRONTEND_ROUTE_LITERAL",
        authoritative: false,
      },
    ]
  );
});

test("route evidence extraction is bounded and deterministic", () => {
  const input = {
    jiraDescription:
      "Use /talent/jobs then /company/payments.",
    githubContext: "",
  };

  assert.deepEqual(
    extractPlannerRouteEvidence(input),
    extractPlannerRouteEvidence(input)
  );
});
