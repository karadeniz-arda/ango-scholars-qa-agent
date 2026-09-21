import type {
  PlannerRouteEvidenceOrigin,
} from "../../planner/types.js";
import type {
  BrowserPersona,
} from "./browser-route-semantics.js";
import {
  isBrowserRouteCompatibleWithPersona,
  isInternalBrowserRoute,
} from "./browser-route-semantics.js";

export type DeepRouteBindingStatus =
  | "RESOLVED"
  | "NO_AUTHORITATIVE_TEMPLATE"
  | "RUNTIME_IDENTITY_REQUIRED"
  | "NO_COMPATIBLE_ENTITY"
  | "AMBIGUOUS_ENTITY"
  | "ENTITY_STATE_UNVERIFIED"
  | "BINDING_FAILED"
  | "ROUTE_REJECTED"
  | "NAVIGATION_FAILED"
  | "TARGET_IDENTITY_UNVERIFIED"
  | "TARGET_VERIFIED";

export type DeepRouteBindingSlot = {
  param: string;
  entityKind: string;
};

export type DeepRouteTemplate = {
  template: string;
  sourceOrigin:
    PlannerRouteEvidenceOrigin;
  sourceRef?: string;
  authoritative: boolean;
  persona: BrowserPersona;
  requiredBindings:
    DeepRouteBindingSlot[];
  disposition?:
    "CURRENT" |
    "RESOURCE_OR_API";
};

export type RuntimeEntityIdentitySource =
  | "AUTHENTICATED_GET"
  | "DETERMINISTIC_FIXTURE"
  | "GROUNDED_PAGE"
  | "CANONICAL_RUNTIME_FIXTURE"
  | "MODEL_PROPOSAL";

export type RuntimeEntityIdentity = {
  entityKind: string;
  entityId: string;
  source: RuntimeEntityIdentitySource;
  persona: BrowserPersona;
  identityVerified: boolean;
  ownershipVerified?: boolean;
  ownerId?: string;
  verifiedState?:
    Record<string, string | number | boolean | null>;
  verifiedStateKeys?: string[];
  targetIdentity?: {
    kind: "EXACT_TEXT" | "EXACT_ENTITY_ID";
    value: string;
  };
};

export type DeepRouteEntityRequirement = {
  param: string;
  entityKind: string;
  persona: BrowserPersona;
  ownerId?: string;
  requiresOwnershipVerification?: boolean;
  requiredState?:
    Record<string, string | number | boolean | null>;
};

export type BoundDeepRoute = {
  template: string;
  bindings: Record<string, string>;
  route: string;
  provenance: {
    templateOrigin:
      PlannerRouteEvidenceOrigin;
    templateSourceRef?: string;
    identities: Array<{
      param: string;
      entityKind: string;
      entityId: string;
      source:
        RuntimeEntityIdentitySource;
      identityVerified: boolean;
      ownershipVerified?: boolean;
      verifiedState?:
        Record<string, string | number | boolean | null>;
      verifiedStateKeys?: string[];
    }>;
  };
  targetIdentity?:
    RuntimeEntityIdentity["targetIdentity"];
};

export type DeepRouteBindingResult = {
  status: DeepRouteBindingStatus;
  reason: string;
  boundRoute?: BoundDeepRoute;
};

export type DeepRouteTargetObservation = {
  finalUrl: string;
  navigationSucceeded: boolean;
  exactSurfaceIdentities?: Array<{
    kind: "EXACT_TEXT" | "EXACT_ENTITY_ID";
    value: string;
  }>;
  notFoundOrError?: boolean;
  screenshotAvailable?: boolean;
  modelClaimsTarget?: boolean;
};

const authoritativeTemplateOrigins =
  new Set<PlannerRouteEvidenceOrigin>([
    "GITHUB_ROUTER_MAPPING",
    "UI_ROUTE_MANIFEST",
  ]);

function templateParams(
  template: string
): string[] {
  return [
    ...template.matchAll(
      /:([A-Za-z][A-Za-z0-9_]*)/g
    ),
  ].map((match) => match[1]!);
}

