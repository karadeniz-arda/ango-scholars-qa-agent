import fs from "node:fs";
import yaml from "yaml";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright";
import type { TestPlan } from "../../planner/types.js";
import { createCustomToken } from "../../auth/firebase.js";
import type { Page, Locator } from "playwright";
import { resolveBrowserRoute } from "./browser-route-resolver.js";

type BrowserPersona = "company_admin" | "talent";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBrowserBlockReason(testCase: any): string | null {
  const persona = String(testCase.persona || "").trim();
  const startRoute = String(testCase.startRoute || "").trim();
  
  if (!["company_admin", "talent"].includes(persona)) {
    return `Unsupported browser persona "${persona}". Supported browser personas: company_admin, talent.`;
  }
  if (!startRoute || startRoute.toUpperCase() === "UNKNOWN") {
    return "Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed.";
  }
  if (/{[^}]+}/.test(startRoute)) {
    return `Browser startRoute contains unresolved placeholder: ${startRoute}`;
  }
  return null;
}

type BrowserStep =
  | { action: "wait"; ms: number }
  | { action: "clickTopTab"; text: string }
  | { action: "clickButton"; text: string }
  | { action: "clickText"; text: string }
  | { action: "clickProjectDropdown" }
  | { action: "selectLastDropdownOption" }
  | { action: "assertTextVisible"; text: string }
  | { action: "assertTextNotVisible"; text: string }
  | { action: "setViewport"; width: number; height: number };

type BrowserStepResult = {
  status: "PASS" | "FAIL" | "MANUAL_REQUIRED" | "ERROR";
  reasonCategory: string;
  notes: string[];
};

async function clickVisibleTextInMainArea(page: Page, text: string) {
  const locator = page.getByText(new RegExp(`^${escapeRegExp(text)}$`, "i"));
  const count = await locator.count();
  
  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    const visible = await item.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) continue;
    
    const box = await item.boundingBox();
    if (!box) continue;
    
    if (box.x > 220) {
      await visualAction(page, item, "click");
      await page.waitForTimeout(1000);
      console.log(` Generic browser step clicked main-area text: ${text}`);
      return true;
    }
  }
  console.log(` Generic browser step could not find main-area text: ${text}`);
  return false;
}

