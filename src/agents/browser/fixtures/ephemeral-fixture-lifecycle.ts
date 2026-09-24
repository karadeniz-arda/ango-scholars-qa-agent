/**
 * Generic, fail-closed lease lifecycle for adapters that can prove an
 * ephemeral fixture is owned by the current run.  It deliberately carries no
 * acceptance or proof state: fixture setup makes execution possible, never
 * proves product behaviour.
 */

export type EphemeralFixtureLifecycleEvent =
  | "FIXTURE_DISCOVERY_STARTED"
  | "FIXTURE_REUSE_SELECTED"
  | "FIXTURE_PROVISIONING_REQUESTED"
  | "FIXTURE_CREATED"
  | "FIXTURE_CREATED_STATE_VERIFIED"
  | "FIXTURE_LEASE_CREATED"
  | "FIXTURE_CLEANUP_STARTED"
  | "FIXTURE_CLEANUP_SUCCEEDED"
  | "FIXTURE_CLEANUP_FAILED"
  | "FIXTURE_CLEANUP_VERIFIED";

export type EphemeralFixtureLifecycleTelemetry = {
  event: EphemeralFixtureLifecycleEvent;
  fixtureType: string;
  runId: string;
  resourceIds: string[];
  adapterId?: string;
  note: string;
};

export type EphemeralFixtureRequirement = {
  fixtureType: string;
  sourceAuthorized: boolean;
};

export type CompatibleFixture<TExecutionContext> = {
  resourceIds: string[];
  executionContext: TExecutionContext;
};

export type CreatedEphemeralFixture<TExecutionContext> = {
  resourceIds: string[];
  executionContext: TExecutionContext;
  marker?: string;
};

export type EphemeralFixtureLease<TExecutionContext> = {
  strategy: "REUSE_EXISTING" | "CREATE_EPHEMERAL";
  fixtureType: string;
  resourceIds: string[];
  ownership: {
    createdByCurrentRun: boolean;
    runId: string;
    marker?: string;
  };
  executionContext: TExecutionContext;
  cleanup: {
    required: boolean;
    adapterId?: string;
  };
};

export type EphemeralFixtureProvisioningPermissions = {
  apiMutationsAllowed: boolean;
  browserMutationsAllowed: boolean;
  browserFixtureProvisioningAllowed: boolean;
  requireFixtureCleanup: boolean;
};

export type EphemeralFixtureProvisioningChannel =
  | "API"
  | "BROWSER";

export type EphemeralFixtureProvisioner<
  TRequirement extends EphemeralFixtureRequirement,
  TExecutionContext,
> = {
  id: string;
  channel: EphemeralFixtureProvisioningChannel;
  supports: (requirement: TRequirement) => boolean;
  create: (
    requirement: TRequirement,
    context: { runId: string }
  ) => Promise<CreatedEphemeralFixture<TExecutionContext>>;
  verifyCreated: (
    created: CreatedEphemeralFixture<TExecutionContext>,
    requirement: TRequirement
  ) => Promise<boolean>;
  cleanup: (
    lease: EphemeralFixtureLease<TExecutionContext>
  ) => Promise<boolean>;
  verifyCleanup: (
    lease: EphemeralFixtureLease<TExecutionContext>
  ) => Promise<boolean>;
};

export type AcquireEphemeralFixtureArgs<
  TRequirement extends EphemeralFixtureRequirement,
  TExecutionContext,
> = {
  requirement: TRequirement;
  runId: string;
  permissions: EphemeralFixtureProvisioningPermissions;
  discoverCompatible: (
    requirement: TRequirement
  ) => Promise<CompatibleFixture<TExecutionContext>[]>;
  provisioner?: EphemeralFixtureProvisioner<
    TRequirement,
    TExecutionContext
  >;
};

export type EphemeralFixtureCleanupAudit = {
  status: "NOT_REQUIRED" | "VERIFIED" | "FAILED";
  telemetry: EphemeralFixtureLifecycleTelemetry[];
  reason?: string;
};

export type EphemeralFixtureAcquisition<
  TExecutionContext,
> =
  | {
      status: "READY";
      lease: EphemeralFixtureLease<TExecutionContext>;
      telemetry: EphemeralFixtureLifecycleTelemetry[];
    }
  | {
      status: "BLOCKED" | "ERROR";
      reason: string;
      cleanupAudit: EphemeralFixtureCleanupAudit;
      telemetry: EphemeralFixtureLifecycleTelemetry[];
    };

