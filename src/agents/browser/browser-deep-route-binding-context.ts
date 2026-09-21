import type {
  BoundDeepRoute,
  DeepRouteBindingStatus,
} from "./browser-deep-route-binding.js";

export type RuntimeDeepRouteBinding = {
  status: DeepRouteBindingStatus;
  reason: string;
  boundRoute?: BoundDeepRoute;
};

export function getRuntimeDeepRouteBinding(
  testCase: any
): RuntimeDeepRouteBinding | undefined {
  const value =
    testCase?.runtimeDeepRouteBinding;

  if (
    !value ||
    typeof value !== "object" ||
    typeof value.status !== "string" ||
    typeof value.reason !== "string"
  ) {
    return undefined;
  }

  return value as RuntimeDeepRouteBinding;
}

export function setRuntimeDeepRouteBinding(
  testCase: any,
  value:
    RuntimeDeepRouteBinding |
    undefined
): void {
  delete testCase.runtimeDeepRouteBinding;

  if (value) {
    testCase.runtimeDeepRouteBinding =
      structuredClone(value);
  }
}

export function copyRuntimeDeepRouteBinding(
  sourceCase: any,
  targetCase: any
): void {
  setRuntimeDeepRouteBinding(
    targetCase,
    getRuntimeDeepRouteBinding(
      sourceCase
    )
  );
}
