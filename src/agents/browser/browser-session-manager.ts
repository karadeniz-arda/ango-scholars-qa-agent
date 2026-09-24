import {
  Stagehand,
} from "@browserbasehq/stagehand";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  createCustomToken,
} from "../../auth/firebase.js";

export type BrowserPersona =
  | "company_admin"
  | "talent";

export type BrowserRuntimeSession = {
  stagehand: Stagehand;
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

export async function createBrowserRuntimeSession(
  baseUrl: string,
  options: { videoDirectory?: string } = {}
): Promise<BrowserRuntimeSession> {
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
      dir: options.videoDirectory ?? "qa-results/videos/",
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

  let page = await context.newPage();

  await page.goto(`${baseUrl}/account/login`, {
    waitUntil: "domcontentloaded",
  });

  /*
   * Stagehand initializes its own default context/page
   * before this runner connects over CDP and creates the
   * dedicated recorded context above. Close only blank
   * pages belonging to other contexts so the browser does
   * not retain an unused about:blank tab.
   */
  let closedBlankPageCount = 0;

  for (
    const existingContext
    of browser.contexts()
  ) {
    if (existingContext === context) {
      continue;
    }

    for (
      const existingPage
      of existingContext.pages()
    ) {
      if (
        existingPage.url() !==
        "about:blank"
      ) {
        continue;
      }

      const closed =
        await existingPage
          .close()
          .then(() => true)
          .catch(() => false);

      if (closed) {
        closedBlankPageCount += 1;
      }
    }
  }

  if (closedBlankPageCount > 0) {
    console.log(
      ` Closed ${closedBlankPageCount} unused ` +
        `Stagehand about:blank page(s).`
    );
  }

  return {
    stagehand,
    browser,
    context,
    page,
  };
}

export async function detectAuthWall(page: Page): Promise<boolean> {
  const authWallTexts = [
    "Continue to Scholars",
    "Continue with Google",
    "Email is required",
    "name@email.com",
    "Sign in",
    "Log in",
  ];

  for (const text of authWallTexts) {
    const visible = await page
      .getByText(text, { exact: false })
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (visible) return true;
  }

  const currentUrl = page.url().toLowerCase();

  return (
    currentUrl.includes("login") ||
    currentUrl.includes("signin") ||
    currentUrl.includes("sign-in") ||
    currentUrl.includes("auth")
  );
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
  await page.goto(loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  /*
   * The login application may keep analytics,
   * Firebase, SSE or other long-lived requests open.
   * Authentication only requires the app origin and
   * DOM to be available; networkidle is best-effort.
   */
  await page.waitForTimeout(500);

  await page
    .waitForLoadState(
      "networkidle",
      {
        timeout: 5000,
      }
    )
    .catch(() => {
      console.log(
        " Auth reset login page remained network-active; " +
          "continuing after DOMContentLoaded."
      );
    });
}

export async function signInAsPersona(
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
