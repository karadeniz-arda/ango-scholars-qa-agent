import {
  evaluateApiDetailSemantics,
} from "./api-detail-semantic-evaluator.js";

type RuntimeResourceContext = {
  companyId?: string | undefined;
  talentId?: string | undefined;
};

type ResolveRuntimePathResourcesInput = {
  apiUrl: string;
  token?: string | undefined;
  persona: string;
  testCase: any;
  context: RuntimeResourceContext;
};

export type RuntimePathResourceValues = {
  invoiceId?: string | undefined;
  invoiceNumber?: string | undefined;
  invoiceStatus?: string | undefined;
};

type InvoiceOwnerType =
  | "company"
  | "talent";

type RequiredInvoiceState =
  | "approved"
  | "processed"
  | "sent-for-processing";

type InvoiceFixture = {
  invoiceId: string;
  sourcePath: string;
  score: number;
  invoiceNumber?: string | undefined;
  status?: string | undefined;
};

const invoiceFixtureCache =
  new Map<
    string,
    Promise<InvoiceFixture | undefined>
  >();

function normalizeBaseUrl(
  apiUrl: string
): string {
  return String(apiUrl || "")
    .replace(/\/+$/, "");
}

function firstString(
  ...values: unknown[]
): string | undefined {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return String(value).trim();
    }
  }

  return undefined;
}

function getInvoiceId(
  invoice: any
): string | undefined {
  return firstString(
    invoice?.id,
    invoice?.invoiceId,
    invoice?._id,
    invoice?.invoice?.id,
    invoice?.invoice?.invoiceId
  );
}

function getInvoiceNumber(
  invoice: any
): string | undefined {
  return firstString(
    invoice?.invoiceNumber,
    invoice?.number,
    invoice?.invoiceNo,
    invoice?.invoice?.invoiceNumber,
    invoice?.invoice?.number
  );
}

function getInvoiceStatus(
  invoice: any
): string | undefined {
  return firstString(
    typeof invoice?.status === "string"
      ? invoice.status
      : undefined,
    invoice?.status?.name,
    invoice?.invoiceStatus,
    invoice?.state,
    typeof invoice?.invoice?.status === "string"
      ? invoice.invoice.status
      : undefined,
    invoice?.invoice?.status?.name
  );
}

function extractInvoiceItems(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  const possibleArrays = [
    data.items,
    data.results,
    data.rows,
    data.records,
    data.invoices,
    data.data,
    data.data?.items,
    data.data?.results,
    data.data?.rows,
    data.data?.records,
    data.data?.invoices,
    data.payload?.items,
    data.payload?.results,
    data.payload?.invoices,
  ];

  for (const value of possibleArrays) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  if (getInvoiceId(data)) {
    return [data];
  }

  return [];
}

function normalizeState(
  value: unknown
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function hasArrayItems(
  value: unknown
): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0
  );
}

function hasApprovalEvidence(
  invoice: any
): boolean {
  const status =
    normalizeState(
      getInvoiceStatus(invoice)
    );

  return (
    status.includes("approved") ||
    invoice?.isApproved === true ||
    Boolean(
      firstString(
        invoice?.approvedAt,
        invoice?.approvedBy,
        invoice?.approval?.approvedAt,
        invoice?.approval?.approvedBy,
        invoice?.invoice?.approvedAt,
        invoice?.invoice?.approvedBy
      )
    )
  );
}

