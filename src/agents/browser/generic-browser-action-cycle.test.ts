import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenericBrowserActionSignature,
} from "./generic-browser-action-cycle.js";

test(
  "allows the same label when evaluator grounds a different semantic control kind",
  () => {
    const action = {
      kind: "click",
      target: "Latest",
    };

    const menuitem =
      buildGenericBrowserActionSignature(
        action,
        {
          source: "control",
          label: "Latest",
          kind: "menuitem",
        }
      );

    const button =
      buildGenericBrowserActionSignature(
        action,
        {
          source: "control",
          label: "Latest",
          kind: "button",
        }
      );

    assert.notEqual(
      menuitem,
      button
    );
  }
);

test(
  "still detects repetition for the same exact semantic control",
  () => {
    const action = {
      kind: "click",
      target: "Latest",
    };

    const first =
      buildGenericBrowserActionSignature(
        action,
        {
          source: "control",
          label: "Latest",
          kind: "button",
        }
      );

    const repeated =
      buildGenericBrowserActionSignature(
        action,
        {
          source: "control",
          label: "Latest",
          kind: "button",
        }
      );

    assert.equal(
      first,
      repeated
    );
  }
);

test(
  "preserves action value and semantic context in the cycle identity",
  () => {
    const first =
      buildGenericBrowserActionSignature(
        {
          kind: "click",
          target: "Open",
          contextText: "Newest",
        },
        {
          source: "control",
          label: "Open",
          kind: "button",
          contextText: "Newest",
        }
      );

    const second =
      buildGenericBrowserActionSignature(
        {
          kind: "click",
          target: "Open",
          contextText: "Oldest",
        },
        {
          source: "control",
          label: "Open",
          kind: "button",
          contextText: "Oldest",
        }
      );

    assert.notEqual(
      first,
      second
    );
  }
);
