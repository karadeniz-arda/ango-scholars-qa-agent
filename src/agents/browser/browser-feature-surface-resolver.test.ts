import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserObservation,
} from "./browser-observation.js";
import {
  observationHasControl,
  selectFeatureSurfaceCandidate,
} from "./browser-feature-surface-resolver.js";

function observation(
  controls: BrowserObservation["controls"]
): BrowserObservation {
  return {
    url: "https://client.invalid/company/all-jobs",
    title: "All Jobs",
    headings: ["All Jobs"],
    controls,
    inputs: [],
    surfaces: [],
    visibleText: [],
    counts: {
      headings: 1,
      controls: controls.length,
      inputs: 0,
      surfaces: 0,
      visibleText: 0,
    },
  };
}

test(
  "recognizes icon metadata from the filter semantic family",
  () => {
    const page = observation([
      {
        kind: "button",
        label: "lucide lucide-funnel funnel",
        role: "button",
        disabled: false,
        selected: false,
        expanded: null,
        checked: null,
      },
    ]);

    assert.equal(
      observationHasControl(page, "Filters"),
      true
    );
  }
);

test(
  "selects a safe observed feature control named by requirements",
  () => {
    const result =
      selectFeatureSurfaceCandidate(
        observation([
          {
            kind: "tab",
            label: "All Jobs",
            role: "tab",
            disabled: false,
            selected: true,
            expanded: null,
            checked: null,
          },
          {
            kind: "tab",
            label: "Change Requests",
            role: "tab",
            disabled: false,
            selected: false,
            expanded: null,
            checked: null,
          },
          {
            kind: "button",
            label: "Publish request",
            role: "button",
            disabled: false,
            selected: false,
            expanded: null,
            checked: null,
          },
        ]),
        "On the job change requests table, open Filters and select a type.",
        "Filters"
      );

    assert.equal(
      result.candidate?.label,
      "Change Requests"
    );
  }
);

test(
  "blocks equally ranked semantic candidates instead of using DOM order",
  () => {
    const result =
      selectFeatureSurfaceCandidate(
        observation([
          {
            kind: "tab",
            label: "Alpha Requests",
            role: "tab",
            disabled: false,
            selected: false,
            expanded: null,
            checked: null,
          },
          {
            kind: "tab",
            label: "Bravo Requests",
            role: "tab",
            disabled: false,
            selected: false,
            expanded: null,
            checked: null,
          },
        ]),
        "Alpha Requests Bravo Requests",
        "Filters"
      );

    assert.equal(
      result.candidate,
      undefined
    );
    assert.match(
      result.reason,
      /ambiguous/i
    );
  }
);

test(
  "rejects consequential controls even when requirements name them",
  () => {
    const result =
      selectFeatureSurfaceCandidate(
        observation([
          {
            kind: "button",
            label: "Publish request",
            role: "button",
            disabled: false,
            selected: false,
            expanded: null,
            checked: null,
          },
        ]),
        "Publish request before opening Filters.",
        "Filters"
      );

    assert.equal(
      result.candidate,
      undefined
    );
  }
);
