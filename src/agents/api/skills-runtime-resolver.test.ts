import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  copySkillsRuntimeFixture,
  deriveSkillsRuntimeRequirements,
  mergeSkillsRuntimeQuery,
  selectSkillsRuntimeFixture,
  skillRuntimeSemanticSortKey,
} from "./skills-runtime-resolver.js";
import {
  applyBrowserSkillsRuntime,
} from "../browser/browser-skills-runtime.js";
import type {
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";

const genericPlan = {
  summary:
    "Load existing selected skills on initial render",
  notes:
    "Use the skillIds filter with limit equal to the selected-ID count and offset 0.",
  apiCases: [
    {
      method: "GET",
      path: "/skills",
      expect: {
        notes:
          "Verify the selected skill records returned by skillIds.",
      },
    },
  ],
  browserCases: [
    {
      persona: "company_admin",
      goal:
        "Display an existing selected skill on initial load.",
      successCriteria:
        "The requested selected skill is visibly represented.",
      startRoute:
        "/company/example-skills?view=grid",
      steps: [
        {
          action: "wait",
          ms: 10,
        },
      ],
    },
  ],
};

const requirements =
  deriveSkillsRuntimeRequirements(
    genericPlan
  );

test(
  "selects a non-first skill and is invariant across catalog permutations",
  () => {
    const records = [
      {
        id: 91,
        name: "Zulu Analysis",
      },
      {
        id: 37,
        name: "  Álpha   Design  ",
      },
      {
        id: 55,
        name: "Middle Research",
      },
    ];

    const permutations = [
      records,
      [records[2], records[0], records[1]],
      [...records].reverse(),
    ];

    const selected =
      permutations.map((items) =>
        selectSkillsRuntimeFixture(
          { items },
          requirements
        )
      );

    for (const result of selected) {
      assert.equal(
        result.status,
        "READY"
      );

      if (result.status === "READY") {
        assert.deepEqual(
          result.fixture.skillIds,
          ["37"]
        );
        assert.deepEqual(
          result.fixture.skillLabels,
          ["Álpha   Design"]
        );
      }
    }
  }
);

test(
  "rejects malformed records and normalizes equivalent duplicates",
  () => {
    const result =
      selectSkillsRuntimeFixture(
        {
          items: [
            {
              id: "not-numeric",
              name: "Invalid ID",
            },
            {
              name: "Missing ID",
            },
            {
              id: 8,
              name: "Existing Skill",
            },
            {
              skillId: 8,
              title: " existing  skill ",
            },
          ],
        },
        requirements
      );

    assert.equal(result.status, "READY");

    if (result.status === "READY") {
      assert.deepEqual(
        result.fixture.skillIds,
        ["8"]
      );
    }

    const malformedOnly =
      selectSkillsRuntimeFixture(
        {
          items: [
            { id: "bad" },
            { name: "No ID" },
          ],
        },
        requirements
      );

    assert.equal(
      malformedOnly.status,
      "BLOCKED"
    );
  }
);

test(
  "accepts the catalog definition as a user-facing semantic label",
  () => {
    const result =
      selectSkillsRuntimeFixture(
        {
          items: [
            {
              id: 12,
              definition:
                "Readable skill definition",
            },
          ],
        },
        requirements
      );

    assert.equal(result.status, "READY");

    if (result.status === "READY") {
      assert.deepEqual(
        result.fixture.skillLabels,
        ["Readable skill definition"]
      );
    }
  }
);

test(
  "blocks empty, unsupported, and conflicting duplicate catalogs",
  () => {
    assert.equal(
      selectSkillsRuntimeFixture(
        { items: [] },
        requirements
      ).status,
      "BLOCKED"
    );

    assert.equal(
      selectSkillsRuntimeFixture(
        { unexpected: true },
        requirements
      ).status,
      "BLOCKED"
    );

    assert.equal(
      selectSkillsRuntimeFixture(
        {
          items: [
            { id: 2, name: "One" },
            { id: 2, name: "Two" },
          ],
        },
        requirements
      ).status,
      "BLOCKED"
    );
  }
);

test(
  "uses identity only after semantic ordering",
  () => {
    const left = {
      id: "101",
      label: "Same Skill",
      category: "Shared",
    };

    const right = {
      id: "202",
      label: "Same Skill",
      category: "Shared",
    };

    assert.equal(
      skillRuntimeSemanticSortKey(
        left
      ),
      skillRuntimeSemanticSortKey(
        right
      )
    );

    assert.equal(
      skillRuntimeSemanticSortKey(
        left
      ).includes(left.id),
      false
    );
  }
);

test(
  "preserves unrelated query parameters while merging selected-skill context",
  () => {
    const fixture = {
      skillIds: ["37"],
      skillLabels: ["Alpha"],
    };

    const result =
      mergeSkillsRuntimeQuery(
        "/skills?view=grid&skillIds=UNKNOWN&limit=UNKNOWN&offset=UNKNOWN",
        fixture,
        requirements
      );

    assert.equal(result.status, "READY");

    if (result.status === "READY") {
      const url = new URL(
        result.path,
        "http://runtime.local"
      );

      assert.equal(
        url.searchParams.get("view"),
        "grid"
      );
      assert.deepEqual(
        url.searchParams.getAll(
          "skillIds"
        ),
        ["37"]
      );
      assert.equal(
        url.searchParams.get("limit"),
        "1"
      );
      assert.equal(
        url.searchParams.get("offset"),
        "0"
      );
    }
  }
);

test(
  "API and browser consume the same selected runtime set",
  () => {
    const selection =
      selectSkillsRuntimeFixture(
        {
          skills: [
            {
              id: 44,
              name: "Grounded Skill",
            },
          ],
        },
        requirements
      );

    assert.equal(
      selection.status,
      "READY"
    );

    if (selection.status !== "READY") {
      return;
    }

    const context:
      RuntimeResourceContext = {};

    copySkillsRuntimeFixture(
      context,
      selection.fixture
    );

    const apiQuery =
      mergeSkillsRuntimeQuery(
        "/skills?preserve=yes",
        selection.fixture,
        requirements
      );

    const browserCase =
      structuredClone(
        genericPlan.browserCases[0]!
      );

    const browserResult =
      applyBrowserSkillsRuntime(
        genericPlan,
        browserCase,
        context
      );

    assert.equal(apiQuery.status, "READY");
    assert.equal(
      browserResult.status,
      "READY"
    );

    if (
      apiQuery.status === "READY" &&
      browserResult.status === "READY"
    ) {
      const apiIds = new URL(
        apiQuery.path,
        "http://runtime.local"
      ).searchParams.getAll(
        "skillIds"
      );

      const browserIds = new URL(
        browserResult.path,
        "http://runtime.local"
      ).searchParams.getAll(
        "skillIds"
      );

      assert.deepEqual(
        browserIds,
        apiIds
      );
      const runtimeSkillAssertion =
        (browserCase.steps as any[]).find(
          (step: any) =>
            step.action ===
              "assertTextVisible" &&
            step.text ===
              "Grounded Skill"
        );

      assert.ok(runtimeSkillAssertion);
      assert.equal(
        runtimeSkillAssertion.oracleId,
        undefined
      );
      assert.equal(
        runtimeSkillAssertion
          .acceptanceCritical,
        false
      );
      assert.equal(
        new URL(
          browserResult.path,
          "http://runtime.local"
        ).searchParams.get("view"),
        "grid"
      );
    }
  }
);

test(
  "production runtime capability contains no issue or case branches",
  () => {
    const productionFiles = [
      "src/agents/api/skills-runtime-resolver.ts",
      "src/agents/browser/browser-skills-runtime.ts",
    ];

    const source = productionFiles
      .map((path) =>
        fs.readFileSync(path, "utf8")
      )
      .join("\n");

    assert.doesNotMatch(
      source,
      /AS-1073|api-1|web-1|\/company\/skills|QA_COMPANY_ID/
    );
  }
);
