/**
 * ENGINE V4 VX - Optional Browser Renderer (JS-rendered page fallback)
 *
 * Selectively renders a public page when the static HTML exposed no media and
 * the page looks client-rendered. Used ONLY as a fallback.
 *
 * Playwright / puppeteer are OPTIONAL peer capabilities. If neither is
 * installed (the default on Vercel), this module reports unavailable and the
 * pipeline falls through to a truthful error — it never pretends to work.
 *
 * Never used for auth / CAPTCHA / DRM / paywall bypass.
 */

export interface RenderResult {
  available: boolean;
  html?: string;
  finalUrl?: string;
  reason?: string;
}

export class BrowserRenderer {
  private static moduleCache: unknown | undefined;

  /** Attempt to dynamically require playwright or puppeteer-core. */
  private static async loadModule(): Promise<any | null> {
    if (this.moduleCache !== undefined) return this.moduleCache as any;
    // These are OPTIONAL, uninstalled-by-default peer capabilities. We build
    // the specifier at runtime so bundlers do not try to resolve them at build
    // time (they are absent on Vercel). The webpackIgnore comment prevents the
    // "critical dependency: the request of a dependency is an expression" warning.
    const candidates = ["playwright", "playwright-core", "puppeteer", "puppeteer-core"];
    for (const name of candidates) {
      try {
        const dynamicRequire = eval("require") as NodeRequire;
        const mod = dynamicRequire(/* webpackIgnore: true */ name);
        this.moduleCache = mod;
        return mod;
      } catch {
        continue;
      }
    }
    this.moduleCache = null;
    return null;
  }

  public static async isAvailable(): Promise<boolean> {
    const mod = await this.loadModule();
    if (!mod) return false;
    // A browser binary must also be present — probe by launching quickly.
    try {
      const launcher = mod.chromium || mod.default?.chromium;
      if (!launcher) return false;
      const browser = await launcher.launch({ args: ["--no-sandbox"] });
      await browser.close();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Render a public URL and return the post-render HTML.
   * @param executablePath optional explicit browser binary path.
   */
  public static async render(url: string, timeoutMs = 20000, executablePath?: string): Promise<RenderResult> {
    const mod = await this.loadModule();
    if (!mod) {
      return { available: false, reason: "No browser runtime (playwright/puppeteer) installed" };
    }
    const launcher = mod.chromium || mod.default?.chromium;
    if (!launcher) {
      return { available: false, reason: "Chromium launcher not found" };
    }

    let browser;
    try {
      browser = await launcher.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        executablePath,
      });
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
      // Give lazy players a moment to attach sources.
      await page.waitForTimeout(1500).catch(() => {});
      const html: string = await page.content();
      const finalUrl: string = page.url();
      return { available: true, html, finalUrl };
    } catch (err: any) {
      return { available: false, reason: err?.message || "Render failed" };
    } finally {
      try { await browser?.close(); } catch {}
    }
  }
}