async function clickProjectDropdown(page: Page) {
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

async function selectLastDropdownOption(page: Page) {
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

function getBrowserCaseText(testCase: any): string {
  const stepText = Array.isArray(testCase.steps)
    ? testCase.steps
        .map((step: any) => [step.action, step.text].filter(Boolean).join(" "))
        .join(" ")
    : "";

  return [testCase.goal, testCase.successCriteria, stepText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isComplexDropdownCase(testCase: any): boolean {
  const text = getBrowserCaseText(testCase);

  const mentionsDropdown =
    text.includes("dropdown") ||
    text.includes("selector") ||
    text.includes("select issue") ||
    text.includes("last item") ||
    text.includes("scrollable") ||
    text.includes("scroll inside");

  const mentionsProjectOrSelection =
    text.includes("project") ||
    text.includes("select") ||
    text.includes("selection");

  return mentionsDropdown && mentionsProjectOrSelection;
}

async function runGenericBrowserSteps(
  page: Page,
  testCase: any
): Promise<BrowserStepResult> {
  const steps = testCase.steps as BrowserStep[] | undefined;
  const notes: string[] = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    const note =
      "No structured browser steps provided. Screenshot-only browser cases require manual verification.";
    console.log(` Generic browser steps: ${note}`);

    return {
      status: "MANUAL_REQUIRED",
      reasonCategory: "NO_STRUCTURED_STEPS",
      notes: [note],
    };
  }

  let hasAssertion = false;
  let hasFailedAssertion = false;
  let needsManualVerification = false;
  let hasActionLimitation = false;

  for (const step of steps) {
    if (step.action === "wait") {
      await page.waitForTimeout(step.ms);
      notes.push(`wait ${step.ms}ms`);
      continue;
    }

    if (step.action === "setViewport") {
      await page.setViewportSize({
        width: step.width,
        height: step.height,
      });

      await page.waitForTimeout(1000);

      const note = `setViewport ${step.width}x${step.height}`;
      notes.push(note);
      console.log(` Generic browser step ${note}`);

      continue;
    }

    if (step.action === "clickTopTab") {
      const clicked = await clickVisibleTextInMainArea(page, step.text);

      if (clicked) {
        notes.push(`clicked top/main tab "${step.text}"`);
      } else {
        notes.push(
          `could not click top/main tab "${step.text}" - continuing with assertions`
        );
        hasActionLimitation = true;
      }

      continue;
    }

    if (step.action === "clickButton") {
      const button = page
        .locator("button")
        .filter({ hasText: new RegExp(`^${escapeRegExp(step.text)}$`, "i") })
        .first();

      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        await visualAction(page, button, "click");
        await page.waitForTimeout(1000);

        const note = `clicked button "${step.text}"`;
        notes.push(note);
        console.log(` Generic browser step ${note}`);
      } else {
        const note = `button "${step.text}" not visible or not safely clickable - continuing with assertions`;
        notes.push(note);
        console.log(` Generic browser step ${note}`);
        hasActionLimitation = true;
      }

      continue;
    }

    if (step.action === "clickProjectDropdown") {
      const clicked = await clickProjectDropdown(page);

      if (clicked) {
        notes.push("clicked project dropdown");
      } else {
        notes.push("manual required: could not open project dropdown reliably");
        hasActionLimitation = true;
        needsManualVerification = true;
      }

      continue;
    }

    if (step.action === "selectLastDropdownOption") {
      const selected = await selectLastDropdownOption(page);

      if (selected) {
        notes.push("selected last dropdown option");
      } else {
        notes.push(
          "manual required: could not reliably scroll/select/verify the last dropdown option"
        );
        hasActionLimitation = true;
        needsManualVerification = true;
      }

      continue;
    }

    if (step.action === "clickText") {
      const clicked = await clickVisibleTextInMainArea(page, step.text);

      if (clicked) {
        notes.push(`clicked text "${step.text}"`);
      } else {
        notes.push(
          `could not click text "${step.text}" - continuing with assertions`
        );
        hasActionLimitation = true;
      }

      continue;
    }

    if (step.action === "assertTextVisible") {
      hasAssertion = true;

      const visible = await page
        .getByText(new RegExp(escapeRegExp(step.text), "i"))
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      const note = `assert visible "${step.text}": ${
        visible ? "PASS" : "FAIL"
      }`;

      notes.push(note);
      console.log(` Generic browser assertion ${note}`);

      if (!visible) {
        hasFailedAssertion = true;
      }

      continue;
    }

    if (step.action === "assertTextNotVisible") {
      hasAssertion = true;

      const visible = await page
        .getByText(new RegExp(escapeRegExp(step.text), "i"))
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      const passed = !visible;
      const note = `assert not visible "${step.text}": ${
        passed ? "PASS" : "FAIL"
      }`;

      notes.push(note);
      console.log(` Generic browser assertion ${note}`);

      if (!passed) {
        hasFailedAssertion = true;
      }

      continue;
    }

    notes.push(`manual required: unsupported browser step "${(step as any).action}"`);
    needsManualVerification = true;
  }

  if (
  needsManualVerification ||
  (isComplexDropdownCase(testCase) && hasActionLimitation)
) {
  return {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
    notes,
  };
}


  if (hasFailedAssertion) {
  return {
    status: "FAIL",
    reasonCategory: "PRODUCT_ASSERTION_FAILED",
    notes,
  };
}

  if (hasAssertion) {
    return {
      status: "PASS",
      reasonCategory: "ASSERTIONS_PASSED",
      notes,
    };
  }

  return {
    status: "MANUAL_REQUIRED",
    reasonCategory: "NO_EXPLICIT_ASSERTIONS",
    notes: [
      ...notes,
      "No explicit assertions were executed. Manual verification is required.",
    ],
  };
}

function cleanJsonFileContent(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
    
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

async function resetBrowserStateOnAppOrigin(page: Page, baseUrl: string) {
  const loginUrl = `${baseUrl}/account/login`;
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page
    .evaluate(async () => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      const dbs = await window.indexedDB.databases();
      dbs.forEach((db) => {
        if (db.name) window.indexedDB.deleteDatabase(db.name);
      });
    })
    .catch(() => {});
  await page.goto(loginUrl, { waitUntil: "networkidle" });
}

async function signInAsPersona(
  page: Page,
  baseUrl: string,
  persona: BrowserPersona
) {
  await resetBrowserStateOnAppOrigin(page, baseUrl);

  const customToken = await createCustomToken(persona);

  await page.evaluate(
    async ({ customToken, apiKey, authDomain, projectId }) => {
      // @ts-ignore
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"!
      );

      // @ts-ignore
      const { getAuth, signInWithCustomToken } = await import(
        "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"!
      );

      const app = initializeApp({
        apiKey,
        authDomain,
        projectId,
      });

      await signInWithCustomToken(getAuth(app), customToken);
    },
    {
      customToken,
      apiKey: process.env.VITE_FIREBASE_API_KEY!,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
    }
  );

  await page.waitForTimeout(500);
}

export async function runBrowserCases() {
  console.log("\nSmoke Chrome Test starting...");
  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const baseUrl = String(
    process.env.QA_BASE_URL ?? config.environments.staging.url
  ).replace(/\/$/, "");
  
  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const plan: TestPlan = JSON.parse(cleanJsonFileContent(planFile));
  const results = [];
  
  for (const testCase of (plan.browserCases as any[]) ?? []) {
  const resolvedRoute = await resolveBrowserRoute(plan, testCase);

  if (resolvedRoute !== testCase.startRoute) {
    console.log(
      ` Resolved browser route for ${testCase.id}: ${testCase.startRoute} -> ${resolvedRoute}`
    );

    testCase.startRoute = resolvedRoute;
  }
}
  
  fs.mkdirSync("qa-results", { recursive: true });
  fs.mkdirSync("qa-results/evidence", { recursive: true });
  fs.mkdirSync("qa-results/videos", { recursive: true });
  
  const executableCases = (plan.browserCases as any[]).filter(
    (testCase) => !getBrowserBlockReason(testCase)
  );
  
  if (executableCases.length === 0) {
    for (const testCase of plan.browserCases as any[]) {
      const blockReason = getBrowserBlockReason(testCase);
      console.log(`\nBrowser case: [${testCase.id}] - ${testCase.goal}`);
      console.log(` Result: BLOCKED (${blockReason})`);
      results.push({
        id: testCase.id,
        status: "BLOCKED",
        startRoute: testCase.startRoute,
        reasonCategory: "MISSING_BROWSER_ROUTE",
        evidence: blockReason,
      });
    }
    console.log("\nNo executable browser cases. GitHub diff/UI route context is needed.");
    return results;
  }
  
  const stagehand = new Stagehand({ env: "LOCAL" });
  await stagehand.init();
  let wsEndpoint = "";
  
  if (typeof (stagehand as any).connectURL === "function") {
    wsEndpoint = await (stagehand as any).connectURL();
  } else {
    wsEndpoint = (stagehand.context as any).browser().wsEndpoint();
  }
  
  const browser = await chromium.connectOverCDP({ wsEndpoint });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: "qa-results/videos/",
      size: { width: 1280, height: 720 },
    },
  });
  
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const cursor = document.createElement("div");
      cursor.style.width = "20px";
      cursor.style.height = "20px";
      cursor.style.borderRadius = "50%";
      cursor.style.backgroundColor = "rgba(255, 0, 0, 0.5)";
      cursor.style.position = "fixed";
      cursor.style.pointerEvents = "none";
      cursor.style.zIndex = "9999999";
      cursor.style.transform = "translate(-50%, -50%)";
      cursor.style.transition = "transform 0.1s ease";
      document.body.appendChild(cursor);
      
      const style = document.createElement("style");
      style.innerHTML = `
        @keyframes ripple-effect {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
        .playwright-ripple {
          position: fixed;
          width: 40px;
          height: 40px;
          border: 2px solid red;
          border-radius: 50%;
          pointer-events: none;
          z-index: 9999998;
          animation: ripple-effect 0.6s linear forwards;
        }
      `;
      document.head.appendChild(style);
      
      window.addEventListener("mousemove", (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });
      window.addEventListener("mousedown", (e) => {
        cursor.style.transform = "translate(-50%, -50%) scale(0.6)";
        const ripple = document.createElement("div");
        ripple.className = "playwright-ripple";
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
      window.addEventListener("mouseup", () => {
        cursor.style.transform = "translate(-50%, -50%) scale(1)";
      });
    });
  });
  
  const page = await context.newPage();

  await page.goto(`${baseUrl}/account/login`, { waitUntil: "domcontentloaded" });

  let signedInPersona: BrowserPersona | null = null;
  
  for (const testCase of plan.browserCases as any[]) {
    console.log(`\nTaking photo: [${testCase.id}] - ${testCase.goal}`);
    const blockReason = getBrowserBlockReason(testCase);
    
    if (blockReason) {
      results.push({
        id: testCase.id,
        status: "BLOCKED",
        reasonCategory: "MISSING_BROWSER_ROUTE",
        startRoute: testCase.startRoute,
        evidence: blockReason,
      });
      console.log(` Result: BLOCKED (${blockReason})`);
      continue;
    }
    
    try {
      await page.setViewportSize({ width: 1280, height: 720 });

const persona = testCase.persona as BrowserPersona;

if (signedInPersona !== persona) {
  console.log(
    ` Switching browser persona: ${signedInPersona ?? "none"} -> ${persona}`
  );

  await context.clearCookies();
  await signInAsPersona(page, baseUrl, persona);

  signedInPersona = persona;
} else {
  console.log(` Reusing browser session for persona: ${persona}`);
}
      
      const targetUrl = `${baseUrl}${testCase.startRoute}`;
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      

      
      const stepResult = await runGenericBrowserSteps(page, testCase);
      const screenshotPath = `qa-results/evidence/${testCase.id}-screenshot.png`;
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(` Screenshot Taken: ${screenshotPath}`);
      console.log(` Result: ${stepResult.status}`);
      
      if (stepResult.notes.length > 0) {
        console.log(` Notes: ${stepResult.notes.join(" | ")}`);
      }
      
      results.push({
        id: testCase.id,
        status: stepResult.status,
        reasonCategory: stepResult.reasonCategory,
        startRoute: testCase.startRoute,
        evidence:
          stepResult.notes.length > 0
            ? `${screenshotPath} | ${stepResult.notes.join(" | ")}`
            : screenshotPath,
      });
    } catch (error: any) {
      console.log(` Error: ${error.message}`);
      results.push({
        id: testCase.id,
        status: "ERROR",
        reasonCategory: "AGENT_RUNTIME_ERROR",
        startRoute: testCase.startRoute,
        evidence: error.message,
      });
    }
  }
  
  await context.close();
  await browser.close();
  await stagehand.close();
  console.log("\nBrowser tests are completed");
  return results;
}