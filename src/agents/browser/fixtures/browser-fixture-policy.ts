export function browserFixtureProvisioningAllowed():
boolean {
  return (
    String(
      process.env
        .QA_ALLOW_BROWSER_FIXTURE_PROVISIONING ||
        ""
    ).toLowerCase() === "true"
  );
}