function validateTemplate(
  template: DeepRouteTemplate,
  persona: BrowserPersona
): DeepRouteBindingResult | undefined {
  if (
    !template.authoritative ||
    !authoritativeTemplateOrigins.has(
      template.sourceOrigin
    )
  ) {
    return {
      status: "NO_AUTHORITATIVE_TEMPLATE",
      reason:
        "Deep-route templates require an authoritative structural route origin.",
    };
  }

  if (
    template.disposition ===
    "RESOURCE_OR_API" ||
    /^https?:\/\//i.test(
      template.template
    ) ||
    template.template.startsWith("//") ||
    template.template.startsWith("/api/")
  ) {
    return {
      status: "ROUTE_REJECTED",
      reason:
        "External, resource, and API templates are not browser routes.",
    };
  }

  if (
    template.persona !== persona ||
    !isInternalBrowserRoute(
      template.template
    ) ||
    !isBrowserRouteCompatibleWithPersona(
      template.template,
      persona
    )
  ) {
    return {
      status: "ROUTE_REJECTED",
      reason:
        "The route template is not compatible with the requested persona.",
    };
  }

  const params = templateParams(
    template.template
  );
  const declared =
    template.requiredBindings.map(
      (binding) => binding.param
    );

  if (
    params.length === 0 ||
    params.length !== declared.length ||
    params.some(
      (param, index) =>
        param !== declared[index]
    ) ||
    new Set(params).size !== params.length
  ) {
    return {
      status: "BINDING_FAILED",
      reason:
        "Declared binding slots must exactly preserve template parameter names and order.",
    };
  }

  return undefined;
}

function isSafeIdentifier(
  identifier: string
): boolean {
  if (
    !identifier ||
    identifier.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(
      identifier
    ) ||
    identifier === "." ||
    identifier === ".." ||
    identifier.includes("/") ||
    identifier.includes("\\")
  ) {
    return false;
  }

  return true;
}

function stateCompatibility(
  candidate: RuntimeEntityIdentity,
  requirement: DeepRouteEntityRequirement
): "COMPATIBLE" | "MISMATCH" | "UNVERIFIED" {
  const requiredState =
    requirement.requiredState;

  if (
    !requiredState ||
    Object.keys(requiredState).length === 0
  ) {
    return "COMPATIBLE";
  }

  const verifiedKeys = new Set(
    candidate.verifiedStateKeys ?? []
  );

  for (
    const [key, value]
    of Object.entries(requiredState)
  ) {
    if (
      !verifiedKeys.has(key) ||
      !candidate.verifiedState ||
      !(key in candidate.verifiedState)
    ) {
      return "UNVERIFIED";
    }

    if (
      candidate.verifiedState[key] !==
      value
    ) {
      return "MISMATCH";
    }
  }

  return "COMPATIBLE";
}

function baseIdentityCompatible(
  candidate: RuntimeEntityIdentity,
  requirement: DeepRouteEntityRequirement
): boolean {
  if (
    !candidate.identityVerified ||
    candidate.source ===
      "MODEL_PROPOSAL" ||
    candidate.entityKind !==
      requirement.entityKind ||
    candidate.persona !==
      requirement.persona ||
    !isSafeIdentifier(
      candidate.entityId
    )
  ) {
    return false;
  }

  if (
    requirement
      .requiresOwnershipVerification &&
    !candidate.ownershipVerified
  ) {
    return false;
  }

  if (
    requirement.ownerId !== undefined &&
    (
      !candidate.ownershipVerified ||
      candidate.ownerId !==
        requirement.ownerId
    )
  ) {
    return false;
  }

  return true;
}

