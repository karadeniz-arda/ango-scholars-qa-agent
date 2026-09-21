import type {
  BrowserObservation,
  BrowserObservationControlKind,
  BrowserObservationSurfaceKind,
} from "./browser-observation.js";

/*
 * GENERIC_BROWSER_SURFACE_CONTROL_ASSERTION_V1
 *
 * Prove required semantic controls only inside one uniquely
 * observed semantic surface.
 *
 * A same-label control elsewhere on the page is irrelevant.
 * Ambiguity inside the requested surface fails safe.
 */

export type BrowserSurfaceControlExpectation = {
  kind: BrowserObservationControlKind;
  label: string;
};

export type BrowserSurfaceControlAssertionResult = {
  passed: boolean;
  note: string;
  surfaceCount: number;
  expectedCount: number;
  resolvedCount: number;
  missing: string[];
  ambiguous: string[];
  duplicateExpected: string[];
};

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function expectationKey(
  expectation:
    BrowserSurfaceControlExpectation
): string {
  return [
    expectation.kind,
    normalize(expectation.label),
  ].join("|");
}

function expectationLabel(
  expectation:
    BrowserSurfaceControlExpectation
): string {
  return (
    `${expectation.kind}:` +
    `${String(
      expectation.label || ""
    ).trim()}`
  );
}

export function assertSurfaceControlsInObservation(
  args: {
    observation: BrowserObservation;
    surfaceKind:
      BrowserObservationSurfaceKind;
    controls:
      BrowserSurfaceControlExpectation[];
  }
): BrowserSurfaceControlAssertionResult {
  const expected =
    Array.isArray(args.controls)
      ? args.controls.filter(
          (control) =>
            Boolean(
              normalize(control.label)
            )
        )
      : [];

  const expectedKeys =
    new Map<string, number>();

  for (const control of expected) {
    const key =
      expectationKey(control);

    expectedKeys.set(
      key,
      (expectedKeys.get(key) ?? 0) + 1
    );
  }

  const duplicateExpected =
    expected
      .filter(
        (control, index) => {
          const key =
            expectationKey(control);

          return (
            (expectedKeys.get(key) ?? 0) >
              1 &&
            expected.findIndex(
              (candidate) =>
                expectationKey(
                  candidate
                ) === key
            ) === index
          );
        }
      )
      .map(expectationLabel);

  const matchingSurfaces =
    args.observation.surfaces.filter(
      (surface) =>
        surface.kind ===
        args.surfaceKind
    );

  const surfaceCount =
    matchingSurfaces.length;

  if (
    expected.length === 0 ||
    duplicateExpected.length > 0 ||
    surfaceCount !== 1
  ) {
    const note = [
      `surface=${args.surfaceKind}`,
      `surfaceCount=${surfaceCount}`,
      `expected=${expected.length}`,
      "resolved=0",
      "missing=none",
      "ambiguous=none",
      `duplicateExpected=${
        duplicateExpected.length > 0
          ? duplicateExpected.join(",")
          : "none"
      }`,
    ].join(" | ");

    return {
      passed: false,
      note,
      surfaceCount,
      expectedCount:
        expected.length,
      resolvedCount: 0,
      missing: [],
      ambiguous: [],
      duplicateExpected,
    };
  }

  const scopedControls =
    args.observation.controls.filter(
      (control) =>
        control.surfaceKind ===
        args.surfaceKind
    );

  const missing: string[] = [];
  const ambiguous: string[] = [];
  let resolvedCount = 0;

  for (const expectedControl of expected) {
    const matches =
      scopedControls.filter(
        (observedControl) =>
          observedControl.kind ===
            expectedControl.kind &&
          normalize(
            observedControl.label
          ) ===
            normalize(
              expectedControl.label
            )
      );

    if (matches.length === 0) {
      missing.push(
        expectationLabel(
          expectedControl
        )
      );

      continue;
    }

    if (matches.length > 1) {
      ambiguous.push(
        `${expectationLabel(
          expectedControl
        )}:${matches.length}`
      );

      continue;
    }

    resolvedCount += 1;
  }

  const passed =
    missing.length === 0 &&
    ambiguous.length === 0 &&
    resolvedCount ===
      expected.length;

  const note = [
    `surface=${args.surfaceKind}`,
    `surfaceCount=${surfaceCount}`,
    `expected=${expected.length}`,
    `resolved=${resolvedCount}`,
    `missing=${
      missing.length > 0
        ? missing.join(",")
        : "none"
    }`,
    `ambiguous=${
      ambiguous.length > 0
        ? ambiguous.join(",")
        : "none"
    }`,
    "duplicateExpected=none",
  ].join(" | ");

  return {
    passed,
    note,
    surfaceCount,
    expectedCount:
      expected.length,
    resolvedCount,
    missing,
    ambiguous,
    duplicateExpected: [],
  };
}
