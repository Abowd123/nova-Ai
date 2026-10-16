import { expect, test } from "@playwright/test";
import { MOCK_KEY, addMockProvider, mockProvider } from "./helpers";

test.describe("providers", () => {
  test("add, test, fetch models, toggle and delete a provider", async ({ page }) => {
    const seen = await mockProvider(page, () => ({ kind: "sse", chunks: ["hi"] }));
    const card = await addMockProvider(page);

    await expect(card.getByText("مفتاح مشفّر")).toBeVisible();
    await card.getByRole("button", { name: "اختبار الاتصال" }).click();
    await expect(card.getByRole("status")).toContainText("الاتصال ناجح");
    expect(seen.every((r) => r.authorization === `Bearer ${MOCK_KEY}`)).toBe(true);

    await card.getByText(/النماذج \(/).click();
    await expect(card.getByText("mock-vision-4o")).toBeVisible();
    await card.getByRole("checkbox", { name: /mock-vision-4o/ }).uncheck();
    await expect(card.getByText(/1 مفعّل من 2/)).toBeVisible();

    await card.getByRole("switch").click();
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    await card.getByRole("button", { name: "حذف" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
    await expect(page.getByTestId("empty-state")).toBeVisible();
  });

  test("API keys are never stored in plaintext", async ({ page }) => {
    await mockProvider(page, () => ({ kind: "sse", chunks: ["hi"] }));
    await addMockProvider(page);

    const dump = await page.evaluate(async () => {
      const local = JSON.stringify({ ...localStorage });
      const session = JSON.stringify({ ...sessionStorage });
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open("nova");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows: unknown[] = await new Promise((resolve) => {
        const request = db.transaction("providers").objectStore("providers").getAll();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      const caches_ = await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)));
      return { local, session, rows: JSON.stringify(rows), caches: JSON.stringify(caches_) };
    });

    for (const value of Object.values(dump)) expect(value).not.toContain(MOCK_KEY);
    expect(dump.rows).toContain("AES-GCM");
  });

  test("shows a validation error for an invalid URL", async ({ page }) => {
    await page.goto("/settings/providers");
    await page.getByRole("button", { name: "إضافة مزود" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Base URL").fill("not a url");
    await dialog.getByRole("button", { name: "حفظ" }).click();
    await expect(dialog.getByText("رابط غير صالح")).toBeVisible();
  });
});
