type SkillsRuntimeFixture = {
  skillIds: string[];
  category?: string;
  mainDiscipline?: string;
};

function normalizeBaseUrl(
  url: string
): string {
  return String(url || "").replace(
    /\/$/,
    ""
  );
}

function extractSkillItems(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  const candidates = [
    data.items,
    data.results,
    data.rows,
    data.skills,
    data.data,
    data.data?.items,
    data.data?.results,
    data.data?.rows,
    data.data?.skills,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function firstScalarString(
  ...values: any[]
): string | undefined {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return String(value);
    }
  }

  return undefined;
}

function firstNamedValue(
  ...values: any[]
): string | undefined {
  for (const value of values) {
    const direct =
      firstScalarString(value);

    if (direct) {
      return direct;
    }

    if (
      value &&
      typeof value === "object"
    ) {
      const nested =
        firstScalarString(
          value.name,
          value.label,
          value.title,
          value.value
        );

      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function getSkillId(
  item: any
): string | undefined {
  const id =
    firstScalarString(
      item?.id,
      item?.skillId,
      item?.skill_id,
      item?._id,
      item?.skill?.id,
      item?.skill?.skillId
    );

  if (!id) {
    return undefined;
  }

  /*
   * Some skill-selection flows provide skillIds:number[].
   * Do not supply UUIDs or arbitrary text IDs.
   */
  if (!/^\d+$/.test(id)) {
    return undefined;
  }

  return id;
}

function getSkillCategory(
  item: any
): string | undefined {
  return firstNamedValue(
    item?.category,
    item?.categoryName,
    item?.category_name,
    item?.skillCategory,
    item?.skill_category,
    item?.skill?.category
  );
}

function getMainDiscipline(
  item: any
): string | undefined {
  return firstNamedValue(
    item?.mainDiscipline,
    item?.main_discipline,
    item?.mainDisciplineName,
    item?.main_discipline_name,
    item?.discipline,
    item?.disciplineName,
    item?.skill?.mainDiscipline
  );
}

export async function resolveSkillsRuntimeFixture(
  apiUrl: string,
  token: string
): Promise<SkillsRuntimeFixture | undefined> {
  const path =
    "/skills?limit=100&offset=0";

  try {
    const response = await fetch(
      `${normalizeBaseUrl(apiUrl)}${path}`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.log(
        ` Skills runtime resolver GET failed ` +
          `${response.status}: ${path}`
      );

      return undefined;
    }

    const text =
      await response.text();

    const data = text
      ? JSON.parse(text)
      : undefined;

    const items =
      extractSkillItems(data);

    const skillIds = Array.from(
      new Set(
        items
          .map(getSkillId)
          .filter(
            (
              value
            ): value is string =>
              Boolean(value)
          )
      )
    ).slice(0, 2);

    const category =
      items
        .map(getSkillCategory)
        .find(Boolean);

    const mainDiscipline =
      items
        .map(getMainDiscipline)
        .find(Boolean);

    if (
      skillIds.length === 0 &&
      !category &&
      !mainDiscipline
    ) {
      console.log(
        " Skills runtime resolver found " +
          "no usable fixture values."
      );

      return undefined;
    }

    const fixture:
      SkillsRuntimeFixture = {
        skillIds,
      };

    if (category) {
      fixture.category = category;
    }

    if (mainDiscipline) {
      fixture.mainDiscipline =
        mainDiscipline;
    }

    console.log(
      " Skills runtime resolver selected:",
      fixture
    );

    return fixture;
  } catch (error: any) {
    console.log(
      " Skills runtime resolver failed:",
      String(
        error?.message || error
      )
    );

    return undefined;
  }
}
