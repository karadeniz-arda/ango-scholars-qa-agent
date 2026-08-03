import type {
  BrowserFixtureProvider,
} from "./browser-fixture-types.js";

/*
 * Providers are registered explicitly.
 *
 * Keeping this list static prevents arbitrary planner
 * output from enabling an unknown mutation capability.
 */
const browserFixtureProviders:
  BrowserFixtureProvider[] = [];

export function listBrowserFixtureProviders():
BrowserFixtureProvider[] {
  return [
    ...browserFixtureProviders,
  ];
}

export function findBrowserFixtureProvider(
  testCase: any,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): BrowserFixtureProvider | null {
  for (const provider of providers) {
    let supported = false;

    try {
      supported =
        provider.supports(testCase);
    } catch {
      supported = false;
    }

    if (supported) {
      return provider;
    }
  }

  return null;
}
