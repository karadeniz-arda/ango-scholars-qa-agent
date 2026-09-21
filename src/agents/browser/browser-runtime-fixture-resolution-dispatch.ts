import type { Page } from "playwright";

import type {
  BrowserTestCase,
} from "../../planner/types.js";
import {
  resolveAndOpenInvoiceRow,
  type InvoiceInteractionResult,
} from "./browser-entity-interaction.js";
import {
  runtimeFixturePreparationAllowsInteraction,
  type BrowserRuntimeFixturePreparationResult,
} from "./browser-runtime-fixture-preparation.js";

export type BrowserRuntimeFixtureResolutionDispatchResult = {
  status: "NOT_REQUIRED" | "READY" | "BLOCKED";
  preparations: BrowserRuntimeFixturePreparationResult[];
  note: string;
};

type InvoiceResolver = (
  page: Page,
  testCase: BrowserTestCase,
  requestedText: string,
  options: { executionPersona?: string | null }
) => Promise<InvoiceInteractionResult>;

function result(
  status: BrowserRuntimeFixtureResolutionDispatchResult["status"],
  note: string,
  preparations: BrowserRuntimeFixturePreparationResult[] = []
): BrowserRuntimeFixtureResolutionDispatchResult {
  return { status, preparations, note };
}

export function mergeRuntimeFixturePreparations(
  ...groups: BrowserRuntimeFixturePreparationResult[][]
): BrowserRuntimeFixturePreparationResult[] {
  const seen = new Set<string>();
  const merged: BrowserRuntimeFixturePreparationResult[] = [];

  for (const preparation of groups.flat()) {
    const key = [
      preparation.caseId,
      preparation.binding?.executionCaseId ?? "",
      preparation.selectedIdentity ?? "",
      preparation.preparedAt,
      preparation.evidenceRef ?? "",
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(preparation);
    }
  }

  return merged;
}

/**
 * Resolves only an already source-authorized runtime fixture before bounded
 * generic navigation. This is not fixture provisioning and never receives a
 * model or planner target string as an entity-selection input.
 */
export async function dispatchBrowserRuntimeFixtureResolution(args: {
  page: Page;
  testCase: BrowserTestCase;
  actualPersona: string | null | undefined;
  resolveInvoice?: InvoiceResolver;
}): Promise<BrowserRuntimeFixtureResolutionDispatchResult> {
  const contract = args.testCase.runtimeFixtureResolutionContract;

  if (
    !contract ||
    args.testCase.executionPolicy?.lane === "DISCOVERY_ONLY" ||
    args.testCase.composedRuntimeResolution
  ) {
    return result(
      "NOT_REQUIRED",
      "No standalone trusted runtime fixture dispatch is required."
    );
  }

  if (
    contract.status !== "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" ||
    contract.policy !== "ALL_REQUIRED" ||
    contract.members.length !== 1
  ) {
    return result(
      "BLOCKED",
      "Runtime fixture resolution contract is malformed or unsupported; no resolver was invoked."
    );
  }

  const member = contract.members[0];
  const capability = member?.fixtureResolutionCapability;

  if (!member?.required || !capability) {
    return result(
      "BLOCKED",
      "Runtime fixture resolution capability is missing; no resolver was guessed."
    );
  }

  switch (capability.resolverRef) {
    case "browser-visible-invoice-row": {
      const invoiceResult = await (args.resolveInvoice ?? resolveAndOpenInvoiceRow)(
        args.page,
        args.testCase,
        "",
        {
          ...(args.actualPersona !== undefined
            ? { executionPersona: args.actualPersona }
            : {}),
        }
      );
      const preparation = invoiceResult.runtimeFixturePreparation;
      const preparations = preparation ? [preparation] : [];

      if (
        invoiceResult.status !== "OPENED" ||
        !preparation ||
        !runtimeFixturePreparationAllowsInteraction(preparation) ||
        invoiceResult.selectedInvoice !== preparation.selectedIdentity ||
        invoiceResult.selectedInvoice !== preparation.binding?.fixtureIdentityRef
      ) {
        return result(
          "BLOCKED",
          "Runtime fixture resolver did not open the exact resolved fixture identity; generic execution was not started.",
          preparations
        );
      }

      return result(
        "READY",
        "Runtime fixture resolver opened the exact unique bound entity before generic execution.",
        preparations
      );
    }

    case "talent-contract-detail-readonly-v1":
      return result(
        "BLOCKED",
        "Talent-contract fixture resolution belongs to the composed runtime path; no invoice adapter was used."
      );

    default:
      return result(
        "BLOCKED",
        "Runtime fixture resolver is unsupported; no resolver was guessed."
      );
  }
}
