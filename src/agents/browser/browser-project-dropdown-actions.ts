import type {
  Locator,
  Page,
} from "playwright";

async function visualAction(page: Page, locator: Locator, action: "click") {
  const isVisible = await locator.first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!isVisible) {
    console.log(" Visual action skipped: target element is not visible.");
    return;
  }
  const box = await locator.first().boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 35 });
    await page.waitForTimeout(250);
  }
  if (action === "click") {
    await locator.click();
  }
}

export async function clickProjectDropdown(page: Page) {
  const directCandidates = [
    page.locator('[role="combobox"]').first(),
    page.locator('[aria-haspopup="listbox"]').first(),
    page.locator('[data-slot="select-trigger"]').first(),
    page.locator(".ant-select-selector").first(),
    page.locator("button").filter({ hasText: /select project/i }).first(),
    page.locator("button").filter({ hasText: /project/i }).first(),
  ];

  for (const candidate of directCandidates) {
    if (await candidate.isVisible({ timeout: 1000 }).catch(() => false)) {
      await visualAction(page, candidate, "click");
      await page.waitForTimeout(1000);
      console.log(" Generic browser step clicked project dropdown.");
      return true;
    }
  }

  const projectLabel = page.getByText(/^Project$/i).first();
  const labelVisible = await projectLabel.isVisible({ timeout: 1000 }).catch(() => false);

  if (labelVisible) {
    const box = await projectLabel.boundingBox();

    if (box) {
      const targetX = box.x + 95;
      const targetY = box.y + 42;

      await page.mouse.move(targetX, targetY, { steps: 25 });
      await page.waitForTimeout(200);
      await page.mouse.click(targetX, targetY);
      await page.waitForTimeout(1000);

      console.log(" Generic browser step clicked project dropdown by sidebar position.");
      return true;
    }
  }

  console.log(" Generic browser step could not find project dropdown.");
  return false;
}

export async function selectLastDropdownOption(page: Page) {
  await page.waitForTimeout(500);

  const panelBox = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("body *")) as HTMLElement[];

    const panels = elements
      .map((el) => {
        const text = (el.innerText || el.textContent || "").trim();
        const rect = el.getBoundingClientRect();

        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth;

        return {
          el,
          text,
          rect,
          area: rect.width * rect.height,
          visible,
        };
      })
      .filter((item) => {
        return (
          item.visible &&
          /showing\s+\d+\s+of\s+\d+\s+projects/i.test(item.text) &&
          /search project/i.test(item.text) &&
          item.rect.width >= 220 &&
          item.rect.width <= 430 &&
          item.rect.height >= 250
        );
      })
      .sort((a, b) => a.area - b.area);

    const panel = panels[0]?.el;

    if (!panel) return null;

    const descendants = [panel, ...Array.from(panel.querySelectorAll("*"))] as HTMLElement[];

    const scrollable = descendants
      .filter((el) => el.scrollHeight > el.clientHeight + 8)
      .sort((a, b) => {
        const aScrollable = a.scrollHeight - a.clientHeight;
        const bScrollable = b.scrollHeight - b.clientHeight;
        return bScrollable - aScrollable;
      })[0];

    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight;
    } else {
      panel.scrollTop = panel.scrollHeight;
    }

    const rect = panel.getBoundingClientRect();

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });

  if (!panelBox) {
    console.log(" Generic browser step could not locate project dropdown panel.");

    await page.screenshot({
      path: "qa-results/evidence/debug-project-dropdown-options.png",
      fullPage: true,
    });

    return false;
  }

  await page.waitForTimeout(800);

  const candidate = await page.evaluate((box) => {
    const blockedTexts = ["create project", "search project", "showing", "project"];

    const elements = Array.from(document.querySelectorAll("body *")) as HTMLElement[];

    const items = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        return {
          text,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((item) => {
        if (!item.text) return false;
        if (item.text.length > 80) return false;
        if (item.width <= 0 || item.height <= 0) return false;

        if (item.x < box.x || item.x > box.x + box.width) return false;
        if (item.y < box.y + 75 || item.y > box.y + box.height - 45) return false;

        const lower = item.text.toLowerCase();

        if (blockedTexts.some((blocked) => lower.includes(blocked))) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.y - a.y);

    return items[0] || null;
  }, panelBox);

  if (!candidate) {
    console.log(" Generic browser step could not find last project item inside dropdown panel.");

    await page.screenshot({
      path: "qa-results/evidence/debug-project-dropdown-options.png",
      fullPage: true,
    });

    return false;
  }

  await page.mouse.move(
    candidate.x + candidate.width / 2,
    candidate.y + candidate.height / 2,
    { steps: 25 }
  );

  await page.waitForTimeout(200);

  await page.mouse.click(
    candidate.x + candidate.width / 2,
    candidate.y + candidate.height / 2
  );

  await page.waitForTimeout(1000);

  const verified = await page.evaluate((selectedText) => {
    const expected = String(selectedText || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    const elements = Array.from(document.querySelectorAll("body *")) as HTMLElement[];

    return elements.some((el) => {
      const text = (el.innerText || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      const rect = el.getBoundingClientRect();

      return (
        text === expected &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x >= 0 &&
        rect.x < 230 &&
        rect.y > 100 &&
        rect.y < 650
      );
    });
  }, candidate.text);

  if (!verified) {
    console.log(
      ` Generic browser step clicked "${candidate.text}" but could not verify it became selected.`
    );

    await page.screenshot({
      path: "qa-results/evidence/debug-project-dropdown-selection.png",
      fullPage: true,
    });

    return false;
  }

  console.log(
    ` Generic browser step selected and verified last dropdown item: ${candidate.text}`
  );

  return true;
}
