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

function normalizeBrowserFixtureEntryRoute(
  value: unknown
): string | null {
  const route =
    String(value || "").trim();

  if (
    !route ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    /\s/.test(route) ||
    route.includes("://") ||
    route.toUpperCase().startsWith(
      "UNKNOWN"
    )
  ) {
    return null;
  }

  return route;
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

export function resolveBrowserFixtureEntryRoute(
  context: BrowserFixtureMatchContext,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): string | null {
  if (
    !browserFixtureProvisioningAllowed()
  ) {
    return null;
  }

  const provider =
    findBrowserFixtureProvider(
      context,
      providers
    );

  if (!provider?.getEntryRoute) {
    return null;
  }

  try {
    return normalizeBrowserFixtureEntryRoute(
      provider.getEntryRoute(
        context
      )
    );
  } catch {
    return null;
  }
}

export function shouldPrepareBrowserFixture(
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

export function shouldDeferBrowserFixtureBlock(
  context: BrowserFixtureMatchContext,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): boolean {
  return shouldPrepareBrowserFixture(
    context,
    providers
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