export function bindDeepRoute(
  template: DeepRouteTemplate,
  bindings: Record<string, string>
): DeepRouteBindingResult {
  const params = templateParams(
    template.template
  );
  const supplied = Object.keys(bindings);

  if (
    supplied.length !== params.length ||
    supplied.some(
      (param) => !params.includes(param)
    ) ||
    params.some(
      (param) =>
        !isSafeIdentifier(
          bindings[param] ?? ""
        )
    )
  ) {
    return {
      status: "BINDING_FAILED",
      reason:
        "Bindings must contain one safe verified value for every declared parameter and no extras.",
    };
  }

  let route = template.template;

  for (const param of params) {
    route = route.replace(
      `:${param}`,
      encodeURIComponent(
        bindings[param]!
      )
    );
  }

  if (
    templateParams(route).length > 0 ||
    !isInternalBrowserRoute(route) ||
    !isBrowserRouteCompatibleWithPersona(
      route,
      template.persona
    ) ||
    /^https?:\/\//i.test(route) ||
    route.startsWith("//")
  ) {
    return {
      status: "ROUTE_REJECTED",
      reason:
        "The concrete route failed internal persona-compatible route safety.",
    };
  }

  return {
    status: "RESOLVED",
    reason:
      "Every explicit route parameter was bound to a safe verified identity.",
    boundRoute: {
      template: template.template,
      bindings: Object.fromEntries(
        params.map((param) => [
          param,
          bindings[param]!,
        ])
      ),
      route,
      provenance: {
        templateOrigin:
          template.sourceOrigin,
        ...(template.sourceRef
          ? {
              templateSourceRef:
                template.sourceRef,
            }
          : {}),
        identities: [],
      },
    },
  };
}

export function resolveDeepRouteBinding(
  input: {
    template?: DeepRouteTemplate;
    persona: BrowserPersona;
    requirements:
      DeepRouteEntityRequirement[];
    candidates:
      RuntimeEntityIdentity[];
  }
): DeepRouteBindingResult {
  if (!input.template) {
    return {
      status: "NO_AUTHORITATIVE_TEMPLATE",
      reason:
        "No authoritative parameterized route template was available.",
    };
  }

  const invalidTemplate =
    validateTemplate(
      input.template,
      input.persona
    );

  if (invalidTemplate) {
    return invalidTemplate;
  }

  if (
    input.requirements.length === 0 ||
    input.candidates.length === 0
  ) {
    return {
      status: "RUNTIME_IDENTITY_REQUIRED",
      reason:
        "The template requires verified runtime identity candidates.",
    };
  }

  const requirementByParam = new Map(
    input.requirements.map(
      (requirement) => [
        requirement.param,
        requirement,
      ]
    )
  );
  const selected = new Map<
    string,
    RuntimeEntityIdentity
  >();

  for (
    const slot
    of input.template.requiredBindings
  ) {
    const requirement =
      requirementByParam.get(
        slot.param
      );

    if (
      !requirement ||
      requirement.entityKind !==
        slot.entityKind
    ) {
      return {
        status: "BINDING_FAILED",
        reason:
          `No exact entity requirement was supplied for :${slot.param}.`,
      };
    }

    const baseCompatible =
      input.candidates.filter(
        (candidate) =>
          baseIdentityCompatible(
            candidate,
            requirement
          )
      );
    const stateResults =
      baseCompatible.map(
        (candidate) => ({
          candidate,
          compatibility:
            stateCompatibility(
              candidate,
              requirement
            ),
        })
      );
    const compatible = [
      ...new Map(
        stateResults
          .filter(
            (item) =>
              item.compatibility ===
              "COMPATIBLE"
          )
          .map((item) => [
            item.candidate.entityId,
            item.candidate,
          ])
      ).values(),
    ];

    if (compatible.length > 1) {
      return {
        status: "AMBIGUOUS_ENTITY",
        reason:
          `Multiple equally compatible verified entities can bind :${slot.param}; no first-record fallback is permitted.`,
      };
    }

    if (compatible.length === 0) {
      if (
        stateResults.some(
          (item) =>
            item.compatibility ===
            "UNVERIFIED"
        )
      ) {
        return {
          status:
            "ENTITY_STATE_UNVERIFIED",
          reason:
            `Candidate identity for :${slot.param} exists, but the required state is not deterministically verified.`,
        };
      }

      return {
        status: "NO_COMPATIBLE_ENTITY",
        reason:
          `No verified compatible ${slot.entityKind} identity can bind :${slot.param}.`,
      };
    }

    selected.set(
      slot.param,
      compatible[0]!
    );
  }

  if (
    requirementByParam.size !==
    input.template.requiredBindings.length
  ) {
    return {
      status: "BINDING_FAILED",
      reason:
        "Unrelated entity requirements cannot be silently bound to a route template.",
    };
  }

  const binding = bindDeepRoute(
    input.template,
    Object.fromEntries(
      [...selected].map(
        ([param, candidate]) => [
          param,
          candidate.entityId,
        ]
      )
    )
  );

  if (!binding.boundRoute) {
    return binding;
  }

  const identities =
    input.template.requiredBindings.map(
      (slot) => {
        const identity =
          selected.get(slot.param)!;

        return {
          param: slot.param,
          entityKind:
            identity.entityKind,
          entityId:
            identity.entityId,
          source: identity.source,
          identityVerified:
            identity.identityVerified,
          ...(identity.ownershipVerified !== undefined
            ? {
                ownershipVerified:
                  identity.ownershipVerified,
              }
            : {}),
          ...(identity.verifiedState
            ? {
                verifiedState: {
                  ...identity.verifiedState,
                },
              }
            : {}),
          ...(identity.verifiedStateKeys
            ? {
                verifiedStateKeys: [
                  ...identity.verifiedStateKeys,
                ],
              }
            : {}),
        };
      }
    );
  const targetIdentities = [
    ...new Map(
      [...selected.values()]
        .filter(
          (identity) =>
            Boolean(
              identity.targetIdentity
            )
        )
        .map((identity) => [
          `${identity.targetIdentity!.kind}\u0000${identity.targetIdentity!.value}`,
          identity.targetIdentity!,
        ])
    ).values(),
  ];

  return {
    ...binding,
    boundRoute: {
      ...binding.boundRoute,
      provenance: {
        ...binding.boundRoute.provenance,
        identities,
      },
      ...(targetIdentities.length === 1
        ? {
            targetIdentity:
              targetIdentities[0],
          }
        : {}),
    },
  };
}

