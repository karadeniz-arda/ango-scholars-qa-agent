import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireEphemeralFixture,
  releaseEphemeralFixture,
  runWithEphemeralFixtureLease,
  type EphemeralFixtureProvisioner,
} from "./ephemeral-fixture-lifecycle.js";

type Context = { fixtureId: string };
type Requirement = {
  fixtureType: "safe-fixture";
  sourceAuthorized: boolean;
};

const requirement: Requirement = {
  fixtureType: "safe-fixture",
  sourceAuthorized: true,
};

const permitted = {
  apiMutationsAllowed: true,
  browserMutationsAllowed: true,
  browserFixtureProvisioningAllowed: true,
  requireFixtureCleanup: true,
};

function provisioner(overrides: Partial<
  EphemeralFixtureProvisioner<Requirement, Context>
> = {}) {
  const calls = {
    create: 0,
    verifyCreated: 0,
    cleanup: [] as string[][],
    verifyCleanup: [] as string[][],
  };

  const adapter: EphemeralFixtureProvisioner<Requirement, Context> = {
    id: "safe-fixture-v1",
    channel: "API",
    supports: () => true,
    create: async () => {
      calls.create += 1;
      return {
        resourceIds: ["created-a", "created-b"],
        executionContext: { fixtureId: "created-a" },
        marker: "run-owned",
      };
    },
    verifyCreated: async () => {
      calls.verifyCreated += 1;
      return true;
    },
    cleanup: async (lease) => {
      calls.cleanup.push([...lease.resourceIds]);
      return true;
    },
    verifyCleanup: async (lease) => {
      calls.verifyCleanup.push([...lease.resourceIds]);
      return true;
    },
    ...overrides,
  };

  return { adapter, calls };
}

function args(
  adapter: EphemeralFixtureProvisioner<Requirement, Context>,
  compatible: Context[] = []
) {
  return {
    requirement,
    runId: "run-1",
    permissions: permitted,
    provisioner: adapter,
    discoverCompatible: async () =>
      compatible.map((executionContext) => ({
        resourceIds: [executionContext.fixtureId],
        executionContext,
      })),
  };
}

test("reuses one exact compatible fixture without creation or cleanup ownership", async () => {
  const { adapter, calls } = provisioner();
  const acquisition = await acquireEphemeralFixture(
    args(adapter, [{ fixtureId: "existing-1" }])
  );

  assert.equal(acquisition.status, "READY");
  assert.equal(acquisition.lease.strategy, "REUSE_EXISTING");
  assert.equal(acquisition.lease.cleanup.required, false);
  assert.equal(calls.create, 0);

  const cleanup = await releaseEphemeralFixture({
    lease: acquisition.lease,
    provisioner: adapter,
  });
  assert.equal(cleanup.status, "NOT_REQUIRED");
  assert.deepEqual(calls.cleanup, []);
});

test("creates, verifies, and leases an ephemeral fixture only when no compatible fixture exists", async () => {
  const { adapter, calls } = provisioner();
  const acquisition = await acquireEphemeralFixture(args(adapter));

  assert.equal(acquisition.status, "READY");
  assert.equal(acquisition.lease.strategy, "CREATE_EPHEMERAL");
  assert.equal(acquisition.lease.cleanup.required, true);
  assert.equal(acquisition.lease.ownership.createdByCurrentRun, true);
  assert.equal(calls.create, 1);
  assert.equal(calls.verifyCreated, 1);
  assert.ok(acquisition.telemetry.some((item) => item.event === "FIXTURE_LEASE_CREATED"));
});

test("permits an API provisioner with API authority and cleanup but no browser fixture permission", async () => {
  const { adapter, calls } = provisioner();
  const acquisition = await acquireEphemeralFixture({
    ...args(adapter),
    permissions: {
      ...permitted,
      browserFixtureProvisioningAllowed: false,
      browserMutationsAllowed: false,
    },
  });

  assert.equal(acquisition.status, "READY");
  assert.equal(calls.create, 1);
});

test("fails closed when API provisioning lacks API mutation authority", async () => {
  const { adapter, calls } = provisioner();
  const acquisition = await acquireEphemeralFixture({
    ...args(adapter),
    permissions: { ...permitted, apiMutationsAllowed: false },
  });

  assert.equal(acquisition.status, "BLOCKED");
  assert.equal(calls.create, 0);
});

test("permits a browser provisioner with browser authorities and cleanup but no API authority", async () => {
  const { adapter, calls } = provisioner({ channel: "BROWSER" });
  const acquisition = await acquireEphemeralFixture({
    ...args(adapter),
    permissions: {
      ...permitted,
      apiMutationsAllowed: false,
    },
  });

  assert.equal(acquisition.status, "READY");
  assert.equal(calls.create, 1);
});

