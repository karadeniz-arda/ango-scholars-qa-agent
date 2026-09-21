import assert from "node:assert/strict";
import test from "node:test";

import {
  recoverStaticSurfaceRoutes,
  type StaticSurfaceRouteSource,
} from "./static-surface-route-extraction.js";

function recover(
  ...sources: StaticSurfaceRouteSource[]
) {
  return recoverStaticSurfaceRoutes(sources);
}

const mountedTalentSources:
  StaticSurfaceRouteSource[] = [
  {
    file: "src/routes/App.routes.tsx",
    source: `
      import { TalentModuleRoutes } from "@/modules/talent/TalentRoutes";
      import Guard from "@/shared/Guard";
      export function AppRoutes() {
        return <Route path="/talent/*" element={<Guard><TalentModuleRoutes /></Guard>} />;
      }
    `,
  },
  {
    file:
      "src/modules/talent/TalentRoutes.tsx",
    source: `
      export function TalentModuleRoutes() {
        return <Routes>
          <Route element={<Layout />}>
            <Route path="assessments" element={<Assessments />} />
            <Route path="assessments/:id/prepare" element={<Prepare />} />
          </Route>
        </Routes>;
      }
    `,
  },
];

test("1 direct static route declaration is recovered", () => {
  const routes = recover({
    file: "src/routes/direct.tsx",
    source:
      '<Route path="/talent/assessments" element={<Page />} />',
  });

  assert.equal(routes[0]?.route, "/talent/assessments");
  assert.equal(routes[0]?.derivation, "DIRECT");
});

test("2 nested relative route is composed", () => {
  const routes = recover({
    file: "src/routes/nested.tsx",
    source: `
      <Route path="/talent">
        <Route path="assessments" element={<Page />} />
      </Route>
    `,
  });

  assert.ok(
    routes.some(
      (route) =>
        route.route === "/talent/assessments" &&
        route.derivation === "NESTED_COMPOSITION"
    )
  );
});

test("3 absolute child path is not double-prefixed", () => {
  const routes = recover({
    file: "src/routes/nested.tsx",
    source: `
      <Route path="/talent">
        <Route path="/company/assessments" element={<Page />} />
      </Route>
    `,
  });

  assert.ok(
    routes.some(
      (route) =>
        route.route === "/company/assessments"
    )
  );
  assert.ok(
    !routes.some((route) =>
      route.route.includes(
        "/talent/company/assessments"
      )
    )
  );
});

test("4 unrelated path literals are never composed", () => {
  const routes = recover(
    mountedTalentSources[0]!,
    {
      file:
        "src/modules/talent/TalentRoutes.tsx",
      source: `
        const unrelated = "assessments";
        export function TalentModuleRoutes() {
          return <div />;
        }
      `,
    }
  );

  assert.deepEqual(routes, []);
});

test("5 model or planner literals cannot create routes", () => {
  assert.deepEqual(
    recover({
      file: "src/routes/planner.tsx",
      source:
        'const plannerOutput = "/talent/assessments";',
    }),
    []
  );
});

test("6 comments and unrelated strings cannot create routes", () => {
  assert.deepEqual(
    recover({
      file: "src/routes/comment.tsx",
      source: `
        // <Route path="/talent/assessments" />
        const note = "/talent/assessments";
      `,
    }),
    []
  );
});

test("7 parameterized routes remain classified parameterized", () => {
  const routes = recover(
    ...mountedTalentSources
  );
  const parameterized = routes.find(
    (route) =>
      route.route ===
      "/talent/assessments/:id/prepare"
  );

  assert.equal(
    parameterized?.routeKind,
    "PARAMETERIZED"
  );
});

test("8 external URL route declarations are rejected", () => {
  assert.deepEqual(
    recover({
      file: "src/routes/external.tsx",
      source:
        '<Route path="https://example.test/talent/assessments" />',
    }),
    []
  );
});

test("9 API and resource paths are rejected", () => {
  assert.deepEqual(
    recover({
      file: "src/routes/api.tsx",
      source: `
        <Routes>
          <Route path="/api/talent/assessments" />
          <Route path="/talents/{talentId}/assessments" />
          <Route path="/companies/{companyId}/assessments" />
        </Routes>
      `,
    }),
    []
  );
});

test("10 identical source produces deterministic output", () => {
  assert.deepEqual(
    recover(...mountedTalentSources),
    recover(...mountedTalentSources)
  );
});

test("11 direct routes retain line-bounded sourceRef", () => {
  const routes = recover({
    file: "src/routes/direct.tsx",
    source:
      '\n<Route path="/talent/assessments" />',
  });

  assert.equal(
    routes[0]?.sourceRef,
    "src/routes/direct.tsx:2"
  );
});

