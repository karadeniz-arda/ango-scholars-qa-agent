import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test(
  "model-facing safety contract distinguishes transient reveal from value mutation",
  () => {
    const source =
      fs.readFileSync(
        "src/agents/browser/browser-agent-shadow.ts",
        "utf8"
      );

    assert.match(
      source,
      /GENERIC_BROWSER_MODEL_SAFETY_CONTRACT_PARITY_V1/
    );

    assert.match(
      source,
      /changing a selected value or filled form value is outside the current execution phase/
    );

    assert.match(
      source,
      /Do not propose fill, select, an observed option activation, or an externalPopup control activation/
    );

    assert.match(
      source,
      /Opening or revealing transient UI state is not itself a selected-value or form-value mutation/
    );

    assert.match(
      source,
      /role=tab click that only switches the active read-only view is a transient navigation candidate/
    );

    assert.match(
      source,
      /consequence-bearing, disabled, or ambiguous tab controls remain ineligible/
    );

    assert.match(
      source,
      /activationSafe=true/
    );

    assert.match(
      source,
      /Do not treat a popup becoming visible as mutation-required by itself/
    );

    assert.match(
      source,
      /The deterministic evaluator and executor remain authoritative/
    );

    assert.equal(
      source.includes(
        "changing popup or form selection state is outside the current execution phase"
      ),
      false
    );

    assert.equal(
      source.includes(
        "tabs are always safe"
      ),
      false
    );
  }
);