function buildCaseHintText(
  testCase: any
): string {
  return [
    testCase?.summary,
    testCase?.goal,
    testCase?.notes,
    testCase?.successCriteria,
    testCase?.expect?.notes,
    testCase?.expect?.note,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferRequiredInvoiceState(
  testCase: any
): RequiredInvoiceState | undefined {
  const text =
    buildCaseHintText(testCase);

  if (
    text.includes(
      "sent for processing"
    ) ||
    text.includes(
      "sent-for-processing"
    )
  ) {
    return "sent-for-processing";
  }

  if (
    /\bprocessed\b/.test(text)
  ) {
    return "processed";
  }

  if (
    text.includes("approved invoice") ||
    text.includes("runtime approved") ||
    text.includes("invoice is approved")
  ) {
    return "approved";
  }

  return undefined;
}

function invoiceMatchesRequiredState(
  invoice: any,
  requiredState:
    RequiredInvoiceState | undefined
): boolean {
  if (!requiredState) {
    return true;
  }

  if (
    requiredState === "approved"
  ) {
    return hasApprovalEvidence(
      invoice
    );
  }

  const status =
    normalizeState(
      getInvoiceStatus(invoice)
    );

  if (
    requiredState ===
    "sent-for-processing"
  ) {
    return (
      status.includes(
        "sent-for-processing"
      ) ||
      status.includes(
        "sent-to-processing"
      )
    );
  }

  return (
    status === "processed" ||
    status.endsWith("-processed")
  );
}

function getInvoiceProbeLimit(): number {
  const parsed = Number(
    process.env
      .QA_INVOICE_RESOLVER_PROBE_LIMIT ??
      "10"
  );

  if (
    !Number.isFinite(parsed) ||
    parsed < 1
  ) {
    return 10;
  }

  return Math.min(
    Math.floor(parsed),
    25
  );
}

function scoreInvoice(
  invoice: any,
  requiredState:
    RequiredInvoiceState | undefined
): number {
  let score = 100;

  if (getInvoiceNumber(invoice)) {
    score += 10;
  }

  if (getInvoiceStatus(invoice)) {
    score += 5;
  }

  if (hasApprovalEvidence(invoice)) {
    score += 25;
  }

  if (
    hasArrayItems(
      invoice?.timesheets
    ) ||
    hasArrayItems(
      invoice?.invoice?.timesheets
    )
  ) {
    score += 20;
  }

  if (
    hasArrayItems(
      invoice?.lineItems
    ) ||
    hasArrayItems(
      invoice?.invoice?.lineItems
    )
  ) {
    score += 10;
  }

  if (
    requiredState &&
    invoiceMatchesRequiredState(
      invoice,
      requiredState
    )
  ) {
    score += 50;
  }

  return score;
}

async function apiGet(
  apiUrl: string,
  path: string,
  token: string
): Promise<any | undefined> {
  const url =
    `${normalizeBaseUrl(apiUrl)}${path}`;

  try {
    const response = await fetch(
      url,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    const text =
      await response.text();

    if (!response.ok) {
      console.log(
        ` API invoice resolver GET failed ` +
        `${response.status}: ${path}`
      );

      return undefined;
    }

    try {
      return text
        ? JSON.parse(text)
        : undefined;
    } catch {
      console.log(
        ` API invoice resolver received ` +
        `non-JSON response: ${path}`
      );

      return undefined;
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.log(
      ` API invoice resolver request ` +
      `failed for ${path}: ${message}`
    );

    return undefined;
  }
}

async function resolveInvoiceFixture(
  apiUrl: string,
  token: string,
  ownerType: InvoiceOwnerType,
  ownerId: string,
  requiredState:
    RequiredInvoiceState | undefined,
  testCase: any
): Promise<InvoiceFixture | undefined> {
  const ownerSegment =
    ownerType === "talent"
      ? "talents"
      : "companies";

  const basePath =
    `/${ownerSegment}/${ownerId}/invoices`;

  const candidatePaths = [
    `${basePath}?limit=100&offset=0`,
    `${basePath}?limit=100`,
    basePath,
  ];

  for (const path of candidatePaths) {
    const data =
      await apiGet(
        apiUrl,
        path,
        token
      );

    const invoices =
      extractInvoiceItems(data)
        .filter(
          (invoice) =>
            Boolean(
              getInvoiceId(invoice)
            )
        );

    if (invoices.length === 0) {
      console.log(
        ` API invoice resolver found no ` +
        `usable invoice from ${path}`
      );

      continue;
    }

    const compatibleInvoices =
      invoices.filter(
        (invoice) =>
          invoiceMatchesRequiredState(
            invoice,
            requiredState
          )
      );

    if (
      requiredState &&
      compatibleInvoices.length === 0
    ) {
      console.log(
        ` API invoice resolver found ` +
        `${invoices.length} invoice(s) from ` +
        `${path}, but none safely matched ` +
        `required state=${requiredState}`
      );

      continue;
    }

    const candidates =
      requiredState
        ? compatibleInvoices
        : invoices;

    const ranked =
      candidates
        .map((invoice) => ({
          invoice,
          invoiceId:
            getInvoiceId(invoice)!,
          score:
            scoreInvoice(
              invoice,
              requiredState
            ),
        }))
        .sort((left, right) => {
          if (
            right.score !== left.score
          ) {
            return (
              right.score -
              left.score
            );
          }

          return left.invoiceId
            .localeCompare(
              right.invoiceId
            );
        });

    const createFixture = (
      candidate: {
        invoice: any;
        invoiceId: string;
        score: number;
      }
    ): InvoiceFixture => {
      const invoiceNumber =
        getInvoiceNumber(
          candidate.invoice
        );

      const status =
        getInvoiceStatus(
          candidate.invoice
        );

      return {
        invoiceId:
          candidate.invoiceId,
        sourcePath: path,
        score: candidate.score,
        ...(invoiceNumber
          ? { invoiceNumber }
          : {}),
        ...(status
          ? { status }
          : {}),
      };
    };

    const logSelection = (
      fixture: InvoiceFixture,
      semanticOutcome: string,
      semanticNotes?: string
    ): void => {
      console.log(
        ` API invoice resolver selected ` +
        `invoiceId=${fixture.invoiceId}` +
        (
          fixture.invoiceNumber
            ? ` invoiceNumber=${fixture.invoiceNumber}`
            : ""
        ) +
        (
          fixture.status
            ? ` status=${fixture.status}`
            : ""
        ) +
        ` owner=${ownerType}:${ownerId}` +
        ` source=${fixture.sourcePath}` +
        ` score=${fixture.score}` +
        ` semantic=${semanticOutcome}` +
        (
          semanticNotes
            ? ` reason=${semanticNotes}`
            : ""
        )
      );
    };

    let manualFallback:
      | {
          fixture: InvoiceFixture;
          notes: string;
        }
      | undefined;

    let failureFallback:
      | {
          fixture: InvoiceFixture;
          notes: string;
        }
      | undefined;

    let unsupportedFallback:
      | {
          fixture: InvoiceFixture;
          notes: string;
        }
      | undefined;

    const probeCandidates =
      ranked.slice(
        0,
        getInvoiceProbeLimit()
      );

    for (
      const candidate
      of probeCandidates
    ) {
      const fixture =
        createFixture(candidate);

      const detailPath =
        `${basePath}/` +
        encodeURIComponent(
          candidate.invoiceId
        );

      const detailData =
        await apiGet(
          apiUrl,
          detailPath,
          token
        );

      if (
        detailData === undefined
      ) {
        console.log(
          ` API invoice resolver could not ` +
          `read detail for ` +
          `invoiceId=${candidate.invoiceId}`
        );

        unsupportedFallback ??= {
          fixture,
          notes:
            "invoice detail response could not be loaded",
        };

        continue;
      }

      const semanticEvaluation =
        evaluateApiDetailSemantics({
          testCase,
          path: detailPath,
          responseBody: detailData,
        });

      console.log(
        ` API invoice resolver probed ` +
        `invoiceId=${candidate.invoiceId}` +
        (
          fixture.invoiceNumber
            ? ` invoiceNumber=${fixture.invoiceNumber}`
            : ""
        ) +
        ` semantic=` +
        `${semanticEvaluation.outcome}` +
        (
          semanticEvaluation.notes
            ? ` reason=${semanticEvaluation.notes}`
            : ""
        )
      );

      if (
        semanticEvaluation.outcome ===
        "PASS"
      ) {
        logSelection(
          fixture,
          "PASS",
          semanticEvaluation.notes
        );

        return fixture;
      }

      if (
        semanticEvaluation.outcome ===
        "MANUAL_REQUIRED"
      ) {
        manualFallback ??= {
          fixture,
          notes:
            semanticEvaluation.notes,
        };

        continue;
      }

      if (
        semanticEvaluation.outcome ===
        "FAIL"
      ) {
        failureFallback ??= {
          fixture,
          notes:
            semanticEvaluation.notes,
        };

        continue;
      }

      unsupportedFallback ??= {
        fixture,
        notes:
          "detail semantic profile was not applicable",
      };
    }

    /*
     * Preference order:
     *
     * 1. PASS was already returned above.
     * 2. MANUAL_REQUIRED avoids a false product failure
     *    when the closest fixture is incomplete.
     * 3. FAIL is retained when every grounded detail
     *    candidate violates the expected response.
     * 4. Unsupported fallback preserves safe execution.
     */
    const fallback =
      manualFallback ??
      failureFallback ??
      unsupportedFallback;

    if (fallback) {
      logSelection(
        fallback.fixture,
        manualFallback
          ? "MANUAL_REQUIRED_FALLBACK"
          : failureFallback
            ? "FAIL_FALLBACK"
            : "UNSUPPORTED_FALLBACK",
        fallback.notes
      );

      return fallback.fixture;
    }

    const firstCandidate =
      ranked[0];

    if (firstCandidate) {
      const fixture =
        createFixture(
          firstCandidate
        );

      logSelection(
        fixture,
        "UNPROBED_FALLBACK"
      );

      return fixture;
    }
  }

  return undefined;
}

async function getCachedInvoiceFixture(
  apiUrl: string,
  token: string,
  ownerType: InvoiceOwnerType,
  ownerId: string,
  requiredState:
    RequiredInvoiceState | undefined,
  testCase: any
): Promise<InvoiceFixture | undefined> {
  const requirementFingerprint =
    buildCaseHintText(testCase)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);

  const cacheKey = [
    normalizeBaseUrl(apiUrl),
    ownerType,
    ownerId,
    requiredState ?? "any",
    requirementFingerprint,
  ].join("|");

  if (
    !invoiceFixtureCache.has(
      cacheKey
    )
  ) {
    invoiceFixtureCache.set(
      cacheKey,
      resolveInvoiceFixture(
        apiUrl,
        token,
        ownerType,
        ownerId,
        requiredState,
        testCase
      )
    );
  }

  return invoiceFixtureCache.get(
    cacheKey
  )!;
}

export async function resolveRuntimePathResources(
  input: ResolveRuntimePathResourcesInput
): Promise<RuntimePathResourceValues> {
  const path =
    String(
      input.testCase?.path || ""
    );

  const needsInvoiceId =
    /{invoiceId}|:invoiceId/i.test(
      path
    );

  if (!needsInvoiceId) {
    return {};
  }

  const method =
    String(
      input.testCase?.method || ""
    )
      .trim()
      .toUpperCase();

  const expectedStatus =
    Number(
      input.testCase?.expect?.status
    );

  /*
   * Resolve only grounded, read-only positive cases.
   *
   * A real owned invoice must not be injected into a
   * 404/403 negative case, because that would turn a
   * fixture problem into an agent-origin false FAIL.
   */
  if (
    method !== "GET" ||
    expectedStatus !== 200
  ) {
    console.log(
      ` API runtime resource resolver left ` +
      `invoiceId unresolved for ` +
      `${input.testCase?.id || "case"}: ` +
      `safe automatic resolution currently ` +
      `supports GET cases expecting 200 only`
    );

    return {};
  }

  if (!input.token) {
    console.log(
      ` API runtime resource resolver could ` +
      `not resolve invoiceId for ` +
      `${input.testCase?.id || "case"}: ` +
      `authenticated discovery token is missing`
    );

    return {};
  }

  const normalizedPath =
    path.toLowerCase();

  let ownerType:
    InvoiceOwnerType | undefined;

  let ownerId:
    string | undefined;

  if (
    normalizedPath.includes(
      "/talents/"
    )
  ) {
    ownerType = "talent";
    ownerId =
      input.context.talentId;
  } else if (
    normalizedPath.includes(
      "/companies/"
    )
  ) {
    ownerType = "company";
    ownerId =
      input.context.companyId;
  } else if (
    input.persona === "talent"
  ) {
    ownerType = "talent";
    ownerId =
      input.context.talentId;
  } else if (
    input.persona ===
    "company_admin"
  ) {
    ownerType = "company";
    ownerId =
      input.context.companyId;
  }

  if (!ownerType || !ownerId) {
    console.log(
      ` API runtime resource resolver could ` +
      `not determine invoice owner for ` +
      `${input.testCase?.id || "case"}`
    );

    return {};
  }

  const requiredState =
    inferRequiredInvoiceState(
      input.testCase
    );

  const fixture =
    await getCachedInvoiceFixture(
      input.apiUrl,
      input.token,
      ownerType,
      ownerId,
      requiredState,
      input.testCase
    );

  if (!fixture) {
    console.log(
      ` API runtime resource resolver could ` +
      `not resolve a safe invoiceId for ` +
      `${input.testCase?.id || "case"}`
    );

    return {};
  }

  return {
    invoiceId:
      fixture.invoiceId,
    ...(fixture.invoiceNumber
      ? {
          invoiceNumber:
            fixture.invoiceNumber,
        }
      : {}),
    ...(fixture.status
      ? {
          invoiceStatus:
            fixture.status,
        }
      : {}),
  };
}
