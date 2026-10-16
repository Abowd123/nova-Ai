import { expect, test } from "@playwright/test";

test.describe("offline", () => {
  test.skip(({ isMobile }) => isMobile, "offline checks run on desktop Chromium");

  test("opens the app shell without a network connection", async ({ page, context }) => {
    await page.goto("/chat");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }),
        );
      }
    });

    await context.setOffline(true);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "غير متصل" })).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "الإعدادات" })).toBeVisible();

    // Uncached route -> offline fallback page.
    await page.goto("/chat/never-visited-offline");
    await expect(page.getByRole("heading", { level: 1, name: "أنت غير متصل" })).toBeVisible();

    await context.setOffline(false);
  });

  test("local data stays available offline", async ({ page, context }) => {
    await page.goto("/chat");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole("button", { name: "إنشاء بيانات تجريبية" }).click();
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.getByRole("link", { name: /خطة إطلاق Nova/ })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    // Sidebar (desktop) reads conversations from IndexedDB with no network.
    await expect(page.getByRole("complementary").getByRole("link", { name: /خطة إطلاق Nova/ })).toBeVisible();
    await context.setOffline(false);
  });
});
