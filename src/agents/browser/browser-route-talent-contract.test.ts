import assert from "node:assert/strict";
import test from "node:test";

import {
  selectTalentContractFixture,
} from "./browser-route-talent-contract.js";

const contract = {
  id: 42,
  status: "active",
  job: {
    id: 9,
    title: "Senior Reviewer",
  },
};

test("contract adapter binds one authenticated talent-owned identity", () => {
  const result =
    selectTalentContractFixture(
      [contract],
      [],
      "any",
      "talent-7",
      {}
    );

  assert.equal(
    result.deepRouteBinding.status,
    "RESOLVED"
  );
  assert.equal(
    result.deepRouteBinding.boundRoute
      ?.route,
    "/talent/contracts/42"
  );
  assert.equal(
    result.deepRouteBinding.boundRoute
      ?.targetIdentity?.value,
    "Senior Reviewer"
  );
});

test("contract adapter never falls back to the first candidate", () => {
  const result =
    selectTalentContractFixture(
      [
        contract,
        {
          ...contract,
          id: 43,
          job: {
            id: 10,
            title: "Content Reviewer",
          },
        },
      ],
      [],
      "any",
      "talent-7",
      {}
    );

  assert.equal(
    result.deepRouteBinding.status,
    "AMBIGUOUS_ENTITY"
  );
  assert.equal(result.selected, undefined);
});

test("contract adapter selects an exactly verified coarse state only when unique", () => {
  const result =
    selectTalentContractFixture(
      [
        contract,
        {
          ...contract,
          id: 43,
          status: "closed",
        },
      ],
      [],
      "active-or-started",
      "talent-7",
      {}
    );

  assert.equal(
    result.deepRouteBinding.status,
    "RESOLVED"
  );
  assert.equal(
    result.deepRouteBinding.boundRoute
      ?.bindings.contractId,
    "42"
  );
});

test("exact fixture policy stops when no authoritative exact identity is supplied", () => {
  const result =
    selectTalentContractFixture(
      [contract],
      [],
      "any",
      "talent-7",
      {
        runtimeFixturePolicy: "exact",
      }
    );

  assert.equal(
    result.deepRouteBinding.status,
    "NO_COMPATIBLE_ENTITY"
  );
  assert.equal(result.selected, undefined);
});

test("work-setup relationship state is derived without selecting by DOM or list order", () => {
  const result =
    selectTalentContractFixture(
      [contract],
      [
        {
          contractId: 42,
        },
      ],
      "populated-work-setups",
      "talent-7",
      {}
    );

  assert.equal(
    result.deepRouteBinding.status,
    "RESOLVED"
  );
  assert.equal(
    result.populatedContractCount,
    1
  );
});
