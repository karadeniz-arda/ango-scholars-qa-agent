import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyVisibleRuntimeFilterSelection,
} from "./runtime-filter-interaction.js";
import {
  selectNativeOption,
} from "./runtime-filter-option-selection.js";

function nativeControl(observedLabel: string): any {
  return {
    locator(selector: string) {
      if (selector === "option") {
        return {
          async evaluateAll() {
            return [
              {
                label: "Current",
                value: "current",
                selected: true,
                disabled: false,
              },
              {
                label: "Active",
                value: "active",
                selected: false,
                disabled: false,
              },
            ];
          },
        };
      }

      assert.equal(selector, "option:checked");
      return {
        async textContent() {
          return observedLabel;
        },
      };
    },
    async selectOption(selection: any) {
      assert.deepEqual(selection, {
        value: "active",
      });
    },
    async inputValue() {
      return "active";
    },
  };
}

function pageWithSelectedNodes(): any {
  return {
    url() {
      return "https://example.test/items";
    },
    async waitForTimeout() {},
    locator() {
      return {
        async count() {
          return 0;
        },
        nth() {
          throw new Error("No selected node expected");
        },
      };
    },
  };
}

function customControl(observedLabel: string): any {
  return {
    async isVisible() {
      return true;
    },
    async innerText() {
      return observedLabel;
    },
    async inputValue() {
      return "";
    },
  };
}

test(
  "native visible-state selection requires the exact selected label",
  async () => {
    const passed = await selectNativeOption(
      pageWithSelectedNodes(),
      nativeControl("Active"),
      "status",
      "visible-state"
    );
    const failed = await selectNativeOption(
      pageWithSelectedNodes(),
      nativeControl("Inactive"),
      "status",
      "visible-state"
    );

    assert.equal(passed.visibleStateVerified, true);
    assert.equal(passed.observedSelectedLabel, "Active");
    assert.equal(failed.visibleStateVerified, false);
    assert.equal(failed.observedSelectedLabel, "Inactive");
  }
);

test(
  "custom visible-state selection requires a newly observed exact label",
  async () => {
    const before = {
      controlLabels: ["Select status"],
      selectedLabels: [],
    };
    const passed = await verifyVisibleRuntimeFilterSelection(
      pageWithSelectedNodes(),
      "Active",
      before,
      customControl("Active")
    );
    const failed = await verifyVisibleRuntimeFilterSelection(
      pageWithSelectedNodes(),
      "Active",
      before,
      customControl("Inactive")
    );
    const alreadyPresent = await verifyVisibleRuntimeFilterSelection(
      pageWithSelectedNodes(),
      "Active",
      {
        controlLabels: ["Active"],
        selectedLabels: [],
      },
      customControl("Active")
    );

    assert.equal(passed.visibleStateVerified, true);
    assert.equal(passed.observedSelectedLabel, "Active");
    assert.equal(failed.visibleStateVerified, false);
    assert.equal(failed.observedSelectedLabel, null);
    assert.equal(alreadyPresent.visibleStateVerified, false);
  }
);
