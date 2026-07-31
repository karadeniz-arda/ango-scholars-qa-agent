export type ProductFinding = {
  classification: "PRODUCT_BUG";
  confidence: "low" | "medium" | "high";
  summary: string;
  expectedBehavior: string;
  actualBehavior: string;
  reproductionSteps: string[];
  evidence: string[];
  likelyArea?: string;
};

function normalizeStringList(
  value: unknown
): string[] {
  const values =
    Array.isArray(value)
      ? value
      : [];

  return [
    ...new Set(
      values
        .map((item) =>
          String(item ?? "").trim()
        )
        .filter(Boolean)
    ),
  ];
}

function formatBrowserStep(
  step: any
): string | null {
  const action =
    String(step?.action || "").trim();

  if (!action || action === "wait") {
    return null;
  }

  const details = [
    step?.text
      ? `text="${String(step.text)}"`
      : "",
    step?.target
      ? `target="${String(step.target)}"`
      : "",
    step?.queryKey
      ? `queryKey="${String(
          step.queryKey
        )}"`
      : "",
    step?.origin
      ? `origin="${String(step.origin)}"`
      : "",
  ].filter(Boolean);

  return details.length > 0
    ? `${action}: ${details.join(", ")}`
    : action;
}

export function buildProductFindings(
  args: {
    issueId: string;
    plan: any;
    browserResults: any[];
  }
): ProductFinding[] {
  const browserCases =
    Array.isArray(
      args.plan?.browserCases
    )
      ? args.plan.browserCases
      : [];

  const browserResults =
    Array.isArray(args.browserResults)
      ? args.browserResults
      : [];

  return browserResults.flatMap(
    (result): ProductFinding[] => {
      const review =
        result?.evidenceReview;

      /*
       * A vision verdict alone must not create a
       * product finding. Reconciliation must already
       * have retained the runner result as FAIL.
       */
      if (
        result?.status !== "FAIL" ||
        review?.verdict !==
          "PRODUCT_BUG" ||
        review?.confidence !== "high"
      ) {
        return [];
      }

      const testCase =
        browserCases.find(
          (item: any) =>
            item?.id === result?.id
        ) ?? {};

      const automatedChecks =
        normalizeStringList(
          testCase?.automatedChecks
        );

      const expectedBehavior =
        automatedChecks.length > 0
          ? automatedChecks.join(" ")
          : String(
              testCase
                ?.successCriteria ||
                testCase?.goal ||
                ""
            ).trim();

      const actualBehavior =
        String(
          review?.rationale ||
            result?.notes ||
            "The observed product behavior did not match the automated expectation."
        ).trim();

      const route =
        String(
          result?.startRoute ||
            testCase?.startRoute ||
            ""
        ).trim();

      const reproductionSteps = [
        testCase?.persona
          ? `Sign in as ${String(
              testCase.persona
            )}.`
          : "",
        route &&
        route.toUpperCase() !==
          "UNKNOWN"
          ? `Open ${route}.`
          : "",
        ...(
          Array.isArray(
            testCase?.steps
          )
            ? testCase.steps
                .map(
                  formatBrowserStep
                )
                .filter(Boolean)
            : []
        ),
      ].filter(
        (item): item is string =>
          Boolean(item)
      );

      const failedMachineEvidence =
        Array.isArray(
          result?.deterministicEvidence
        )
          ? result.deterministicEvidence
              .filter(
                (item: any) =>
                  item?.passed === false
              )
              .map(
                (item: any) =>
                  `${String(
                    item?.action ||
                      "assertion"
                  )} expected ` +
                  `"${String(
                    item?.expected ||
                      ""
                  )}": ` +
                  `${String(
                    item?.note ||
                      item?.actualUrl ||
                      "failed"
                  )}`
              )
          : [];

      const screenshotEvidence =
        Array.isArray(
          result?.checkpointEvidence
        )
          ? result.checkpointEvidence
              .map((checkpoint: any) => {
                const path =
                  String(
                    checkpoint
                      ?.screenshotPath ||
                      ""
                  ).trim();

                if (!path) {
                  return "";
                }

                return (
                  `Screenshot after ` +
                  `${String(
                    checkpoint?.label ||
                      "browser step"
                  )}: ${path}`
                );
              })
              .filter(Boolean)
          : [];

      const evidence = [
        ...normalizeStringList(
          review?.visibleEvidence
        ),
        ...failedMachineEvidence,
        ...screenshotEvidence,
        result?.videoPath
          ? `Video: ${String(
              result.videoPath
            )}`
          : "",
      ].filter(Boolean);

      return [
        {
          classification:
            "PRODUCT_BUG",
          confidence: "high",
          summary:
            `${args.issueId} ` +
            `${String(
              result?.id ||
                "browser-case"
            )}: ` +
            `${String(
              testCase?.goal ||
                "Product behavior mismatch"
            )}`,
          expectedBehavior,
          actualBehavior,
          reproductionSteps,
          evidence: [
            ...new Set(evidence),
          ],
          ...(
            route &&
            route.toUpperCase() !==
              "UNKNOWN"
              ? {
                  likelyArea: route,
                }
              : {}
          ),
        },
      ];
    }
  );
}

export function formatProductFindingsMarkdown(
  findings: ProductFinding[]
): string {
  if (findings.length === 0) {
    return [
      "## Product Findings",
      "",
      "No high-confidence product bugs were confirmed in this run.",
      "",
    ].join("\n");
  }

  const sections =
    findings.map((finding) => {
      const lines = [
        `### ${finding.summary}`,
        "",
        `- **Classification:** ${finding.classification}`,
        `- **Confidence:** ${finding.confidence}`,
      ];

      if (finding.likelyArea) {
        lines.push(
          `- **Likely Area:** ${finding.likelyArea}`
        );
      }

      lines.push(
        "",
        "#### Expected Behavior",
        "",
        finding.expectedBehavior,
        "",
        "#### Actual Behavior",
        "",
        finding.actualBehavior,
        "",
        "#### Reproduction Steps",
        ""
      );

      if (
        finding.reproductionSteps
          .length === 0
      ) {
        lines.push(
          "No executable reproduction steps were recorded."
        );
      } else {
        finding.reproductionSteps
          .forEach(
            (step, index) => {
              lines.push(
                `${index + 1}. ${step}`
              );
            }
          );
      }

      lines.push(
        "",
        "#### Evidence",
        ""
      );

      if (finding.evidence.length === 0) {
        lines.push(
          "- No structured evidence was recorded."
        );
      } else {
        finding.evidence.forEach(
          (item) => {
            lines.push(`- ${item}`);
          }
        );
      }

      return lines.join("\n");
    });

  return [
    "## Product Findings",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}
