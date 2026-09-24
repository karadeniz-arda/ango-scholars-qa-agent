export type FixtureIdentityAuthority = {
  authority:
    | "EXPLICIT_SOURCE_IDENTITY"
    | "CANDIDATE_ONLY"
    | "NONE"
    | "SOURCE_UNAVAILABLE";
  entityKind: string;
  entityId?: string;
  sourceRef?: string;
  reason: string;
};

export type RuntimeFixturePolicyDecision = {
  status: "RESOLVED" | "BLOCKED";
  policy?: "exact" | "compatible-state";
  exactEntityId?: string;
  reason: string;
};

const JIRA_MARKER =
  "--- JIRA TICKET ---";
const GITHUB_MARKER =
  "--- GITHUB CHANGE CONTEXT ---";

function safeIdentity(
  value: string
): string | undefined {
  const normalized = value
    .trim()
    .replace(/[.,;!?]+$/, "");

  if (
    !normalized ||
    normalized.length > 200 ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(
      normalized
    )
  ) {
    return undefined;
  }

  return normalized;
}
function authoritativeJiraSection(
  sourceContext: string
): string | undefined {
  const jiraStart =
    sourceContext.indexOf(JIRA_MARKER);

  if (jiraStart < 0) {
    return undefined;
  }

  const contentStart =
    jiraStart + JIRA_MARKER.length;
  const githubStart =
    sourceContext.indexOf(
      GITHUB_MARKER,
      contentStart
    );

  return sourceContext.slice(
    contentStart,
    githubStart < 0
      ? undefined
      : githubStart
  );
}

function explicitSourceIdentities(
  jiraSection: string,
  entityKind: string
): string[] {
  const escapedKind = entityKind.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  const pattern = new RegExp(
    `\\b${escapedKind}(?:[ _-]*id|Id)` +
      `\\s*(?::|=|#)\\s*` +
      `["']?([A-Za-z0-9]` +
      `[A-Za-z0-9._-]{0,199})["']?`,
    "gi"
  );
  const identities = [
    ...jiraSection.matchAll(pattern),
  ]
    .map((match) =>
      safeIdentity(match[1] ?? "")
    )
    .filter(
      (identity): identity is string =>
        Boolean(identity)
    );

  return [...new Set(identities)].sort();
}

export function resolveFixtureIdentityAuthority(
  input: {
    entityKind: string;
    sourceContext: string;
    plannerProposedId?: string;
    runtimeCandidateId?: string;
    routeParamId?: string;
    sourceAvailable?: boolean;
  }
): FixtureIdentityAuthority {
  const jiraSection =
    input.sourceAvailable === false
      ? undefined
      : authoritativeJiraSection(
          input.sourceContext
        );

  if (jiraSection === undefined) {
    return {
      authority: "SOURCE_UNAVAILABLE",
      entityKind: input.entityKind,
      reason:
        "Authoritative Jira source boundaries were unavailable; exact identity authority cannot be inferred.",
    };
  }

  const identities =
    explicitSourceIdentities(
      jiraSection,
      input.entityKind
    );

  if (identities.length === 1) {
    return {
      authority:
        "EXPLICIT_SOURCE_IDENTITY",
      entityKind: input.entityKind,
      entityId: identities[0]!,
      sourceRef: "jira.explicitFixtureIdentity",
      reason:
        "Jira explicitly identifies one runtime entity identity.",
    };
  }

  if (identities.length > 1) {
    return {
      authority: "SOURCE_UNAVAILABLE",
      entityKind: input.entityKind,
      reason:
        "Jira contains multiple explicit entity identities; one exact identity is not unambiguous.",
    };
  }

  if (
    input.plannerProposedId ||
    input.runtimeCandidateId ||
    input.routeParamId
  ) {
    return {
      authority: "CANDIDATE_ONLY",
      entityKind: input.entityKind,
      reason:
        "Only planner, runtime-candidate, or route identities were available; none grants business authority.",
    };
  }

  return {
    authority: "NONE",
    entityKind: input.entityKind,
    reason:
      "Authoritative Jira source is resolved and names no exact runtime entity identity.",
  };
}

export function normalizeRuntimeFixturePolicy(
  input: {
    identityAuthority:
      FixtureIdentityAuthority;
    compatibleStateSupported: boolean;
    substitutionSemanticallyAllowed: boolean;
  }
): RuntimeFixturePolicyDecision {
  const authority =
    input.identityAuthority;

  if (
    authority.authority ===
    "EXPLICIT_SOURCE_IDENTITY"
  ) {
    return {
      status: "RESOLVED",
      policy: "exact",
      exactEntityId:
        authority.entityId!,
      reason:
        "An explicit authoritative source identity requires exact policy.",
    };
  }

  if (
    authority.authority ===
    "SOURCE_UNAVAILABLE"
  ) {
    return {
      status: "BLOCKED",
      reason:
        "Fixture policy is ambiguous because authoritative identity source is unavailable.",
    };
  }

  if (
    input.compatibleStateSupported &&
    input.substitutionSemanticallyAllowed
  ) {
    return {
      status: "RESOLVED",
      policy: "compatible-state",
      reason:
        "No exact identity is authoritative and the specialized resolver can verify every required state predicate.",
    };
  }

  return {
    status: "BLOCKED",
    reason:
      "No exact identity is authoritative and compatible-state substitution is not safely supported.",
  };
}
