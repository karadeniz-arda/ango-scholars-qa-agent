export type GenericBrowserActionSafetyClass =
  | "TRANSIENT_REVEAL"
  | "TRANSIENT_VALUE_CHANGE"
  | "PERSISTED_OR_CONSEQUENTIAL_CHANGE";

export type ClassifyGenericBrowserActionSafetyArgs = {
  actionKind: string;
  targetSource: "control" | "input";
  targetKind?: string;
  label: string;
  activationSafe?: boolean;
  externalPopup?: boolean;
  semanticOptionBinding?: boolean;
};

/*
 * GENERIC_BROWSER_ACTION_SAFETY_CLASSIFICATION_V1
 *
 * Classify the semantic effect boundary independently from:
 *
 * - mutation permission,
 * - target grounding,
 * - execution support,
 * - deterministic proof,
 * - final verdict.
 *
 * Authorization remains a separate deterministic decision.
 */
const CONSEQUENCE_RISK_LABEL =
  /\b(?:accept|apply|approve|archive|checkout|confirm|create|deactivate|delete|disable|enable|invite|log\s*out|pay|publish|reject|remove|save|send|sign\s*out|submit|update|upload)\b/i;

export function classifyGenericBrowserActionSafety(
  args: ClassifyGenericBrowserActionSafetyArgs
): GenericBrowserActionSafetyClass {
  const {
    actionKind,
    targetSource,
    targetKind,
    label,
    activationSafe,
    externalPopup,
    semanticOptionBinding,
  } = args;

  const semanticBoundOptionClick =
    actionKind === "click" &&
    targetSource === "control" &&
    targetKind === "option" &&
    semanticOptionBinding === true;

  /*
   * Proven semantic option provenance wins over lexical wording.
   *
   * Example: a visible option labelled "Publish" may represent a
   * transient enum value rather than the consequential Publish
   * command. B4C already proves this exact identity relationship.
   */
  if (semanticBoundOptionClick) {
    return "TRANSIENT_VALUE_CHANGE";
  }

  if (CONSEQUENCE_RISK_LABEL.test(label)) {
    return "PERSISTED_OR_CONSEQUENTIAL_CHANGE";
  }

  if (actionKind === "fill") {
    return "PERSISTED_OR_CONSEQUENTIAL_CHANGE";
  }

  if (actionKind === "select") {
    return "TRANSIENT_VALUE_CHANGE";
  }

  /*
   * Unknown executable action kinds fail closed.
   */
  if (actionKind !== "click") {
    return "PERSISTED_OR_CONSEQUENTIAL_CHANGE";
  }

  if (targetSource === "input") {
    return activationSafe === true
      ? "TRANSIENT_REVEAL"
      : "PERSISTED_OR_CONSEQUENTIAL_CHANGE";
  }

  if (
    targetKind === "option" ||
    externalPopup === true
  ) {
    return "TRANSIENT_VALUE_CHANGE";
  }

  return "TRANSIENT_REVEAL";
}
