import fs from "node:fs";
import yaml from "yaml";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD";

export type ApiEndpointEntry = {
  method: HttpMethod;
  path: string;
  file?: string;
  params?: string[];
  area?: string;
  source?: string;
};

type ApiEndpointsManifest = {
  endpoints?: ApiEndpointEntry[];
};

type ApiEndpointCandidate = {
  method: HttpMethod;
  path: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

let cachedEndpoints: ApiEndpointEntry[] | undefined;

function readApiCatalog(): ApiEndpointEntry[] {
  if (cachedEndpoints) return cachedEndpoints;

  const manifestPath =
    process.env.QA_API_ENDPOINTS_MANIFEST || "config/api-endpoints.manifest.yaml";

  if (!fs.existsSync(manifestPath)) {
    cachedEndpoints = [];
    return cachedEndpoints;
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = yaml.parse(raw) as ApiEndpointsManifest;

  cachedEndpoints = Array.isArray(parsed.endpoints) ? parsed.endpoints : [];
  return cachedEndpoints;
}

function collectApiCaseText(plan: any, apiCase: any): string {
  return [
    plan?.issueKey,
    plan?.summary,
    plan?.notes,
    apiCase?.id,
    apiCase?.persona,
    apiCase?.method,
    apiCase?.path,
    apiCase?.expect?.notes,
    apiCase?.expect?.note,
    JSON.stringify(apiCase?.body || {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function collectApiCaseSpecificText(apiCase: any): string {
  return [
    apiCase?.id,
    apiCase?.persona,
    apiCase?.method,
    apiCase?.path,
    apiCase?.notes,
    apiCase?.expect?.notes,
    apiCase?.expect?.note,
    JSON.stringify(apiCase?.body || {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferWantedArea(text: string): string | undefined {
  if (
    text.includes("work setup") ||
    text.includes("work-setup") ||
    text.includes("work setups") ||
    text.includes("talent-job-work-setup")
  ) {
    return "work-setups";
  }

  if (
  text.includes("talent profile language") ||
  text.includes("talent onboarding") ||
  text.includes("language proficiency dto") ||
  text.includes("createtalentlanguage") ||
  text.includes("updatetalentlanguage") ||
  text.includes("listeninglevel") ||
  text.includes("speakinglevel") ||
  text.includes("writinglevel") ||
  text.includes("readinglevel")
) {
  return "languages";
}

  if (
  text.includes("assessment") ||
  text.includes("assessment detail") ||
  text.includes("assessment submission") ||
  text.includes("language requirements")
) {
  return "assessments";
}

  if (
    text.includes("skillids") ||
    text.includes("skill ids") ||
    text.includes("skill selector") ||
    text.includes("selected skills") ||
    text.includes("main discipline") ||
    text.includes("maindiscipline") ||
    text.includes("category") ||
    text.includes("skills")
  ) {
    return "skills";
  }


  if (
    text.includes("job") ||
    text.includes("jobs") ||
    text.includes("sort") ||
    text.includes("newest") ||
    text.includes("latest") ||
    text.includes("oldest")
  ) {
    return "jobs";
  }

  /**
   * Invoice/payment language must be evaluated before generic
   * "contract" wording. Phrases such as "response contract"
   * describe an API schema, not the Contracts product area.
   */
  if (
    text.includes("invoice") ||
    text.includes("payment") ||
    text.includes("payout") ||
    text.includes("timesheet")
  ) {
    return "payments";
  }

  if (
    text.includes("contract details") ||
    text.includes("talent contract") ||
    text.includes("company contract") ||
    text.includes("/contracts") ||
    text.includes("contracts endpoint") ||
    text.includes("contract list")
  ) {
    return "contracts";
  }

  if (text.includes("offer")) return "offers";

  if (text.includes("language")) return "languages";

  return undefined;
}

function areApiAreasCompatible(
  wantedArea: string,
  selectedArea: string
): boolean {
  const wanted = wantedArea.toLowerCase();
  const selected = selectedArea.toLowerCase();

  if (wanted === selected) {
    return true;
  }

  /**
   * These domains may legitimately share data or endpoints.
   * Unrelated domains such as assessments -> skills are still rejected.
   */
  const compatibleGroups = [
  new Set(["contracts", "offers", "payments"]),
];

  return compatibleGroups.some(
    (group) => group.has(wanted) && group.has(selected)
  );
}

function isMutatingApiMethod(method: string): boolean {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(
    method.toUpperCase()
  );
}

function isTalentLanguageProfileCase(text: string): boolean {
  return (
    text.includes("talent profile") ||
    text.includes("talent onboarding") ||
    text.includes("createtalentlanguage") ||
    text.includes("updatetalentlanguage") ||
    text.includes("listeninglevel") ||
    text.includes("speakinglevel") ||
    text.includes("writinglevel") ||
    text.includes("readinglevel")
  );
}

function isInvoicePaymentCase(text: string): boolean {
  return (
    text.includes("invoice") ||
    text.includes("invoice details") ||
    text.includes("invoice-detail")
  );
}

function isCanonicalInvoiceDetailPath(
  endpoint: ApiEndpointEntry
): boolean {
  const path = String(
    endpoint.path || ""
  ).toLowerCase();

  const params = (
    endpoint.params || []
  ).map((param) =>
    String(param).toLowerCase()
  );

  return (
    params.includes("invoiceid") &&
    /\/invoices\/\{invoiceid\}$/.test(path)
  );
}

function endpointPassesRelevanceGate(
  endpoint: ApiEndpointEntry,
  wantedArea: string | undefined,
  caseText: string,
  requestedMethod: string,
  persona: string
): boolean {
  const selectedArea = String(endpoint.area || "").toLowerCase();
  const path = String(endpoint.path || "").toLowerCase();
  const endpointMethod = String(endpoint.method || "").toUpperCase();



  if (
    wantedArea &&
    selectedArea &&
    !areApiAreasCompatible(wantedArea, selectedArea)
  ) {
    return false;
  }

  /**
   * Contracts, offers, and payments sometimes share data, but an
   * invoice-details API case must never be enriched to a generic
   * contracts or offers endpoint.
   */
  if (
    isInvoicePaymentCase(caseText) &&
    selectedArea !== "payments"
  ) {
    return false;
  }

  /**
   * A details request must not resolve to the invoice list,
   * approve, cancel, export, or another invoice action route.
   */
  if (
    wantedArea === "payments" &&
    isInvoicePaymentCase(caseText) &&
    wantsDetailEndpoint(caseText) &&
    !isCanonicalInvoiceDetailPath(endpoint)
  ) {
    return false;
  }

  if (wantedArea === "assessments") {
  const isCompanyAssessmentList =
    path === "/companies/{companyid}/assessments";

  /**
   * Only accept the explicitly named assessmentId parameter.
   * Avoid generic {id}, because runtime context may contain an unrelated id.
   */
  const isCompanyAssessmentDetail =
    path ===
    "/companies/{companyid}/assessments/{assessmentid}";

  if (
    isCompanyAssessmentDetailCase(caseText) &&
    !isCompanyAssessmentDetail
  ) {
    return false;
  }

  if (
    isCompanyAssessmentCreateCase(
      caseText,
      requestedMethod
    ) &&
    !isCompanyAssessmentList
  ) {
    return false;
  }
}
  /**
   * /languages is a shared language metadata list.
   * It must not impersonate talent profile language CRUD endpoints.
   */
  if (
    wantedArea === "languages" &&
    isTalentLanguageProfileCase(caseText)
  ) {
    const isTalentLanguagePath =
      path.includes("/talents/") &&
      path.includes("/languages");

    if (!isTalentLanguagePath) {
      return false;
    }

    /**
     * A talent session must not use a company-scoped talent language route.
     */
    if (persona === "talent" && path.startsWith("/companies/")) {
      return false;
    }

    /**
     * Profile mutation cases must not turn a discovered GET route
     * into POST/PATCH merely because the path looks related.
     */
    if (endpointMethod !== requestedMethod) {
      return false;
    }
  }

  /**
   * Prevent generic read-only metadata endpoints from being used
   * as invented mutation routes.
   */
  if (
    isMutatingApiMethod(requestedMethod) &&
    (path === "/languages" || path === "/skills") &&
    endpointMethod !== requestedMethod
  ) {
    return false;
  }

  return true;
}

function isSkillFilterCase(text: string): boolean {
  return (
    text.includes("skillids") ||
    text.includes("skill ids") ||
    text.includes("skill selector") ||
    text.includes("selected skills") ||
    text.includes("main discipline") ||
    text.includes("maindiscipline") ||
    text.includes("category")
  );
}

function wantsListEndpoint(text: string): boolean {
  return (
    text.includes("list") ||
    text.includes("fetch") ||
    text.includes("filter") ||
    text.includes("search") ||
    text.includes("pagination") ||
    text.includes("sort") ||
    text.includes("category") ||
    text.includes("main discipline") ||
    text.includes("maindiscipline") ||
    text.includes("skillids") ||
    text.includes("skill ids")
  );
}

function wantsDetailEndpoint(text: string): boolean {
  return (
    text.includes("detail") ||
    text.includes("details") ||
    text.includes("by id") ||
    text.includes("specific") ||
    text.includes("created resource") ||
    text.includes("existing resource")
  );
}


function isExplicitPublicJobsCase(text: string): boolean {
  return (
    text.includes("public job") ||
    text.includes("public jobs") ||
    text.includes("/public/jobs")
  );
}

function isJobsListCase(text: string): boolean {
  const mentionsJobs = text.includes("job") || text.includes("jobs");

  if (!mentionsJobs) return false;

  return (
    text.includes("jobs list") ||
    text.includes("job list") ||
    text.includes("all-jobs") ||
    text.includes("list endpoint") ||
    text.includes("project filter") ||
    text.includes("filtered by") ||
    text.includes("pagination") ||
    text.includes("sort") ||
    text.includes("sortby") ||
    text.includes("sortorder") ||
    text.includes("sort=") ||
    text.includes("limit=") ||
    text.includes("offset=") ||
    text.includes("search") ||
    text.includes("filter")
  );
}

function isJobsSortOrQueryCase(text: string): boolean {
  return (
    text.includes("sort") ||
    text.includes("sortby") ||
    text.includes("sortorder") ||
    text.includes("sort=") ||
    text.includes("limit=") ||
    text.includes("offset=") ||
    text.includes("projectid") ||
    text.includes("project=")
  );
}

function isJobsDetailPath(path: string, params: string[]): boolean {
  const lowerPath = path.toLowerCase();

  if (!lowerPath.includes("jobs")) return false;

  return (
    params.includes("jobId") ||
    params.includes("id") ||
    /\/jobs\/\{[^}]+\}/i.test(path)
  );
}

function isJobsListPath(path: string, params: string[]): boolean {
  const lowerPath = path.toLowerCase();

  if (!lowerPath.includes("jobs")) return false;
  if (isJobsDetailPath(path, params)) return false;

  return (
    lowerPath === "/jobs" ||
    lowerPath.endsWith("/jobs") ||
    lowerPath.includes("/jobs?") ||
    lowerPath === "/public/jobs" ||
    lowerPath.endsWith("/all-jobs")
  );
}

type WorkSetupEndpointIntent =
  | "company-list"
  | "company-create"
  | "company-by-id"
  | "company-by-family"
  | "company-version-create"
  | "company-family-delete"
  | "company-job-link"
  | "company-review-list"
  | "company-review-approve"
  | "company-review-reject"
  | "talent-list"
  | "talent-submit";

function inferWorkSetupEndpointIntent(
  caseText: string,
  persona: string,
  requestedMethod: string
): WorkSetupEndpointIntent | undefined {
  const text = caseText.toLowerCase();
  const method = requestedMethod.toUpperCase();

  if (
    text.includes("/talents/{talentid}/work-setups/{worksetupid}/submit") ||
    text.includes("submit or re-submit") ||
    text.includes("re-submit") ||
    (persona === "talent" && method === "POST" && text.includes("submit"))
  ) {
    return "talent-submit";
  }

  if (
  method === "GET" &&
  (text.includes("/talents/{talentid}/work-setups") ||
    text.includes("list work setups for a talent") ||
    text.includes("talent's own work setups") ||
    (persona === "unauthenticated" &&
      text.includes("list talent work setups")) ||
    (persona === "talent" && text.includes("work setup")))
) {
  return "talent-list";
}

      if (
    method === "GET" &&
    (text.includes("/companies/{companyid}/talent-job-work-setups") ||
      text.includes("list talent work setup") ||
      text.includes("company review") ||
      text.includes("talent work setup progress") ||
      text.includes("progress for company review"))
  ) {
    return "company-review-list";
  }

  if (
    method === "POST" &&
    (text.includes(
      "/companies/{companyid}/talent-job-work-setups/{talentjobworksetupid}/approve"
    ) ||
      text.includes("/approve") ||
      text.includes("approve a submitted") ||
      text.includes("approve submitted"))
  ) {
    return "company-review-approve";
  }

  if (
    method === "POST" &&
    (text.includes(
      "/companies/{companyid}/talent-job-work-setups/{talentjobworksetupid}/reject"
    ) ||
      text.includes("/reject") ||
      text.includes("reject a submitted") ||
      text.includes("reject submitted"))
  ) {
    return "company-review-reject";
  }

  if (
    text.includes("/companies/{companyid}/talent-job-work-setups/{talentjobworksetupid}/reject") ||
    text.includes("/reject") ||
    text.includes("reject a submitted")
  ) {
    return "company-review-reject";
  }

  if (
    text.includes("/companies/{companyid}/talent-job-work-setups") ||
    text.includes("company review") ||
    text.includes("talent work setup progress") ||
    text.includes("progress for company review")
  ) {
    return "company-review-list";
  }

  if (
    text.includes("/companies/{companyid}/work-setups/by-id") ||
    text.includes("by-id") ||
    text.includes("by id") ||
    text.includes("single work setup")
  ) {
    return "company-by-id";
  }

    if (
    text.includes("/companies/{companyid}/work-setups/by-family") ||
    text.includes("by-family") ||
    text.includes("get all versions") ||
    text.includes("version history retrieval") ||
    (text.includes("all versions") && text.includes("work setup"))
  ) {
    return "company-by-family";
  }

  if (
    text.includes("/companies/{companyid}/work-setups/{familyid}/versions") ||
    text.includes("/versions") ||
    text.includes("new version")
  ) {
    return "company-version-create";
  }

  if (
    text.includes("delete /companies/{companyid}/work-setups/{familyid}") ||
    (method === "DELETE" && text.includes("soft delete"))
  ) {
    return "company-family-delete";
  }

  if (
    text.includes("/companies/{companyid}/work-setups/{id}/jobs/{jobid}") ||
    text.includes("attach a work setup") ||
    text.includes("remove a work setup from a job") ||
    text.includes("job-work-setup association")
  ) {
    return "company-job-link";
  }

  if (
    method === "POST" &&
    text.includes("create") &&
    text.includes("work setup")
  ) {
    return "company-create";
  }

  if (
  method === "GET" &&
  (text.includes("/companies/{companyid}/work-setups") ||
    text.includes("list all work setups") ||
    text.includes("list company work setup") ||
    text.includes("company work setups") ||
    (persona === "company_admin" && text.includes("work setup")))
) {
  return "company-list";
}

  return undefined;
}

function pathMatchesWorkSetupIntent(
  intent: WorkSetupEndpointIntent,
  path: string
): boolean {
  const normalizedPath = path.toLowerCase().replace(/\/$/, "");

  if (intent === "company-list" || intent === "company-create") {
    return normalizedPath === "/companies/{companyid}/work-setups";
  }

  if (intent === "company-by-id") {
    return normalizedPath.includes("/work-setups/by-id/");
  }

  if (intent === "company-by-family") {
    return normalizedPath.includes("/work-setups/by-family/");
  }

  if (intent === "company-version-create") {
    return (
      normalizedPath.includes("/work-setups/") &&
      normalizedPath.includes("/versions")
    );
  }

  if (intent === "company-family-delete") {
    return (
      normalizedPath === "/companies/{companyid}/work-setups/{familyid}" ||
      (normalizedPath.includes("/work-setups/{familyid}") &&
        !normalizedPath.includes("/jobs/"))
    );
  }

  if (intent === "company-job-link") {
    return (
      normalizedPath.includes("/work-setups/") &&
      normalizedPath.includes("/jobs/")
    );
  }

  if (intent === "company-review-list") {
    return normalizedPath === "/companies/{companyid}/talent-job-work-setups";
  }

  if (intent === "company-review-approve") {
    return (
      normalizedPath.includes("/talent-job-work-setups/") &&
      normalizedPath.includes("/approve")
    );
  }

  if (intent === "company-review-reject") {
    return (
      normalizedPath.includes("/talent-job-work-setups/") &&
      normalizedPath.includes("/reject")
    );
  }

  if (intent === "talent-list") {
    return normalizedPath === "/talents/{talentid}/work-setups";
  }

  if (intent === "talent-submit") {
    return (
      normalizedPath.includes("/talents/{talentid}/work-setups/") &&
      normalizedPath.includes("/submit")
    );
  }

  return false;
}

function pathMatchesPersona(path: string, persona: string, wantedArea?: string): boolean {
  /**
   * For unauthenticated API checks, we intentionally allow protected endpoints too,
   * because the expected behavior is often 401 from that protected route.
   */
  if (persona === "unauthenticated") return true;

  /**
   * Shared metadata endpoints such as skills/languages may be used by multiple
   * authenticated personas even when the path is company-scoped in the generated client.
   * Do not hard-block those by persona.
   */
  if (wantedArea === "skills" || wantedArea === "languages") return true;

  if (persona === "company_admin") {
    return path.startsWith("/companies") || path.startsWith("/public");
  }

  if (persona === "talent") {
    return (
      path.startsWith("/talents") ||
      path.startsWith("/talent") ||
      path.startsWith("/public")
    );
  }

  return true;
}

function methodScore(endpointMethod: string, requestedMethod: string): number {
  if (!requestedMethod) return 0;

  if (endpointMethod.toUpperCase() === requestedMethod.toUpperCase()) {
    return 35;
  }

  /**
   * The manifest builder currently infers methods from source proximity.
   * That inference is useful but not perfect, so mismatch is only a soft penalty.
   */
  return -5;
}

function isCompanyAssessmentDetailCase(text: string): boolean {
  return (
    text.includes("assessment detail") ||
    text.includes("/companies/{companyid}/assessments/{assessmentid}") ||
    text.includes("/companies/{companyid}/assessments/{id}") ||
    text.includes("requires companyid and assessmentid")
  );
}

function isCompanyAssessmentCreateCase(
  text: string,
  requestedMethod: string
): boolean {
  return (
    requestedMethod === "POST" &&
    (
      text.includes("create assessment") ||
      text.includes("/companies/{companyid}/assessments") ||
      text.includes("requires companyid")
    )
  );
}

function isDangerousActionPath(path: string): boolean {
  const lowerPath = path.toLowerCase();

  return (
    lowerPath.includes("/finalize") ||
    lowerPath.includes("/reevaluate") ||
    lowerPath.includes("/allow-retake") ||
    lowerPath.includes("/reject") ||
    lowerPath.includes("/approve") ||
    lowerPath.includes("/delete") ||
    lowerPath.includes("/close") ||
    lowerPath.includes("/terminate") ||
    lowerPath.includes("/extend") ||
    lowerPath.includes("/submit") ||
    lowerPath.includes("/start")
  );
}

function scoreEndpoint(endpoint: ApiEndpointEntry, plan: any, apiCase: any): number {
  const text = collectApiCaseText(plan, apiCase);
  const caseText = collectApiCaseSpecificText(apiCase);

  const wantedArea =
    inferWantedArea(caseText) ??
    inferWantedArea(text);
  const requestedMethod = String(apiCase?.method || "").trim().toUpperCase();
  const persona = String(apiCase?.persona || "").trim();
  const workSetupIntent =
    wantedArea === "work-setups"
      ? inferWorkSetupEndpointIntent(caseText, persona, requestedMethod)
      : undefined;
  const endpointPath = String(endpoint.path || "");const lowerPath = endpointPath.toLowerCase();
  const endpointArea = String(endpoint.area || "").toLowerCase();
  const params = endpoint.params || [];
  const jobsListCase = wantedArea === "jobs" && isJobsListCase(text);
  const jobsSortOrQueryCase = wantedArea === "jobs" && isJobsSortOrQueryCase(text);
  const explicitPublicJobsCase = isExplicitPublicJobsCase(text);
  const jobsDetailPath = isJobsDetailPath(endpointPath, params);
  const jobsListPath = isJobsListPath(endpointPath, params);

  const invoiceDetailIntent =
    wantedArea === "payments" &&
    isInvoicePaymentCase(caseText) &&
    wantsDetailEndpoint(caseText);

  if (!endpointPath.startsWith("/")) return -999;

  let score = 0;

  /**
   * Strong area guard:
   * If a case clearly asks for skills, do not let jobs/public jobs win just
   * because they are executable.
   */
  if (wantedArea && endpointArea && endpointArea !== wantedArea) {
    score -= 160;
  }

  if (!pathMatchesPersona(endpointPath, persona, wantedArea)) {
    score -= 80;
  }

  score += methodScore(String(endpoint.method || ""), requestedMethod);

  if (wantedArea && endpointArea === wantedArea) score += 80;
  if (wantedArea && lowerPath.includes(wantedArea)) score += 40;

  /**
   * Invoice detail cases require the canonical item endpoint.
   * Give that exact shape enough confidence to beat the list route.
   */
  if (
    invoiceDetailIntent &&
    isCanonicalInvoiceDetailPath(endpoint)
  ) {
    score += 100;
  }

  /**
   * SkillSelector contract:
   * Prefer general skills metadata/list/filter endpoints.
   * Avoid deep job-specific skill routes because they require jobId and are
   * usually not the endpoint for skillIds/category/mainDiscipline filtering.
   */
  if (isSkillFilterCase(text)) {
    if (endpointArea === "skills") score += 100;

    if (lowerPath.includes("/jobs/")) {
      score -= 260;
    }

    if (params.includes("jobId")) {
      score -= 220;
    }

    if (params.includes("projectId")) {
      score -= 60;
    }

    if (
      lowerPath === "/skills" ||
      lowerPath === "/companies/{companyid}/skills" ||
      lowerPath.endsWith("/skills")
    ) {
      score += 220;
    }

    if (params.length <= 1) {
      score += 80;
    }
  }

  if (text.includes("skillids") && lowerPath.includes("skills")) score += 80;
  if (text.includes("category") && lowerPath.includes("skills")) score += 35;
  if (text.includes("maindiscipline") && lowerPath.includes("skills")) score += 35;
  if (text.includes("main discipline") && lowerPath.includes("skills")) score += 35;

    if (text.includes("work setup") && lowerPath.includes("work-setups")) {
    score += 100;
  }

  if (wantedArea === "work-setups" && workSetupIntent) {
    if (pathMatchesWorkSetupIntent(workSetupIntent, endpointPath)) {
      score += 700;
    } else if (
      lowerPath.includes("work-setups") ||
      lowerPath.includes("talent-job-work-setups")
    ) {
      score -= 320;
    }
  }

  if (
    caseText.includes("talent job work setup") &&
    lowerPath.includes("talent-job-work-setups")
  ) {
    score += 100;
  }

  if (text.includes("assessment") && lowerPath.includes("assessments")) {
    score += 80;
  }

  if (text.includes("language") && lowerPath.includes("assessments")) {
    score += 25;
  }

  if (text.includes("job") && lowerPath.includes("jobs")) {
    score += 60;
  }

  if (text.includes("sort") && lowerPath.includes("jobs")) {
    score += 60;
  }

  /**
   * Jobs list vs job detail:
   * Sort/filter/pagination cases should not resolve to /public/jobs/{id}
   * or other id-based detail endpoints. This was causing list/sort checks to
   * call a random detail route and receive 404.
   */
  if (wantedArea === "jobs") {
    if (jobsListCase || jobsSortOrQueryCase) {
      if (jobsListPath) {
        score += 240;
      }

      if (jobsDetailPath) {
        score -= 380;
      }

      if (lowerPath.startsWith("/public/jobs") && jobsDetailPath) {
        score -= 260;
      }

      if (persona === "company_admin" && lowerPath.startsWith("/companies") && jobsListPath) {
        score += 120;
      }

      if (persona === "company_admin" && lowerPath.startsWith("/public") && !explicitPublicJobsCase) {
        score -= 100;
      }

      if (params.length === 0 && lowerPath.includes("jobs")) {
        score += 50;
      }
    } else if (
      lowerPath.startsWith("/public/jobs") &&
      jobsDetailPath &&
      !explicitPublicJobsCase
    ) {
      /**
       * Public job detail is usually a poor generic fallback for company/talent
       * issue tests unless the issue explicitly says public jobs.
       */
      score -= 160;
    }
  }

  const wantsList = wantsListEndpoint(text);
  const wantsDetail = wantsDetailEndpoint(text);

  /**
   * Broad list/filter/search cases should prefer shallow endpoints.
   */
  if (wantsList && params.length <= 1) score += 35;
  if (wantsList && wantedArea === "jobs" && jobsListPath) score += 80;

  if (!wantsDetail && params.length >= 3) score -= 140;
  if (!wantsDetail && params.includes("jobId")) score -= 140;
  if (!wantsDetail && params.includes("id") && wantedArea === "jobs") score -= 120;
  if (!wantsDetail && params.includes("assessmentSubmissionId")) score -= 120;
  if (!wantsDetail && params.includes("assessmentId")) score -= 80;

  /**
   * Avoid selecting action endpoints for read-only/list cases.
   */
  if (isDangerousActionPath(lowerPath)) {
    score -= 80;
  }

    if (
    requestedMethod === "GET" &&
    (lowerPath.includes("/approve") ||
      lowerPath.includes("/reject") ||
      lowerPath.includes("/submit"))
  ) {
    score -= 900;
  }

  /**
   * Avoid public job detail unless the case is clearly about public jobs.
   * This prevents skill cases from falling into /public/jobs/{id}.
   */
  if (lowerPath.startsWith("/public/jobs") && wantedArea !== "jobs") {
    score -= 220;
  }

  if (
    lowerPath.startsWith("/public/jobs") &&
    wantedArea === "jobs" &&
    jobsDetailPath &&
    !explicitPublicJobsCase
  ) {
    score -= 120;
  }

  return score;
}

function confidenceFromScore(score: number): ApiEndpointCandidate["confidence"] {
  if (score >= 150) return "high";
  if (score >= 90) return "medium";
  return "low";
}

export function findApiEndpointCandidateFromCatalog(
  plan: any,
  apiCase: any
): ApiEndpointCandidate | undefined {
  const endpoints = readApiCatalog();

  if (endpoints.length === 0) return undefined;

  const caseText = collectApiCaseSpecificText(apiCase);
const fullText = collectApiCaseText(plan, apiCase);

const wantedArea =
  inferWantedArea(caseText) ??
  inferWantedArea(fullText);

const requestedMethod = String(
  apiCase?.method || ""
).trim().toUpperCase();

const persona = String(apiCase?.persona || "").trim();

  const scored = endpoints
  .map((endpoint) => {
    const score = scoreEndpoint(endpoint, plan, apiCase);

    return {
      endpoint,
      score,
    };
  })
  .filter((item) => item.score >= 90)
  .filter((item) =>
    endpointPassesRelevanceGate(
      item.endpoint,
      wantedArea,
      caseText,
      requestedMethod,
      persona
    )
  )
  .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      /**
       * Tie-breaker: prefer shallower paths.
       */
      const aParamCount = a.endpoint.params?.length || 0;
      const bParamCount = b.endpoint.params?.length || 0;

      if (aParamCount !== bParamCount) {
        return aParamCount - bParamCount;
      }

      return a.endpoint.path.length - b.endpoint.path.length;
    });

  const best = scored[0];
  
  if (!best) {
  console.warn(
    ` API relevance gate found no compatible endpoint for ` +
      `${apiCase.id || "case"} (area=${wantedArea || "unknown"})`
  );

  return undefined;
}

return {
  method: best.endpoint.method,
    path: best.endpoint.path,
    confidence: confidenceFromScore(best.score),
    reason: `Selected from API endpoint manifest. area=${
      best.endpoint.area || "unknown"
    }, file=${best.endpoint.file || "unknown"}, score=${best.score}`,
  };
}
