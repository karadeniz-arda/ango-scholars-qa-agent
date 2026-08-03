import {
  browserFixtureProvisioningAllowed,
} from "./browser-fixture-policy.js";
import {
  findBrowserFixtureProvider,
  listBrowserFixtureProviders,
} from "./browser-fixture-registry.js";
import type {
  BrowserFixturePreparationResult,
  BrowserFixtureProvider,
  BrowserFixtureProviderContext,
} from "./browser-fixture-types.js";

function buildNotApplicableResult():
BrowserFixturePreparationResult {
  return {
    status: "NOT_APPLICABLE",
    providerId: null,
    notes: [],
    deterministicEvidence: [],
    cleanups: [],
  };
}

export function hasBrowserFixtureProvider(
  testCase: any,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): boolean {
  return (
    findBrowserFixtureProvider(
      testCase,
      providers
    ) !== null
  );
}

export function shouldDeferBrowserFixtureBlock(
  testCase: any,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): boolean {
  return (
    browserFixtureProvisioningAllowed() &&
    hasBrowserFixtureProvider(
      testCase,
      providers
    )
  );
}

export async function prepareBrowserFixture(
  context: BrowserFixtureProviderContext,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): Promise<BrowserFixturePreparationResult> {
  if (
    !browserFixtureProvisioningAllowed()
  ) {
    return buildNotApplicableResult();
  }

  const provider =
    findBrowserFixtureProvider(
      context.testCase,
      providers
    );

  if (!provider) {
    return buildNotApplicableResult();
  }

  try {
    const result =
      await provider.prepare(context);

    return {
      ...result,
      providerId: provider.id,
    };
  } catch (error: unknown) {
    return {
      status: "ERROR",
      providerId: provider.id,
      reasonCategory:
        "FIXTURE_PROVISIONING_TECHNICAL_FAILURE",
      notes: [
        `Browser fixture provider ` +
          `"${provider.id}" threw: ` +
          `${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
      ],
      deterministicEvidence: [],
      cleanups: [],
    };
  }
}
