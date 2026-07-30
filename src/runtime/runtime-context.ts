export type RuntimePersona =
  | "company_admin"
  | "talent";

export type RuntimeResourceContext = {
  companyId?: string | undefined;
  projectId?: string | undefined;
  jobId?: string | undefined;
  workSetupId?: string | undefined;
  familyId?: string | undefined;
  talentId?: string | undefined;
  talentJobWorkSetupId?: string | undefined;
  assessmentId?: string | undefined;
  invoiceId?: string | undefined;
  invoiceNumber?: string | undefined;
  invoiceStatus?: string | undefined;
  skillIds?: string[] | undefined;
  skillCategory?: string | undefined;
  mainDiscipline?: string | undefined;
  jobs?: any[] | undefined;
};

export type RuntimeContextsByPersona =
  Partial<
    Record<
      RuntimePersona,
      RuntimeResourceContext
    >
  >;