test("fails closed when browser provisioning lacks browser fixture authority", async () => {
  const { adapter, calls } = provisioner({ channel: "BROWSER" });
  const acquisition = await acquireEphemeralFixture({
    ...args(adapter),
    permissions: {
      ...permitted,
      browserFixtureProvisioningAllowed: false,
    },
  });

  assert.equal(acquisition.status, "BLOCKED");
  assert.equal(calls.create, 0);
});

test("cleanup is mandatory for both API and browser provisioning channels", async () => {
  for (const channel of ["API", "BROWSER"] as const) {
    const { adapter, calls } = provisioner({ channel });
    const acquisition = await acquireEphemeralFixture({
      ...args(adapter),
      permissions: {
        ...permitted,
        requireFixtureCleanup: false,
      },
    });

    assert.equal(acquisition.status, "BLOCKED");
    assert.equal(calls.create, 0);
  }
});

test("fails closed when the adapter is unsupported", async () => {
  const { adapter, calls } = provisioner({ supports: () => false });
  const acquisition = await acquireEphemeralFixture(args(adapter));

  assert.equal(acquisition.status, "BLOCKED");
  assert.equal(calls.create, 0);
});

test("invalid created state blocks execution and still cleans up exact created IDs", async () => {
  const { adapter, calls } = provisioner({ verifyCreated: async () => false });
  const acquisition = await acquireEphemeralFixture(args(adapter));

  assert.equal(acquisition.status, "BLOCKED");
  assert.equal(acquisition.cleanupAudit.status, "VERIFIED");
  assert.deepEqual(calls.cleanup, [["created-a", "created-b"]]);
  assert.deepEqual(calls.verifyCleanup, [["created-a", "created-b"]]);
});

test("a PASS-like execution still performs verified cleanup", async () => {
  const { adapter, calls } = provisioner();
  const outcome = await runWithEphemeralFixtureLease({
    ...args(adapter),
    run: async () => "PASS",
  });

  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.result, "PASS");
  assert.equal(outcome.cleanupAudit.status, "VERIFIED");
  assert.deepEqual(calls.cleanup, [["created-a", "created-b"]]);
});

test("a FAIL-like execution still performs verified cleanup", async () => {
  const { adapter, calls } = provisioner();
  const outcome = await runWithEphemeralFixtureLease({
    ...args(adapter),
    run: async () => "FAIL",
  });

  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.result, "FAIL");
  assert.deepEqual(calls.cleanup, [["created-a", "created-b"]]);
});

test("an execution error still performs verified cleanup from finally", async () => {
  const { adapter, calls } = provisioner();
  const outcome = await runWithEphemeralFixtureLease({
    ...args(adapter),
    run: async () => {
      throw new Error("browser failed");
    },
  });

  assert.equal(outcome.status, "EXECUTION_ERROR");
  assert.deepEqual(calls.cleanup, [["created-a", "created-b"]]);
});

test("cleanup failure is surfaced instead of allowing a clean PASS-like outcome", async () => {
  const { adapter } = provisioner({ cleanup: async () => false });
  const outcome = await runWithEphemeralFixtureLease({
    ...args(adapter),
    run: async () => "PASS",
  });

  assert.equal(outcome.status, "CLEANUP_FAILED");
  assert.equal(outcome.result, "PASS");
  assert.equal(outcome.cleanupAudit.status, "FAILED");
});

test("reused data is never deleted", async () => {
  const { adapter, calls } = provisioner();
  const outcome = await runWithEphemeralFixtureLease({
    ...args(adapter, [{ fixtureId: "preexisting" }]),
    permissions: {
      apiMutationsAllowed: false,
      browserMutationsAllowed: false,
      browserFixtureProvisioningAllowed: false,
      requireFixtureCleanup: false,
    },
    run: async () => "PASS",
  });

  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.cleanupAudit.status, "NOT_REQUIRED");
  assert.deepEqual(calls.cleanup, []);
});

test("cleanup receives only exact resource IDs from the current lease", async () => {
  const { adapter, calls } = provisioner();
  const outcome = await runWithEphemeralFixtureLease({
    ...args(adapter),
    run: async () => "PASS",
  });

  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(calls.cleanup, [["created-a", "created-b"]]);
  assert.equal(calls.cleanup.flat().includes("unrelated-c"), false);
});

test("fixture setup creates no acceptance proof or discharge fields", async () => {
  const { adapter } = provisioner();
  const acquisition = await acquireEphemeralFixture(args(adapter));

  assert.equal(acquisition.status, "READY");
  assert.equal("deterministicEvidence" in acquisition.lease, false);
  assert.equal("acceptanceObligationIds" in acquisition.lease, false);
  assert.equal("proof" in acquisition.lease, false);
});

test("ambiguous existing fixtures remain blocked and never trigger creation", async () => {
  const { adapter, calls } = provisioner();
  const acquisition = await acquireEphemeralFixture(
    args(adapter, [
      { fixtureId: "existing-a" },
      { fixtureId: "existing-b" },
    ])
  );

  assert.equal(acquisition.status, "BLOCKED");
  assert.equal(calls.create, 0);
});