function validString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function exactResourceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const ids = value.map((item) =>
    typeof item === "string" ? item.trim() : ""
  );

  return (
    ids.every(validString) &&
    new Set(ids).size === ids.length
  )
    ? ids
    : null;
}

function appendTelemetry(
  telemetry: EphemeralFixtureLifecycleTelemetry[],
  input: Omit<EphemeralFixtureLifecycleTelemetry, "resourceIds">
    & { resourceIds?: string[] }
): void {
  telemetry.push({
    ...input,
    resourceIds: input.resourceIds ?? [],
  });
}

export function ephemeralFixtureProvisioningAllowed(
  channel: EphemeralFixtureProvisioningChannel,
  permissions: EphemeralFixtureProvisioningPermissions
): boolean {
  if (!permissions.requireFixtureCleanup) {
    return false;
  }

  switch (channel) {
    case "API":
      return permissions.apiMutationsAllowed;
    case "BROWSER":
      return (
        permissions.browserMutationsAllowed &&
        permissions.browserFixtureProvisioningAllowed
      );
  }
}

function reusedLease<TExecutionContext>(args: {
  requirement: EphemeralFixtureRequirement;
  runId: string;
  candidate: CompatibleFixture<TExecutionContext>;
}): EphemeralFixtureLease<TExecutionContext> | null {
  const resourceIds = exactResourceIds(args.candidate.resourceIds);

  if (!resourceIds) {
    return null;
  }

  return {
    strategy: "REUSE_EXISTING",
    fixtureType: args.requirement.fixtureType,
    resourceIds,
    ownership: {
      createdByCurrentRun: false,
      runId: args.runId,
    },
    executionContext: args.candidate.executionContext,
    cleanup: { required: false },
  };
}

function createdLease<TExecutionContext>(args: {
  requirement: EphemeralFixtureRequirement;
  runId: string;
  provisionerId: string;
  created: CreatedEphemeralFixture<TExecutionContext>;
}): EphemeralFixtureLease<TExecutionContext> | null {
  const resourceIds = exactResourceIds(args.created.resourceIds);

  if (!resourceIds) {
    return null;
  }

  return {
    strategy: "CREATE_EPHEMERAL",
    fixtureType: args.requirement.fixtureType,
    resourceIds,
    ownership: {
      createdByCurrentRun: true,
      runId: args.runId,
      ...(validString(args.created.marker)
        ? { marker: args.created.marker }
        : {}),
    },
    executionContext: args.created.executionContext,
    cleanup: {
      required: true,
      adapterId: args.provisionerId,
    },
  };
}

export async function releaseEphemeralFixture<
  TRequirement extends EphemeralFixtureRequirement,
  TExecutionContext,
