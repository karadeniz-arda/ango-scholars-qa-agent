import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSourceBackedSurfaceIdentities,
  matchSourceBackedSurfaceIdentity,
} from "./source-surface-provenance.js";

const sources = [
  {
    file: "src/routes/utils/document-title.utils.ts",
    source: "const titles = [{ path: '/talent/profile', title: 'Profile' }];",
  },
  {
    file: "src/layout/app-layout/SidebarConfig.tsx",
    source: "const menu = [{ key: '/talent/profile', label: 'Profile' }];",
  },
  {
    file: "src/modules/talent/profile/routes/TalentProfile.route.tsx",
    source: "const messages = { language: { defaultMessage: 'Skills & Languages' } };",
  },
];

test("source surface identity retains independent route/title/navigation provenance", () => {
  const identity = extractSourceBackedSurfaceIdentities({
    routes: [{
      route: "/talent/profile",
      persona: "talent",
      mountedComponents: ["TalentProfile"],
      mountedComponentSources: [{ componentName: "TalentProfile", file: sources[2]!.file }],
    }],
    sources,
  })[0]!;

  assert.equal(identity.routeRef, "/talent/profile");
  assert.equal(identity.authority, "SOURCE_CORROBORATION");
  assert.ok(identity.provenance.some((item) => item.evidenceKind === "DOCUMENT_TITLE"));
  assert.ok(identity.provenance.some((item) => item.evidenceKind === "NAVIGATION_LABEL"));
  assert.ok(identity.provenance.some((item) => item.value === "Skills & Languages"));
  assert.equal(
    matchSourceBackedSurfaceIdentity({
      requestedSurface: "Talent or scholar profile language section",
      identity,
    }).matched,
    true
  );
});

test("one generic token or unproven prose cannot corroborate a surface", () => {
  const identity = extractSourceBackedSurfaceIdentities({
    routes: [{ route: "/talent/profile", persona: "talent" }],
    sources,
  })[0]!;

  assert.equal(
    matchSourceBackedSurfaceIdentity({ requestedSurface: "Profile", identity }).matched,
    false
  );
  assert.equal(
    matchSourceBackedSurfaceIdentity({ requestedSurface: "A prose-only language surface", identity }).matched,
    false
  );
});

test("surface identity output is deterministic and does not contain candidate text", () => {
  const input = {
    routes: [{ route: "/talent/profile", persona: "talent" as const }],
    sources,
  };
  const first = extractSourceBackedSurfaceIdentities(input);
  const second = extractSourceBackedSurfaceIdentities(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("candidate"), false);
  assert.equal(JSON.stringify(first).includes("Jira"), false);
});


// These fixtures intentionally use misleading labels and identical basenames.
test("mounted labels require the exact imported file, never a matching basename", () => {
  const identities = extractSourceBackedSurfaceIdentities({
    routes: [{ route: "/talent/overview", file: "src/routes.tsx", persona: "talent",
      mountedComponents: ["Overview"],
      mountedComponentSources: [{ componentName: "Overview", file: "src/talent/Overview.tsx" }] }],
    sources: [
      { file: "src/talent/Overview.tsx", source: "const m = { title: 'Personal Overview' };" },
      { file: "src/company/Overview.tsx", source: "const m = { title: 'Payroll Administration', label: 'Payroll Accounts' };" },
    ],
  });
  assert.ok(identities[0]?.aliases.includes("Personal Overview"));
  assert.ok(!identities[0]?.aliases.some((value) => value.includes("Payroll")));
  assert.equal(matchSourceBackedSurfaceIdentity({ requestedSurface: "Payroll administration accounts", identity: identities[0]! }).matched, false);
  const noImport = extractSourceBackedSurfaceIdentities({
    routes: [{ route: "/talent/overview", file: "src/routes.tsx", mountedComponents: ["Overview"] }],
    sources: [{ file: "src/company/Overview.tsx", source: "const m = { title: 'Payroll Administration' };" }],
  });
  assert.deepEqual(noImport[0]?.aliases, ["overview"]);
});

test("route-file labels and adjacent object labels cannot cross route boundaries", () => {
  const identities = extractSourceBackedSurfaceIdentities({
    routes: ["/talent/overview", "/talent/billing"].map((route) => ({ route, file: "src/routes.tsx" })),
    sources: [{ file: "src/routes.tsx", source: `
      const routes = [{ path: '/talent/overview', title: 'Personal Overview' },
        { path: '/talent/billing', title: 'Billing Accounts' }];
      const menus = [{ key: '/talent/overview' }, { key: '/talent/billing', label: 'Billing Accounts' }];
      const unrelated = { defaultMessage: 'Payroll Administration' };
    ` }],
  });
  assert.ok(identities[0]?.aliases.includes("Personal Overview"));
  assert.ok(!identities[0]?.aliases.includes("Billing Accounts"));
  assert.ok(identities.every((identity) => !identity.aliases.includes("Payroll Administration")));
});