test("12 mounted routes retain parent and child provenance", () => {
  const route = recover(
    ...mountedTalentSources
  ).find(
    (candidate) =>
      candidate.route === "/talent/assessments"
  );

  assert.equal(route?.childRoute, "assessments");
  assert.equal(route?.parentRoute, "/talent");
  assert.match(
    route?.parentSourceRef ?? "",
    /src\/routes\/App\.routes\.tsx:\d+/
  );
});

test("13 authoritative manifest origin is preserved", () => {
  const route = recover(
    ...mountedTalentSources
  ).find(
    (candidate) =>
      candidate.route === "/talent/assessments"
  );

  assert.equal(route?.origin, "UI_ROUTE_MANIFEST");
  assert.equal(route?.authoritative, true);
});

test("14 recovered metadata is bounded and contains no source blob", () => {
  const route = recover(
    ...mountedTalentSources
  ).find(
    (candidate) =>
      candidate.route === "/talent/assessments"
  );

  assert.deepEqual(
    Object.keys(route ?? {}).sort(),
    [
      "authoritative",
      "childRoute",
      "derivation",
      "origin",
      "parentRoute",
      "parentSourceRef",
      "route",
      "routeKind",
      "sourceRef",
    ]
  );
});

test("15 imported mounted route component is resolved structurally", () => {
  assert.ok(
    recover(...mountedTalentSources).some(
      (route) =>
        route.route === "/talent/assessments"
    )
  );
});

test("16 pathless layout routes preserve outer mount provenance", () => {
  const route = recover(
    ...mountedTalentSources
  ).find(
    (candidate) =>
      candidate.route === "/talent/assessments"
  );

  assert.match(
    route?.parentSourceRef ?? "",
    /App\.routes\.tsx/
  );
});

test("17 duplicate direct and composed routes deduplicate deterministically", () => {
  const routes = recover(
    ...mountedTalentSources,
    {
      file: "src/routes/direct.tsx",
      source:
        '<Route path="/talent/assessments" />',
    }
  ).filter(
    (route) =>
      route.route === "/talent/assessments"
  );

  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.derivation, "DIRECT");
});

test("18 competing structural routes remain separate", () => {
  const routes = recover({
    file: "src/routes/competing.tsx",
    source: `
      <Routes>
        <Route path="/talent/assessments" />
        <Route path="/talent/assessment-history" />
      </Routes>
    `,
  });

  assert.deepEqual(
    routes.map((route) => route.route),
    [
      "/talent/assessment-history",
      "/talent/assessments",
    ]
  );
});

test("19 index routes do not invent a new path", () => {
  const routes = recover({
    file: "src/routes/index.tsx",
    source: `
      <Route path="/talent/assessments">
        <Route index element={<List />} />
      </Route>
    `,
  });

  assert.deepEqual(
    routes.map((route) => route.route),
    ["/talent/assessments"]
  );
});

test("20 cyclic mounted component imports fail closed", () => {
  const routes = recover(
    {
      file: "src/routes/A.tsx",
      source: `
        import B from "./B";
        <Route path="/talent/*" element={<B />} />;
      `,
    },
    {
      file: "src/routes/B.tsx",
      source: `
        import A from "./A";
        <Route path="loop/*" element={<A />} />;
      `,
    }
  );

  assert.deepEqual(routes, []);
});

test("21 mounted page component identity is retained as bounded route metadata", () => {
  const route = recover(
    {
      file: "src/routes/company.tsx",
      source: `import JobDetails from "../modules/JobDetails"; <Route path="/company/jobs/:id" element={<JobDetails />} />`,
    },
    {
      file: "src/modules/JobDetails.tsx",
      source: "export default function JobDetails() { return null; }",
    },
  )[0];
  assert.deepEqual(route?.mountedComponents, ["JobDetails"]);
});


test("mounted component sources follow import paths including renamed local imports", () => {
  const routes = recoverStaticSurfaceRoutes([
    { file: "src/routes/App.tsx", source: `
      import PersonalPage from '../talent/Overview';
      import CompanyPage from '../company/Overview';
      const routes = <><Route path="/talent/overview" element={<PersonalPage />} />
        <Route path="/company/overview" element={<CompanyPage />} /></>;
    ` },
    { file: "src/talent/Overview.tsx", source: "export default function Overview() { return null; }" },
    { file: "src/company/Overview.tsx", source: "export default function Overview() { return null; }" },
  ]);
  assert.deepEqual(routes.find((route) => route.route === "/talent/overview")?.mountedComponentSources,
    [{ componentName: "PersonalPage", file: "src/talent/Overview.tsx" }]);
  assert.deepEqual(routes.find((route) => route.route === "/company/overview")?.mountedComponentSources,
    [{ componentName: "CompanyPage", file: "src/company/Overview.tsx" }]);
});
