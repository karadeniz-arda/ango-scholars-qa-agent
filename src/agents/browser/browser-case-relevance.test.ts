import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserRelevanceBlockReason,
  inferBrowserCaseArea,
} from "./browser-case-relevance.js";

test(
  "explicit Payments surface outranks relational job-title vocabulary",
  () => {
    const testCase = {
      id: "payments-search",
      goal:
        "Verify that the Payments page can search invoices by job title.",
      startRoute:
        "/company/payments",
    };

    assert.equal(
      inferBrowserCaseArea(testCase),
      "payments"
    );
    assert.equal(
      getBrowserRelevanceBlockReason(
        testCase
      ),
      null
    );
  }
);

test(
  "explicit All Payments surface retains the Payments family",
  () => {
    const testCase = {
      id: "all-payments-search",
      goal:
        "Verify that the All Payments page can search invoices by job title.",
      startRoute:
        "/company/all-payments",
    };

    assert.equal(
      inferBrowserCaseArea(testCase),
      "payments"
    );
    assert.equal(
      getBrowserRelevanceBlockReason(
        testCase
      ),
      null
    );
  }
);

test(
  "explicit Jobs surface remains Jobs when job-title vocabulary is present",
  () => {
    assert.equal(
      inferBrowserCaseArea({
        goal:
          "Verify that the Jobs page can be filtered by job title.",
      }),
      "jobs"
    );
  }
);

test(
  "relational vocabulary without an explicit surface keeps existing inference",
  () => {
    assert.equal(
      inferBrowserCaseArea({
        goal:
          "Verify that a job title is visible.",
      }),
      "jobs"
    );
  }
);

test(
  "multiple explicit target surfaces remain ambiguous instead of using token order",
  () => {
    const testCase = {
      id: "ambiguous-surface",
      goal:
        "Compare the Jobs page and Payments page.",
      startRoute:
        "/company/payments",
    };

    assert.equal(
      inferBrowserCaseArea(testCase),
      undefined
    );
    assert.equal(
      getBrowserRelevanceBlockReason(
        testCase
      ),
      null
    );
  }
);
