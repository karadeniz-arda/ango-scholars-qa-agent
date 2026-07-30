export type ApiDetailSemanticOutcome =
  | "NOT_APPLICABLE"
  | "PASS"
  | "FAIL"
  | "MANUAL_REQUIRED";

export type ApiDetailSemanticEvaluation = {
  outcome: ApiDetailSemanticOutcome;
  notes: string;
};

type DetailFieldKind =
  | "value"
  | "object"
  | "array";

type DetailFieldRule = {
  key: string;
  labels: string[];
  paths: string[];
  kind: DetailFieldKind;
  requireItems?: boolean;
  relationshipEntity?: string;
  allowedValues?: string[];

  /*
   * Some contract fields must exist but may legitimately
   * be null before the related domain event occurs.
   */
  allowNull?: boolean;

  /*
   * Missing fields remain contract failures.
   * Present-but-empty fixture-dependent fields may require
   * a better runtime fixture instead of proving a product bug.
   */
  emptyOutcome?:
    | "FAIL"
    | "MANUAL_REQUIRED";
};

type DetailCollectionRule = {
  key: string;
  labels: string[];
  paths: string[];
  itemFields: DetailFieldRule[];
};

type DetailSemanticProfile = {
  name: string;
  matches: (
    path: string,
    caseText: string
  ) => boolean;
  extractRequestedId: (
    path: string
  ) => string | undefined;
  responseIdPaths: string[];
  fields: DetailFieldRule[];
  collections: DetailCollectionRule[];
};

type ReadPathResult = {
  found: boolean;
  value: any;
  path?: string;
};

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

function getCaseText(
  testCase: any
): string {
  const expect =
    testCase?.expect ?? {};

  const structuredExpectations = [
    expect.responseContains,
    expect.responseNotContains,
    expect.headersContain,
  ].flatMap((value) =>
    Array.isArray(value)
      ? value
      : value !== undefined &&
          value !== null
        ? [value]
        : []
  );

  return [
    testCase?.summary,
    testCase?.goal,
    testCase?.notes,
    testCase?.successCriteria,
expect.notes,
expect.note,
expect.body
  ? JSON.stringify(expect.body)
  : undefined,
...structuredExpectations,
  ]
    .filter(
      (value) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
    )
    .map(String)
    .join(" ")
    .toLowerCase();
}

function compactText(
  value: unknown
): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function mentionsAny(
  caseText: string,
  labels: string[]
): boolean {
  const normalizedText =
    caseText.toLowerCase();

  const compactCaseText =
    compactText(caseText);

  return labels.some((label) => {
    const normalizedLabel =
      label.toLowerCase();

    return (
      normalizedText.includes(
        normalizedLabel
      ) ||
      compactCaseText.includes(
        compactText(normalizedLabel)
      )
    );
  });
}

function readPath(
  root: any,
  path: string
): ReadPathResult {
  const segments =
    path
      .split(".")
      .map((segment) =>
        segment.trim()
      )
      .filter(Boolean);

  let current = root;

  for (const segment of segments) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(
        current,
        segment
      )
    ) {
      return {
        found: false,
        value: undefined,
      };
    }

    current = current[segment];
  }

  return {
    found: true,
    value: current,
    path,
  };
}

function readFirstPath(
  root: any,
  paths: string[]
): ReadPathResult {
  for (const path of paths) {
    const result =
      readPath(root, path);

    if (result.found) {
      return result;
    }
  }

  return {
    found: false,
    value: undefined,
  };
}

