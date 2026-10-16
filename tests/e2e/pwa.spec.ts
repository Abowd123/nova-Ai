import { expect, test, type Page } from "@playwright/test";

async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }),
      );
    }
  });
}

test.describe("PWA", () => {
  test.skip(({ isMobile }) => isMobile, "PWA checks run on desktop Chromium");

  test("serves a valid web app manifest with icons", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest).toMatchObject({ display: "standalone", scope: "/", short_name: "Nova" });
    expect(manifest.start_url).toContain("/chat");
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) {
      expect((await request.get(icon.src)).ok()).toBeTruthy();
    }
  });

  test("registers the service worker and is installable", async ({ page }) => {
    await page.goto("/chat");
    await waitForServiceWorker(page);
    const scriptUrl = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "",
    );
    expect(scriptUrl).toMatch(/\/sw\.js\?v=/);

    const client = await page.context().newCDPSession(page);
    const { installabilityErrors } = await client.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);
  });

  test("never caches API routes or secret-bearing requests", async ({ page }) => {
    await page.goto("/chat");
    await waitForServiceWorker(page);
    const cachedUrls = await page.evaluate(async () => {
      await fetch("/api/health");
      await fetch("/chat?token=abc");
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
    expect(cachedUrls.length).toBeGreaterThan(0);
    expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
    expect(cachedUrls.some((url) => url.includes("token="))).toBe(false);
  });

  test("sw.js is served uncached", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
