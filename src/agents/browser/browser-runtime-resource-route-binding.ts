import type { RuntimeResourceContext } from "../../runtime/runtime-context.js";

export function resolveAssessmentRouteFromRuntimeResourceContext(args: {
  persona: string;
  runtimeResourceContext?: RuntimeResourceContext;
}): string | undefined {
  const assessmentId = String(args.runtimeResourceContext?.assessmentId ?? "").trim();
  if (!assessmentId) return undefined;
  if (args.persona === "company_admin") return `/company/assessments/${assessmentId}`;
  if (args.persona === "talent") return `/talent/assessments/${assessmentId}/prepare`;
  return undefined;
}