function internalRouteOf(
  routeOrUrl: string
): string {
  try {
    const parsed = new URL(
      routeOrUrl,
      "https://internal.invalid"
    );

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return routeOrUrl.split("#")[0] ?? "";
  }
}

export function verifyDeepRouteTarget(
  boundRoute: BoundDeepRoute,
  observation:
    DeepRouteTargetObservation
): DeepRouteBindingResult {
  if (!observation.navigationSucceeded) {
    return {
      status: "NAVIGATION_FAILED",
      reason:
        "The concrete route did not navigate successfully.",
    };
  }

  if (
    observation.notFoundOrError ||
    internalRouteOf(observation.finalUrl) !==
      internalRouteOf(boundRoute.route)
  ) {
    return {
      status:
        "TARGET_IDENTITY_UNVERIFIED",
      reason:
        "The final page was an error/fallback surface or did not preserve the bound route.",
    };
  }

  const target =
    boundRoute.targetIdentity;

  if (!target) {
    return {
      status:
        "TARGET_IDENTITY_UNVERIFIED",
      reason:
        "Route binding was preserved, but no deterministic target-surface identity was available.",
    };
  }

  const exactIdentityVisible =
    observation.exactSurfaceIdentities
      ?.some(
        (identity) =>
          identity.kind ===
            target.kind &&
          identity.value ===
            target.value
      ) ?? false;

  if (!exactIdentityVisible) {
    return {
      status:
        "TARGET_IDENTITY_UNVERIFIED",
      reason:
        "Navigation success, screenshots, or model claims cannot replace exact target identity on the rendered surface.",
    };
  }

  return {
    status: "TARGET_VERIFIED",
    reason:
      "The bound route was preserved and the verified exact target identity was present on a non-error surface.",
    boundRoute,
  };
}
