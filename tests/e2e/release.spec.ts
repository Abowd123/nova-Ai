import { expect, test } from "@playwright/test";

/** Release smoke checks: security headers, static-export routes, new screens. */
test.describe("release checks", () => {
  test("pages send a nonce CSP and the sandbox keeps its own policy", async ({ page, request }) => {
    const response = await page.goto("/settings");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    const sandbox = await request.get("/sandbox/js.js");
    expect(sandbox.headers()["content-type"]).toContain("javascript");
    expect(sandbox.headers()["content-security-policy"]).toContain("connect-src 'none'");
  });

  test("the proxy rejects requests without the CSRF marker", async ({ request }) => {
    const response = await request.post("/api/proxy", { headers: { "x-nova-target": "https://example.com/" } });
    expect(response.status()).toBe(400);
  });

  test("/chat/view works without an id (empty state) and new screens render", async ({ page }) => {
    await page.goto("/chat/view");
    await expect(page.locator("main")).toBeVisible();
    for (const path of ["/settings/backup", "/settings/security", "/privacy"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});
