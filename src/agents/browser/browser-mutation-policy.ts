export function browserMutationsAllowed(): boolean {
  return (
    String(
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS || ""
    ).toLowerCase() === "true"
  );
}

export function browserMutationPreflightRequested(): boolean {
  return (
    String(
      process.env
        .QA_BROWSER_MUTATION_PREFLIGHT || ""
    ).toLowerCase() === "true"
  );
}
