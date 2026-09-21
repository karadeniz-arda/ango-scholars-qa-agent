import assert from "node:assert/strict";
import test from "node:test";
import type {
  Page,
} from "playwright";
import {
  createTalentContractWorkSetupFixtureProvider,
  type TalentContractWorkSetupFixtureDependencies,
} from "./talent-contract-work-setup-fixture.js";

function buildHarness(
  options: {
    initiallyAttached?: boolean;
    uiReady?: boolean;
  } = {}
) {
  const events: string[] = [];
  let attached =
    options.initiallyAttached ===
    true;

  const dependencies:
    TalentContractWorkSetupFixtureDependencies = {
      getApiUrl: () =>
        "https://api.invalid",
      getToken: async () =>
        "test-token-not-logged",
      selectCandidate:
        async (args) => {
          const inputCandidates =
            args.candidates.map(
              (candidate) => ({
                ...candidate,
              }));

          const {
            runGenericFixtureCandidateSelection,
          } = await import(
            "./generic-fixture-candidate-selector.js"
          );

          return runGenericFixtureCandidateSelection({
            requirements:
              args.requirements,
            candidates:
              inputCandidates,
            ...(args.selectionPolicy
              ? {
                  selectionPolicy:
                    args.selectionPolicy,
                }
              : {}),
            requestProposal:
              async (input) => {
                const selected =
                  input.candidates.find(
                    (candidate) =>
                      candidate
                        .capabilities.title ===
                      "Representative"
                  )!;

                return {
                  decision:
                    "SELECT_CANDIDATE",
                  selectionMode:
                    selected.selectionMode,
                  candidateId:
                    selected.candidateId,
                  confidence: "high",
                  rationale:
                    "The exact approved title distinguishes the candidate.",
                  evidence: [
                    {
                      path: "title",
                      expected:
                        "Representative",
                    },
                  ],
                };
              },
          });
        },
      getJson: async (
        _apiUrl,
        path
      ) => {
        if (
          path.includes(
            "/companies/"
          )
        ) {
          return [
            {
              id: "resource-other",
              title: "Specialized",
              description:
                "A specialized option",
            },
            {
              id: "resource-selected",
              title:
                "Representative",
              description:
                "A general option",
            },
          ];
        }

        return attached
          ? [
              {
                workSetup: {
                  id:
                    "resource-selected",
                  title:
                    "Representative",
                },
              },
            ]
          : [];
      },
      mutate: async (
        _apiUrl,
        path,
        method
      ) => {
        events.push(
          `${method}:${path}`
        );
        attached =
          method === "POST";

        return {
          status:
            method === "POST"
              ? 201
              : 200,
          responseBody: null,
          responseText: "",
        };
      },
      refreshSurface: async () => {
        events.push("refresh");
      },
      verifyPopulatedSurface:
        async () =>
          options.uiReady !== false,
      wait: async () =>
        undefined,
    };

  const provider =
    createTalentContractWorkSetupFixtureProvider(
      dependencies
    );

  const testCase = {
    id: "web-3",
    persona: "talent",
    goal:
      "Show a representative populated card.",
    successCriteria:
      "The selected card is visible.",
    automatedChecks: [],
    fixtureRequirements: [],
    runtimeTalentContractFixture: {
      contractId:
        "contract-test",
      talentId: "talent-test",
      jobId: "job-test",
      desiredFixture:
        "populated-work-setups",
      matchedState: true,
    },
  };

  return {
    events,
    isAttached: () => attached,
    prepare: (
      registerCleanup?: (
        cleanup: any
      ) => void
    ) =>
      provider.prepare({
        issueKey: "AS-1165",
        testCase,
        page: {} as Page,
        persona: "talent",
        baseUrl:
          "https://client.invalid",
        runtimeResourceContext: {
          companyId:
            "company-test",
        },
        ...(registerCleanup
          ? { registerCleanup }
          : {}),
      }),
  };
}

test(
  "Work Setup adapter registers exact cleanup before POST and verifies DELETE absence",
  async () => {
    const harness = buildHarness();
    const registered: any[] = [];

    const result =
      await harness.prepare(
        (cleanup) => {
          harness.events.push(
            "registered"
          );
          registered.push(cleanup);
        }
      );

    assert.equal(result.status, "READY");
    assert.equal(
      harness.events[0],
      "registered"
    );
    assert.match(
      harness.events[1]!,
      /^POST:\/companies\/company-test\/work-setups\/resource-selected\/jobs\/job-test$/
    );
    assert.equal(registered.length, 1);
    assert.equal(harness.isAttached(), true);

    const cleanupResult =
      await registered[0]!.run();

    assert.equal(
      cleanupResult.status,
      "PASS"
    );
    assert.match(
      harness.events.find(
        (event) =>
          event.startsWith("DELETE:")
      )!,
      /^DELETE:\/companies\/company-test\/work-setups\/resource-selected\/jobs\/job-test$/
    );
    assert.equal(harness.isAttached(), false);
  }
);

test(
  "Work Setup reuse owns no cleanup and performs no mutation",
  async () => {
    const harness = buildHarness({
      initiallyAttached: true,
    });

    const result =
      await harness.prepare();

    assert.equal(result.status, "READY");
    assert.equal(result.cleanups.length, 0);
    assert.equal(
      harness.events.some(
        (event) =>
          /^(?:POST|DELETE):/.test(
            event
          )
      ),
      false
    );
  }
);

test(
  "Work Setup verification failure retains exact owned cleanup",
  async () => {
    const harness = buildHarness({
      uiReady: false,
    });

    const result =
      await harness.prepare();

    assert.equal(result.status, "BLOCKED");
    assert.equal(result.cleanups.length, 1);
    assert.equal(harness.isAttached(), true);

    const cleanupResult =
      await result.cleanups[0]!.run();

    assert.equal(
      cleanupResult.status,
      "PASS"
    );
    assert.equal(harness.isAttached(), false);
  }
);