function isObjectRecord(
  value: unknown
): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isMeaningfulValue(
  value: unknown,
  kind: DetailFieldKind,
  requireItems = false,
  allowNull = false
): boolean {
  if (value === undefined) {
    return false;
  }

  if (value === null) {
    return (
      allowNull &&
      kind === "value"
    );
  }

  if (kind === "array") {
    if (!Array.isArray(value)) {
      return false;
    }

    return (
      !requireItems ||
      value.length > 0
    );
  }

  if (kind === "object") {
    return (
      isObjectRecord(value) &&
      Object.keys(value).length > 0
    );
  }

  if (typeof value === "string") {
    return value.trim() !== "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  return true;
}

function collectDetailCandidates(
  responseBody: any
): Record<string, any>[] {
  if (!isObjectRecord(responseBody)) {
    return [];
  }

  const candidates:
    Record<string, any>[] = [];

  const queue: Array<{
    value: Record<string, any>;
    depth: number;
  }> = [
    {
      value: responseBody,
      depth: 0,
    },
  ];

  const seen =
    new Set<Record<string, any>>();

  const wrapperKeys = [
    "data",
    "item",
    "result",
    "payload",
    "record",
    "response",
  ];

  while (queue.length > 0) {
    const current =
      queue.shift();

    if (
      !current ||
      seen.has(current.value)
    ) {
      continue;
    }

    seen.add(current.value);
    candidates.push(current.value);

    if (current.depth >= 3) {
      continue;
    }

    for (const key of wrapperKeys) {
      const child =
        current.value[key];

      if (isObjectRecord(child)) {
        queue.push({
          value: child,
          depth:
            current.depth + 1,
        });
      }
    }
  }

  return candidates;
}

function selectDetailObject(
  responseBody: any,
  responseIdPaths: string[]
): Record<string, any> | undefined {
  const candidates =
    collectDetailCandidates(
      responseBody
    );

  if (candidates.length === 0) {
    return undefined;
  }

  const candidateWithId =
    candidates.find((candidate) =>
      readFirstPath(
        candidate,
        responseIdPaths
      ).found
    );

  return (
    candidateWithId ??
    candidates[0]
  );
}

function invoiceProfile():
  DetailSemanticProfile {
  return {
    name: "invoice-detail",

    matches: (
      path,
      caseText
    ) =>
      /\/invoices\/[^/?#]+(?:\?|$)/i.test(
        path
      ) &&
      (
        path
          .toLowerCase()
          .includes("/invoices/") ||
        caseText.includes("invoice")
      ),

    extractRequestedId: (
      path
    ) => {
      const match =
        path.match(
          /\/invoices\/([^/?#]+)(?:\?|$)/i
        );

      const value =
        match?.[1];

      if (
        !value ||
        value.includes("{") ||
        value.includes(":") ||
        value.toUpperCase() ===
          "UNKNOWN"
      ) {
        return undefined;
      }

      return decodeURIComponent(value);
    },

    responseIdPaths: [
      "id",
      "invoiceId",
      "_id",
      "invoice.id",
      "invoice.invoiceId",
    ],

    fields: [
      {
        key: "invoiceNumber",
        labels: [
          "invoiceNumber",
          "invoice number",
          "invoice no",
        ],
        paths: [
          "invoiceNumber",
          "invoiceNo",
          "number",
          "invoice.invoiceNumber",
        ],
        kind: "value",
      },
      {
        key: "paymentProvider",
        labels: [
          "paymentProvider",
          "payment provider",
        ],
        paths: [
          "paymentProvider",
          "provider",
          "invoice.paymentProvider",
        ],
        kind: "value",
      },
      {
        key: "lineItems",
        labels: [
          "lineItems",
          "line items",
        ],
        paths: [
          "lineItems",
          "invoice.lineItems",
        ],
        kind: "array",
        requireItems: true,
      },
      {
        key: "approvedBy",
        labels: [
          "approvedBy",
          "approved by",
          "invoice approval information",
        ],
        paths: [
          "approvedBy",
          "approval.approvedBy",
          "invoice.approvedBy",
        ],
        kind: "object",
      },
      {
        key: "approvedAt",
        labels: [
          "approvedAt",
          "approved at",
          "approval timestamp",
        ],
        paths: [
          "approvedAt",
          "approval.approvedAt",
          "invoice.approvedAt",
        ],
        kind: "value",
      },
    ],

    collections: [
      {
        key: "timesheets",
        labels: [
          "timesheets",
          "timesheet information",
          "timesheet details",
        ],
        paths: [
          "timesheets",
          "invoice.timesheets",
        ],
        itemFields: [
          {
            key: "id",
            labels: [
              "timesheet id",
              "timesheets with id",
              "timesheets containing id",
            ],
            paths: [
              "id",
              "timesheetId",
              "_id",
            ],
            kind: "value",
          },
          {
            key: "reviewedBy",
            labels: [
              "reviewedBy",
              "reviewed by",
              "timesheet approved by",
            ],
            paths: [
              "reviewedBy",
              "approvedBy",
              "review.approvedBy",
            ],
            kind: "object",
            emptyOutcome:
              "MANUAL_REQUIRED",
          },
          {
            key: "reviewedAt",
            labels: [
              "reviewedAt",
              "reviewed at",
              "timesheet approved at",
            ],
            paths: [
              "reviewedAt",
              "approvedAt",
              "review.approvedAt",
            ],
            kind: "value",

            /*
             * The field must exist, but null is valid while
             * the timesheet has no completed review timestamp.
             */
            allowNull: true,

            /*
             * Empty strings and other unusable values still
             * require a better fixture or manual verification.
             */
            emptyOutcome:
              "MANUAL_REQUIRED",
          },
          {
            key: "contract",
            labels: [
              "timesheet contract",
              "contract context",
              "contract relationship",
            ],
            paths: [
              "contract",
              "contractDetails",
            ],
            kind: "object",
            relationshipEntity:
              "contract",
          },
          {
            key: "job",
            labels: [
              "timesheet job",
              "job context",
              "job relationship",
            ],
            paths: [
              "job",
              "contract.job",
            ],
            kind: "object",
            relationshipEntity:
              "job",
          },
          {
            key: "talent",
            labels: [
              "timesheet talent",
              "talent context",
              "talent relationship",
            ],
            paths: [
              "talent",
              "contract.talent",
            ],
            kind: "object",
            relationshipEntity:
              "talent",
          },
          {
            key: "company",
            labels: [
              "timesheet company",
              "company context",
              "company relationship",
            ],
            paths: [
              "company",
              "contract.company",
            ],
            kind: "object",
            relationshipEntity:
              "company",
          },
        ],
      },
    ],
  };
}

function assessmentLanguageProfile():
  DetailSemanticProfile {
  return {
    name: "assessment-language-detail",

    matches: (
      path,
      caseText
    ) =>
      /\/assessments\/[^/?#]+(?:\?|$)/i.test(
        path
      ) &&
      caseText.includes("language"),

    extractRequestedId: (
      path
    ) => {
      const match =
        path.match(
          /\/assessments\/([^/?#]+)(?:\?|$)/i
        );

      const value = match?.[1];

      if (
        !value ||
        value.includes("{") ||
        value.includes(":") ||
        value.toUpperCase() ===
          "UNKNOWN"
      ) {
        return undefined;
      }

      return decodeURIComponent(value);
    },

    responseIdPaths: [
      "id",
      "assessmentId",
      "_id",
      "assessment.id",
      "data.id",
    ],

    fields: [],

    collections: [
      {
        key: "languages",
        labels: [
          "languages",
          "language proficiency records",
          "language requirements",
        ],
        paths: [
          "languages",
          "assessment.languages",
          "data.languages",
        ],
        itemFields: [
          {
            key: "mode",
            labels: [
              "languages[*].mode",
              "language mode",
              "mode values",
              "four new mode values",
            ],
            paths: [
              "mode",
              "languageMode",
              "proficiencyMode",
              "language.mode",
              "proficiency.mode",
            ],
            kind: "value",
            allowedValues: [
              "listening",
              "speaking",
              "writing",
              "reading",
            ],
          },
          {
            key: "level",
            labels: [
              "languages[*].level",
              "cefr levels",
              "proficiency level",
            ],
            paths: [
              "level",
              "languageLevel",
              "proficiencyLevel",
              "language.level",
              "proficiency.level",
            ],
            kind: "value",
            allowedValues: [
              "A1",
              "A2",
              "B1",
              "B2",
              "C1",
              "C2",
            ],
          },
        ],
      },
    ],
  };
}

const detailProfiles:
  DetailSemanticProfile[] = [
    invoiceProfile(),
    assessmentLanguageProfile(),
  ];

function isCollectionItemFieldRequested(
  rule: DetailFieldRule,
  caseText: string
): boolean {
  if (
    mentionsAny(
      caseText,
      rule.labels
    )
  ) {
    return true;
  }

  if (!rule.relationshipEntity) {
    return false;
  }

  const asksForRelationshipData =
    mentionsAny(
      caseText,
      [
        "relationship",
        "relationships",
        "related context",
        "relationships needed",
      ]
    );

  return (
    asksForRelationshipData &&
    compactText(caseText).includes(
      compactText(
        rule.relationshipEntity
      )
    )
  );
}

export function evaluateApiDetailSemantics(
  args: {
    testCase: any;
    path: string;
    responseBody: any;
  }
): ApiDetailSemanticEvaluation {
  const caseText =
    getCaseText(args.testCase);

  const profile =
    detailProfiles.find(
      (candidate) =>
        candidate.matches(
          args.path,
          caseText
        )
    );

  if (!profile) {
    return {
      outcome: "NOT_APPLICABLE",
      notes: "",
    };
  }

  const requestedRootFields =
    profile.fields.filter(
      (rule) =>
        mentionsAny(
          caseText,
          rule.labels
        )
    );

  const requestedCollections =
    profile.collections.filter(
      (rule) =>
        mentionsAny(
          caseText,
          rule.labels
        )
    );

  const requestedNestedFields =
    requestedCollections.flatMap(
      (collection) =>
        collection.itemFields.filter(
          (rule) =>
            isCollectionItemFieldRequested(
              rule,
              caseText
            )
        )
    );

  const requestedPlanCheckCount =
    requestedRootFields.length +
    requestedCollections.length +
    requestedNestedFields.length;

  /*
   * A detail profile must not claim PASS merely because
   * the endpoint shape matched. At least one requirement
   * must be grounded in the generated plan.
   */
  if (requestedPlanCheckCount === 0) {
    return {
      outcome: "NOT_APPLICABLE",
      notes: "",
    };
  }

  const detailObject =
    selectDetailObject(
      args.responseBody,
      profile.responseIdPaths
    );

  if (!detailObject) {
    return {
      outcome: "MANUAL_REQUIRED",
      notes:
        `${profile.name} response could not ` +
        `be interpreted as a detail object`,
    };
  }

  const failures: string[] = [];
  const manualReasons: string[] = [];
  const passedChecks: string[] = [];

  const requestedId =
    profile.extractRequestedId(
      args.path
    );

  if (requestedId) {
    const responseIdResult =
      readFirstPath(
        detailObject,
        profile.responseIdPaths
      );

    if (!responseIdResult.found) {
      manualReasons.push(
        `requested detail ID=${requestedId} ` +
        `could not be compared because the ` +
        `response has no readable ID`
      );
    } else {
      const responseId =
        firstString(
          responseIdResult.value
        );

      if (!responseId) {
        manualReasons.push(
          `requested detail ID=${requestedId} ` +
          `could not be compared because the ` +
          `response ID is empty`
        );
      } else if (
        responseId !== requestedId
      ) {
        failures.push(
          `detail ID mismatch: requested ` +
          `${requestedId}, received ${responseId}`
        );
      } else {
        passedChecks.push(
          `detail ID matched ${requestedId}`
        );
      }
    }
  }

  for (
    const rule
    of requestedRootFields
  ) {
    const result =
      readFirstPath(
        detailObject,
        rule.paths
      );

    if (!result.found) {
      failures.push(
        `required field ${rule.key} ` +
        `is missing from the detail response`
      );

      continue;
    }

    if (
      !isMeaningfulValue(
        result.value,
        rule.kind,
        rule.requireItems,
        rule.allowNull ?? false
      )
    ) {
      const reason =
        `required field ${rule.key} ` +
        `is present but empty, null, ` +
        `or has an invalid shape`;

      if (
        rule.emptyOutcome ===
        "MANUAL_REQUIRED"
      ) {
        manualReasons.push(reason);
      } else {
        failures.push(reason);
      }

      continue;
    }

    passedChecks.push(
      `required field ${rule.key} is populated`
    );
  }

  for (
    const collectionRule
    of requestedCollections
  ) {
    const collectionResult =
      readFirstPath(
        detailObject,
        collectionRule.paths
      );

    if (!collectionResult.found) {
      failures.push(
        `required collection ` +
        `${collectionRule.key} is missing`
      );

      continue;
    }

    if (
      !Array.isArray(
        collectionResult.value
      )
    ) {
      failures.push(
        `required collection ` +
        `${collectionRule.key} is not an array`
      );

      continue;
    }

    const collectionItems =
      collectionResult.value;

    if (collectionItems.length === 0) {
      failures.push(
        `required collection ` +
        `${collectionRule.key} is empty`
      );

      continue;
    }

    passedChecks.push(
      `${collectionRule.key} contains ` +
      `${collectionItems.length} item(s)`
    );

    const requestedItemFields =
      collectionRule.itemFields.filter(
        (rule) =>
          isCollectionItemFieldRequested(
            rule,
            caseText
          )
      );

    for (
      const itemField
      of requestedItemFields
    ) {
      let missingCount = 0;
      let invalidCount = 0;

      for (
        const item
        of collectionItems
      ) {
        const itemResult =
          readFirstPath(
            item,
            itemField.paths
          );

        if (!itemResult.found) {
          missingCount += 1;
          continue;
        }

if (
  !isMeaningfulValue(
    itemResult.value,
    itemField.kind,
    itemField.requireItems,
    itemField.allowNull ?? false
  )
) {
  invalidCount += 1;
  continue;
}

if (
  itemField.allowedValues?.length &&
  !itemField.allowedValues.some(
    (allowedValue) =>
      compactText(allowedValue) ===
      compactText(itemResult.value)
  )
) {
  invalidCount += 1;
}
      }

      if (missingCount > 0) {
        failures.push(
          `${collectionRule.key}.${itemField.key} ` +
          `is missing from ${missingCount} of ` +
          `${collectionItems.length} item(s)`
        );
      }

      if (invalidCount > 0) {
        const reason =
          `${collectionRule.key}.${itemField.key} ` +
          `is present but empty or invalid for ` +
          `${invalidCount} of ` +
          `${collectionItems.length} item(s)`;

        if (
          itemField.emptyOutcome ===
          "MANUAL_REQUIRED"
        ) {
          manualReasons.push(reason);
        } else {
          failures.push(reason);
        }
      }

      if (
        missingCount > 0 ||
        invalidCount > 0
      ) {
        continue;
      }

      passedChecks.push(
        `all ${collectionItems.length} ` +
        `${collectionRule.key} item(s) contain ` +
        `${itemField.key}`
      );
    }
  }

  if (failures.length > 0) {
    return {
      outcome: "FAIL",
      notes: failures.join(" | "),
    };
  }

  if (manualReasons.length > 0) {
    return {
      outcome: "MANUAL_REQUIRED",
      notes: [
        ...passedChecks,
        ...manualReasons,
      ].join(" | "),
    };
  }

  if (passedChecks.length > 0) {
    return {
      outcome: "PASS",
      notes: passedChecks.join(" | "),
    };
  }

  return {
    outcome: "NOT_APPLICABLE",
    notes: "",
  };
}