test("comments, prose strings, and computed label values do not become source evidence", () => {
  const identity = extractSourceBackedSurfaceIdentities({
    routes: [{ route: "/talent/overview", file: "src/routes.tsx" }],
    sources: [{ file: "src/routes.tsx", source: `
      // { path: '/talent/overview', title: 'Payroll Administration' }
      const prose = "{ key: '/talent/overview', label: 'Payroll Accounts' }";
      const dynamic = { path: '/talent/overview', title: getTitle() };
    ` }],
  })[0]!;
  assert.deepEqual(identity.aliases, ["overview"]);
});

test("generic one-word identities cannot bridge unrelated multi-word labels", () => {
  for (const token of ["search", "work", "change", "payments"]) {
    const identity = {
      canonicalSurface: token, aliases: [token, "Account Summary"], routeRef: "/talent/overview",
      persona: "talent" as const, authority: "SOURCE_CORROBORATION" as const,
      evidenceKind: "DOCUMENT_TITLE" as const,
      provenance: [
        { sourceRef: "src/titles.ts:1", evidenceKind: "DOCUMENT_TITLE" as const, value: token },
        { sourceRef: "src/page.tsx:2", evidenceKind: "TAB_LABEL" as const, value: "Account Summary" },
      ],
    };
    assert.equal(matchSourceBackedSurfaceIdentity({ requestedSurface: `${token} account screen`, identity }).matched, false);
  }
});

test("shared multi-word component identity must be fully covered by the request", () => {
  const identity = {
    canonicalSurface: "Company Contract Details", aliases: ["Company Contract Details", "Skills & Languages"],
    routeRef: "/company/contracts/:contractId", persona: "company_admin" as const,
    authority: "SOURCE_CORROBORATION" as const, evidenceKind: "PAGE_COMPONENT_IDENTITY" as const,
    provenance: [
      { sourceRef: "src/page.tsx", evidenceKind: "PAGE_COMPONENT_IDENTITY" as const, value: "Company Contract Details" },
      { sourceRef: "src/page.tsx:2", evidenceKind: "TAB_LABEL" as const, value: "Skills & Languages" },
    ],
  };
  assert.equal(matchSourceBackedSurfaceIdentity({ requestedSurface: "Company profile language section", identity }).matched, false);
});


test("spread overrides cannot establish a static route-label association", () => {
  const identities = extractSourceBackedSurfaceIdentities({
    routes: [{ route: "/talent/overview" }],
    sources: [{ file: "src/nav.ts", source: `
      const labels = [{ path: '/talent/overview', title: 'Personal Overview', ...unknown },
        { key: '/talent/overview', label: 'Personal Overview', ...unknown }];
    ` }],
  });
  assert.deepEqual(identities, []);
});

test("a shared child label cannot erase an unsupported parent surface", () => {
  const identity = {
    canonicalSurface: "Work Setups", aliases: ["Work Setups", "work setups"],
    routeRef: "/company/work-setups", persona: "company_admin" as const,
    authority: "SOURCE_CORROBORATION" as const, evidenceKind: "DOCUMENT_TITLE" as const,
    provenance: [
      { sourceRef: "src/titles.ts:1", evidenceKind: "DOCUMENT_TITLE" as const, value: "Work Setups" },
      { sourceRef: "src/routes.tsx:2", evidenceKind: "ROUTE_DECLARED_LABEL" as const, value: "work setups" },
    ],
  };
  assert.equal(matchSourceBackedSurfaceIdentity({ requestedSurface: "Job wizard Work Setups step", identity }).matched, false);
  assert.equal(matchSourceBackedSurfaceIdentity({ requestedSurface: "Work Setups page", identity }).matched, true);
});

test("persona plus a shared resource token does not ground an editor on a list page", () => {
  const identity = {
    canonicalSurface: "Assessments", aliases: ["Assessments", "Talent Assessments"],
    routeRef: "/talent/assessments", persona: "talent" as const,
    authority: "SOURCE_CORROBORATION" as const, evidenceKind: "DOCUMENT_TITLE" as const,
    provenance: [
      { sourceRef: "src/titles.ts:1", evidenceKind: "DOCUMENT_TITLE" as const, value: "Assessments" },
      { sourceRef: "src/page.tsx:2", evidenceKind: "PAGE_COMPONENT_IDENTITY" as const, value: "Talent Assessments" },
    ],
  };
  assert.equal(matchSourceBackedSurfaceIdentity({ requestedSurface: "Talent assessment answer editor", identity }).matched, false);
});
