import type {
  Locator,
  Page,
} from "playwright";

async function findVisibleActionsButton(
  page: Page
): Promise<Locator | null> {
  const candidates =
    page.getByRole("button", {
      name: /actions/i,
    });

  const count = Math.min(
    await candidates
      .count()
      .catch(() => 0),
    5
  );

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const candidate =
      candidates.nth(index);

    const visible = await candidate
      .isVisible()
      .catch(() => false);

    if (visible) {
      return candidate;
    }
  }

  return null;
}

async function captureVisibleActionsSurfaces(
  actionButton: Locator
): Promise<string[]> {
  return actionButton
    .evaluate((buttonElement) => {
      if (
        !(buttonElement instanceof HTMLElement)
      ) {
        return [];
      }

      const anchor =
        buttonElement.getBoundingClientRect();

      const descriptors: string[] = [];

      const elements =
        Array.from(
          document.querySelectorAll<HTMLElement>(
            "body *"
          )
        );

      for (const element of elements) {
        if (
          element === buttonElement ||
          buttonElement.contains(element) ||
          element.contains(buttonElement)
        ) {
          continue;
        }

        const role =
          element.getAttribute("role") ||
          "";

        const dataState =
          element.getAttribute("data-state") ||
          "";

        const className =
          typeof element.className === "string"
            ? element.className
            : "";

        const style =
          window.getComputedStyle(element);

        const knownMenuSignal =
          [
            "menu",
            "menuitem",
            "listbox",
            "option",
          ].includes(role) ||
          dataState === "open" ||
          /menu|popover|dropdown|popup|popper/i
            .test(className);

        const floatingPosition =
          style.position === "absolute" ||
          style.position === "fixed";

        if (
          !knownMenuSignal &&
          !floatingPosition
        ) {
          continue;
        }

        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          continue;
        }

        const rect =
          element.getBoundingClientRect();

        if (
          rect.width < 20 ||
          rect.height < 20 ||
          rect.width > 700 ||
          rect.height > 900
        ) {
          continue;
        }

        const text =
          element.innerText
            .replace(/\s+/g, " ")
            .trim();

        if (!text) {
          continue;
        }

        const interactiveCount =
          element.querySelectorAll(
            [
              "button",
              "a",
              '[role="button"]',
              '[role="menuitem"]',
              '[role="option"]',
            ].join(", ")
          ).length;

        const elementIsInteractive =
          [
            "menuitem",
            "option",
          ].includes(role);

        if (
          interactiveCount === 0 &&
          !elementIsInteractive
        ) {
          continue;
        }

        const horizontalGap =
          Math.max(
            0,
            rect.left - anchor.right,
            anchor.left - rect.right
          );

        const verticalGap =
          Math.max(
            0,
            rect.top - anchor.bottom,
            anchor.top - rect.bottom
          );

        if (
          horizontalGap > 300 ||
          verticalGap > 300
        ) {
          continue;
        }

        descriptors.push(
          [
            role || "no-role",
            dataState || "no-state",
            style.position,
            Math.round(rect.left),
            Math.round(rect.top),
            Math.round(rect.width),
            Math.round(rect.height),
            text.slice(0, 250),
          ].join("|")
        );
      }

      return descriptors;
    })
    .catch(() => []);
}

async function controlledActionsSurfaceIsVisible(
  actionButton: Locator
): Promise<boolean> {
  return actionButton
    .evaluate((buttonElement) => {
      if (
        !(buttonElement instanceof HTMLElement)
      ) {
        return false;
      }

      const controlledId =
        buttonElement.getAttribute(
          "aria-controls"
        ) ||
        buttonElement.getAttribute(
          "aria-owns"
        );

      if (!controlledId) {
        return false;
      }

      const controlled =
        document.getElementById(
          controlledId
        );

      if (
        !(controlled instanceof HTMLElement)
      ) {
        return false;
      }

      const style =
        window.getComputedStyle(
          controlled
        );

      const rect =
        controlled.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width >= 20 &&
        rect.height >= 20
      );
    })
    .catch(() => false);
}

export async function prepareActionsMenuForAssertion(
  page: Page,
  assertedText: string
): Promise<{
  ok: boolean;
  note: string;
} | null> {
  const normalizedText =
    String(assertedText || "")
      .trim()
      .toLowerCase();

  if (
    normalizedText !==
      "request publish"
  ) {
    return null;
  }

  /*
   * Close stale menus first so that the verification
   * always measures the state created by this click.
   */
  await page.keyboard
    .press("Escape")
    .catch(() => undefined);

  await page.waitForTimeout(200);

  const actionButton =
    await findVisibleActionsButton(page);

  if (!actionButton) {
    return {
      ok: false,
      note:
        "visible Actions button could not be found",
    };
  }

  const surfacesBefore =
    await captureVisibleActionsSurfaces(
      actionButton
    );

  try {
    await actionButton
      .scrollIntoViewIfNeeded({
        timeout: 1000,
      });

    await actionButton.click({
      timeout: 1500,
    });
  } catch {
    return {
      ok: false,
      note:
        "Actions button was visible but could not be clicked safely",
    };
  }

  await page.waitForTimeout(600);

  const expanded =
    await actionButton
      .getAttribute("aria-expanded")
      .catch(() => null);

  const controlledSurfaceVisible =
    await controlledActionsSurfaceIsVisible(
      actionButton
    );

  const surfacesAfter =
    await captureVisibleActionsSurfaces(
      actionButton
    );

  const newSurfaces =
    surfacesAfter.filter(
      (surface) =>
        !surfacesBefore.includes(
          surface
        )
    );

  const verified =
    expanded === "true" ||
    controlledSurfaceVisible ||
    newSurfaces.length > 0;

  console.log(
    " Actions menu verification: " +
      `aria-expanded=${expanded || "none"}, ` +
      `controlled-visible=${controlledSurfaceVisible}, ` +
      `surfaces-before=${surfacesBefore.length}, ` +
      `surfaces-after=${surfacesAfter.length}, ` +
      `new-surfaces=${newSurfaces.length}`
  );

  if (!verified) {
    console.log(
      " Actions menu verification surfaces: " +
        JSON.stringify(
          surfacesAfter.slice(0, 5)
        )
    );

    return {
      ok: false,
      note:
        "clicked Actions but no newly opened menu surface was verified",
    };
  }

  return {
    ok: true,
    note:
      "opened and verified Actions menu for Request Publish assertion",
  };
}
