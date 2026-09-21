import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  classifyGenericBrowserActionSafety,
} from "./generic-browser-action-safety.js";

test(
  "classifies an activation-safe input click as transient reveal",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "input",
        label: "Select language",
        activationSafe: true,
      }),
      "TRANSIENT_REVEAL"
    );
  }
);

test(
  "classifies an ordinary non-consequential control click as transient reveal",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "button",
        label: "Details",
      }),
      "TRANSIENT_REVEAL"
    );
  }
);

test(
  "classifies an external popup control click as transient value change",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "menuitem",
        label: "Active",
        externalPopup: true,
      }),
      "TRANSIENT_VALUE_CHANGE"
    );
  }
);

test(
  "classifies an ordinary option click as transient value change",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "option",
        label: "English",
      }),
      "TRANSIENT_VALUE_CHANGE"
    );
  }
);

test(
  "preserves the semantic-bound-option lexical exception",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "option",
        label: "Publish",
        semanticOptionBinding: true,
      }),
      "TRANSIENT_VALUE_CHANGE"
    );
  }
);

test(
  "does not grant the lexical exception to an ordinary consequential option",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "option",
        label: "Publish",
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "keeps a source-bound Update semantic option transient",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "option",
        label: "Update",
        semanticOptionBinding: true,
      }),
      "TRANSIENT_VALUE_CHANGE"
    );
  }
);

test(
  "keeps an ordinary Update button consequential",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "button",
        label: "Update",
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "does not grant Update option safety without semantic binding",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "option",
        label: "Update",
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "keeps a source-bound Publish semantic option transient",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "option",
        label: "Publish",
        semanticOptionBinding: true,
      }),
      "TRANSIENT_VALUE_CHANGE"
    );
  }
);

test(
  "keeps an ordinary Publish button consequential",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "button",
        label: "Publish",
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "classifies select as transient value change without authorizing it",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "select",
        targetSource: "control",
        targetKind: "option",
        label: "English",
      }),
      "TRANSIENT_VALUE_CHANGE"
    );
  }
);

test(
  "classifies fill as persisted or consequential change",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "fill",
        targetSource: "input",
        label: "Job title",
        activationSafe: false,
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "classifies ordinary Save click as persisted or consequential change",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "button",
        label: "Save",
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "fails closed for a non-activation-safe input click",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "input",
        label: "Search",
        activationSafe: false,
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "fails closed for an unknown executable action kind",
  () => {
    assert.equal(
      classifyGenericBrowserActionSafety({
        actionKind: "drag",
        targetSource: "control",
        targetKind: "button",
        label: "Details",
      }),
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    );
  }
);

test(
  "keeps safety classification independent from mutation permission",
  () => {
    const source =
      fs.readFileSync(
        "src/agents/browser/generic-browser-action-safety.ts",
        "utf8"
      );

    assert.equal(
      source.includes(
        "browserMutationsAllowed"
      ),
      false
    );

    assert.equal(
      source.includes("process.env"),
      false
    );
  }
);