>(args: {
  lease: EphemeralFixtureLease<TExecutionContext>;
  provisioner?: EphemeralFixtureProvisioner<
    TRequirement,
    TExecutionContext
  >;
}): Promise<EphemeralFixtureCleanupAudit> {
  const telemetry: EphemeralFixtureLifecycleTelemetry[] = [];
  const { lease } = args;

  if (!lease.cleanup.required) {
    return { status: "NOT_REQUIRED", telemetry };
  }

  if (
    lease.strategy !== "CREATE_EPHEMERAL" ||
    !lease.ownership.createdByCurrentRun ||
    !lease.cleanup.adapterId ||
    args.provisioner?.id !== lease.cleanup.adapterId ||
    !exactResourceIds(lease.resourceIds)
  ) {
    return {
      status: "FAILED",
      reason: "The fixture lease does not establish exact current-run cleanup authority.",
      telemetry,
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_CLEANUP_STARTED",
    fixtureType: lease.fixtureType,
    runId: lease.ownership.runId,
    resourceIds: lease.resourceIds,
    adapterId: lease.cleanup.adapterId,
    note: "Cleaning up exact resource IDs owned by the current run.",
  });

  let cleaned = false;

  try {
    cleaned = await args.provisioner.cleanup(lease);
  } catch {
    cleaned = false;
  }

  if (!cleaned) {
    appendTelemetry(telemetry, {
      event: "FIXTURE_CLEANUP_FAILED",
      fixtureType: lease.fixtureType,
      runId: lease.ownership.runId,
      resourceIds: lease.resourceIds,
      adapterId: lease.cleanup.adapterId,
      note: "Exact fixture cleanup failed.",
    });
    return {
      status: "FAILED",
      reason: "Exact fixture cleanup failed.",
      telemetry,
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_CLEANUP_SUCCEEDED",
    fixtureType: lease.fixtureType,
    runId: lease.ownership.runId,
    resourceIds: lease.resourceIds,
    adapterId: lease.cleanup.adapterId,
    note: "Exact fixture cleanup succeeded; verifying absence.",
  });

  let verified = false;

  try {
    verified = await args.provisioner.verifyCleanup(lease);
  } catch {
    verified = false;
  }

  if (!verified) {
    appendTelemetry(telemetry, {
      event: "FIXTURE_CLEANUP_FAILED",
      fixtureType: lease.fixtureType,
      runId: lease.ownership.runId,
      resourceIds: lease.resourceIds,
      adapterId: lease.cleanup.adapterId,
      note: "Fixture cleanup could not be verified.",
    });
    return {
      status: "FAILED",
      reason: "Exact fixture cleanup verification failed.",
      telemetry,
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_CLEANUP_VERIFIED",
    fixtureType: lease.fixtureType,
    runId: lease.ownership.runId,
    resourceIds: lease.resourceIds,
    adapterId: lease.cleanup.adapterId,
    note: "Exact fixture cleanup was verified.",
  });

  return { status: "VERIFIED", telemetry };
}

export async function acquireEphemeralFixture<
  TRequirement extends EphemeralFixtureRequirement,
  TExecutionContext,
>(args: AcquireEphemeralFixtureArgs<TRequirement, TExecutionContext>): Promise<
  EphemeralFixtureAcquisition<TExecutionContext>
