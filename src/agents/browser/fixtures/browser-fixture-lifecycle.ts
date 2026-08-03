import {
  browserFixtureProvisioningAllowed,
} from "./browser-fixture-policy.js";
import {
  findBrowserFixtureProvider,
  listBrowserFixtureProviders,
} from "./browser-fixture-registry.js";
import type {
  BrowserFixtureMatchContext,
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
  context: BrowserFixtureMatchContext,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): boolean {
  return (
    findBrowserFixtureProvider(
      context,
      providers
    ) !== null
  );
}

export function shouldDeferBrowserFixtureBlock(
  context: BrowserFixtureMatchContext,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): boolean {
  return (
    browserFixtureProvisioningAllowed() &&
    hasBrowserFixtureProvider(
      context,
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
      context,
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
