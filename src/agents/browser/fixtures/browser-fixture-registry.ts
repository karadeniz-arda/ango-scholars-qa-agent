import {
  talentContractWorkSetupFixtureProvider,
} from "./talent-contract-work-setup-fixture.js";
import {
  talentProfileLanguageFixtureProvider,
} from "./talent-profile-language-fixture.js";
import type {
  BrowserFixtureMatchContext,
  BrowserFixtureProvider,
} from "./browser-fixture-types.js";

/*
 * Providers are registered explicitly.
 *
 * Keeping this list static prevents arbitrary planner
 * output from enabling an unknown mutation capability.
 */
const browserFixtureProviders:
  BrowserFixtureProvider[] = [
    talentContractWorkSetupFixtureProvider,
    talentProfileLanguageFixtureProvider,
  ];

export function listBrowserFixtureProviders():
BrowserFixtureProvider[] {
  return [
    ...browserFixtureProviders,
  ];
}

export function findBrowserFixtureProvider(
  context: BrowserFixtureMatchContext,
  providers:
    BrowserFixtureProvider[] =
      listBrowserFixtureProviders()
): BrowserFixtureProvider | null {
  for (const provider of providers) {
    let supported = false;

    try {
      supported =
        provider.supports(context);
    } catch {
      supported = false;
    }

    if (supported) {
      return provider;
    }
  }

  return null;
}