> {
  const telemetry: EphemeralFixtureLifecycleTelemetry[] = [];
  const requirement = args.requirement;

  if (!validString(requirement.fixtureType) || !validString(args.runId)) {
    return {
      status: "ERROR",
      reason: "Fixture lifecycle requires a bounded fixture type and run ID.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  if (!requirement.sourceAuthorized) {
    return {
      status: "BLOCKED",
      reason: "Fixture provisioning requires source-authorized fixture authority.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_DISCOVERY_STARTED",
    fixtureType: requirement.fixtureType,
    runId: args.runId,
    note: "Discovering exact compatible fixtures before considering provisioning.",
  });

  let compatible: CompatibleFixture<TExecutionContext>[];

  try {
    compatible = await args.discoverCompatible(requirement);
  } catch {
    return {
      status: "ERROR",
      reason: "Compatible fixture discovery threw.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  if (compatible.length === 1) {
    const lease = reusedLease({
      requirement,
      runId: args.runId,
      candidate: compatible[0]!,
    });

    if (!lease) {
      return {
        status: "ERROR",
        reason: "The reused fixture is missing exact resource IDs.",
        cleanupAudit: { status: "NOT_REQUIRED", telemetry },
        telemetry,
      };
    }

    appendTelemetry(telemetry, {
      event: "FIXTURE_REUSE_SELECTED",
      fixtureType: requirement.fixtureType,
      runId: args.runId,
      resourceIds: lease.resourceIds,
      note: "One exact compatible existing fixture was selected without cleanup ownership.",
    });

    return { status: "READY", lease, telemetry };
  }

  if (compatible.length > 1) {
    return {
      status: "BLOCKED",
      reason: "Multiple compatible fixtures were discovered; ambiguity remains fail closed.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  const provisioner = args.provisioner;

  if (!provisioner || !provisioner.supports(requirement)) {
    return {
      status: "BLOCKED",
      reason: "No supported ephemeral fixture provisioner is available.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  if (
    !ephemeralFixtureProvisioningAllowed(
      provisioner.channel,
      args.permissions
    )
  ) {
    return {
      status: "BLOCKED",
      reason: `No compatible fixture exists and ${
        provisioner.channel === "API"
          ? "API mutation"
          : "browser mutation and browser fixture-provisioning"
      } authority plus mandatory cleanup are required.`,
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_PROVISIONING_REQUESTED",
    fixtureType: requirement.fixtureType,
    runId: args.runId,
    adapterId: provisioner.id,
    note: "No compatible fixture exists; requesting explicitly authorized ephemeral provisioning.",
  });

  let created: CreatedEphemeralFixture<TExecutionContext>;

  try {
    created = await provisioner.create(requirement, { runId: args.runId });
  } catch {
    return {
      status: "ERROR",
      reason: "Ephemeral fixture creation threw before ownership was established.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  const lease = createdLease({
    requirement,
    runId: args.runId,
    provisionerId: provisioner.id,
    created,
  });

  if (!lease) {
    return {
      status: "ERROR",
      reason: "Ephemeral fixture creation did not return exact owned resource IDs.",
      cleanupAudit: { status: "NOT_REQUIRED", telemetry },
      telemetry,
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_CREATED",
    fixtureType: requirement.fixtureType,
    runId: args.runId,
    resourceIds: lease.resourceIds,
    adapterId: provisioner.id,
    note: "Ephemeral fixture was created with exact current-run resource IDs.",
  });

  let validCreatedState = false;

  try {
    validCreatedState = await provisioner.verifyCreated(created, requirement);
  } catch {
    validCreatedState = false;
  }

  if (!validCreatedState) {
    const cleanupAudit = await releaseEphemeralFixture({
      lease,
      provisioner,
    });
    return {
      status: "BLOCKED",
      reason: cleanupAudit.status === "VERIFIED"
        ? "Created fixture did not satisfy the exact required state."
        : "Created fixture did not satisfy the exact required state and cleanup failed.",
      cleanupAudit,
      telemetry: [...telemetry, ...cleanupAudit.telemetry],
    };
  }

  appendTelemetry(telemetry, {
    event: "FIXTURE_CREATED_STATE_VERIFIED",
    fixtureType: requirement.fixtureType,
    runId: args.runId,
    resourceIds: lease.resourceIds,
    adapterId: provisioner.id,
    note: "Created fixture satisfies the adapter's exact required state.",
  });
  appendTelemetry(telemetry, {
    event: "FIXTURE_LEASE_CREATED",
    fixtureType: requirement.fixtureType,
    runId: args.runId,
    resourceIds: lease.resourceIds,
    adapterId: provisioner.id,
    note: "Fixture lease created; cleanup is mandatory after execution.",
  });

  return { status: "READY", lease, telemetry };
}

export async function runWithEphemeralFixtureLease<
  TRequirement extends EphemeralFixtureRequirement,
  TExecutionContext,
  TResult,
>(args: AcquireEphemeralFixtureArgs<TRequirement, TExecutionContext> & {
  run: (lease: EphemeralFixtureLease<TExecutionContext>) => Promise<TResult>;
}): Promise<
  | {
      status: "BLOCKED" | "ERROR";
      reason: string;
      acquisition: EphemeralFixtureAcquisition<TExecutionContext>;
    }
  | {
      status: "COMPLETED" | "CLEANUP_FAILED" | "EXECUTION_ERROR";
      result?: TResult;
      error?: unknown;
      lease: EphemeralFixtureLease<TExecutionContext>;
      cleanupAudit: EphemeralFixtureCleanupAudit;
    }
> {
  const acquisition = await acquireEphemeralFixture(args);

  if (acquisition.status !== "READY") {
    return {
      status: acquisition.status,
      reason: acquisition.reason,
      acquisition,
    };
  }

  let result: TResult | undefined;
  let error: unknown;

  try {
    result = await args.run(acquisition.lease);
  } catch (caught: unknown) {
    error = caught;
  } finally {
    const cleanupAudit = await releaseEphemeralFixture({
      lease: acquisition.lease,
      ...(args.provisioner
        ? { provisioner: args.provisioner }
        : {}),
    });

    if (cleanupAudit.status === "FAILED") {
      return {
        status: "CLEANUP_FAILED",
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
        lease: acquisition.lease,
        cleanupAudit,
      };
    }

    if (error !== undefined) {
      return {
        status: "EXECUTION_ERROR",
        error,
        lease: acquisition.lease,
        cleanupAudit,
      };
    }

    return {
      status: "COMPLETED",
      result: result!,
      lease: acquisition.lease,
      cleanupAudit,
    };
  }
}
