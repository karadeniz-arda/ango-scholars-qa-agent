import type { BrowserPassRuntimeSignal } from "./browser-deterministic-pass-runtime-context.js";
import type { BrowserRouteProbeResult } from "./browser-route-probe.js";
import type { RuntimeNavigationBinding } from "../../planner/types.js";

export type BrowserRuntimeRouteAcceptance = {
  caseId: string;
  persona: "company_admin" | "talent";
  routePath: string;
  source:
    | "BOUNDED_RUNTIME_ROUTE_PROBE"
    | "COMPOSED_RUNTIME_NAVIGATION_BINDING";
};

function concreteRoute(value: string | undefined): string | null {
  const route = String(value ?? "").trim();
  return route.startsWith("/") && !route.startsWith("//") ? route : null;
}

/**
 * Converts only an explicitly accepted bounded route probe into execution
 * context. Visiting a route, or a probe rejection, remains non-authoritative.
 */
export function acceptedRuntimeRouteFromProbe(args: {
  caseId: string;
  persona: "company_admin" | "talent";
  probeResult: BrowserRouteProbeResult;
}): BrowserRuntimeRouteAcceptance | null {
  const routePath = concreteRoute(args.probeResult.acceptedRoute);
  if (!routePath) return null;
  if (!args.probeResult.attempts.some((attempt) =>
    attempt.route === routePath && attempt.accepted === true
  )) return null;
  return {
    caseId: args.caseId,
    persona: args.persona,
    routePath,
    source: "BOUNDED_RUNTIME_ROUTE_PROBE",
  };
}

/**
 * Transports only a finalized composed-runtime navigation binding. The caller
 * must already have established the composed fixture/navigation lifecycle;
 * this adapter does not infer authority from the current page URL.
 */
export function acceptedRuntimeRouteFromNavigationBinding(args: {
  caseId: string;
  persona: "company_admin" | "talent";
  composedExecutionCaseId: string;
  binding: RuntimeNavigationBinding | null | undefined;
}): BrowserRuntimeRouteAcceptance | null {
  const binding = args.binding;
  const routePath = concreteRoute(binding?.concreteRoute);
  if (
    !binding ||
    !routePath ||
    binding.status !== "RESOLVED" ||
    binding.navigationReadyForExecution !== true ||
    !args.composedExecutionCaseId ||
    binding.executionCaseId !== args.composedExecutionCaseId ||
    binding.persona !== args.persona
  ) {
    return null;
  }
  return {
    caseId: args.caseId,
    persona: args.persona,
    routePath,
    source: "COMPOSED_RUNTIME_NAVIGATION_BINDING",
  };
}

/** Reuses a previously accepted shared probe only for the same runtime persona. */
export function rebindAcceptedRuntimeRoute(args: {
  acceptance: BrowserRuntimeRouteAcceptance;
  caseId: string;
  persona: "company_admin" | "talent";
}): BrowserRuntimeRouteAcceptance | null {
  if (args.acceptance.persona !== args.persona) return null;
  return { ...args.acceptance, caseId: args.caseId };
}

/**
 * Execution context transport only: this makes no target, fixture, proof, or
 * source-route claim. The case verdict still enforces source exact routes.
 */
export function acceptedRuntimeRouteAuthority(args: {
  acceptance?: BrowserRuntimeRouteAcceptance;
  caseId: string;
  actualPersona: "company_admin" | "talent";
}): BrowserPassRuntimeSignal<string> {
  const acceptance = args.acceptance;
  if (!acceptance || acceptance.caseId !== args.caseId) {
    return { status: "UNAVAILABLE", reason: "No bounded runtime route acceptance was recorded for this case." };
  }
  if (acceptance.persona !== args.actualPersona) {
    return { status: "UNAVAILABLE", reason: "The bounded runtime route acceptance belongs to a different persona." };
  }
  return {
    status: "AVAILABLE",
    value: acceptance.routePath,
    source:
      acceptance.source === "COMPOSED_RUNTIME_NAVIGATION_BINDING"
        ? "Finalized composed runtime navigation binding accepted this route for the same case and persona."
        : "Bounded runtime route probe accepted this route for the same case and persona.",
  };
}
