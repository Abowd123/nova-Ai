import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("loads the Arabic RTL shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeVisible();
  });

  test("navigates between all screens", async ({ page }) => {
    await page.goto("/chat");
    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    for (const [label, path] of [
      ["المساعدون", "/assistants"],
      ["الذاكرة", "/memory"],
      ["الإعدادات", "/settings"],
      ["المحادثات", "/chat"],
    ] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("skip link moves focus to main content", async ({ page }) => {
    await page.goto("/settings");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "تخطَّ إلى المحتوى" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("without a provider, chat asks to add one", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByRole("link", { name: "إضافة مزود" }).first()).toBeVisible();
    await page.getByTestId("home-new-conversation").click();
    await expect(page).toHaveURL(/\/chat\/.+/);
    await expect(page.getByTestId("send-button")).toBeDisabled();
  });

  test("switches language to English (LTR) and theme to dark", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("assistant CRUD", async ({ page }) => {
    await page.goto("/assistants");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.getByRole("button", { name: "مساعد جديد" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("الاسم").fill("مساعد الاختبار");
    await dialog.getByRole("button", { name: "حفظ" }).click();
    const list = page.getByRole("list", { name: "قائمة المساعدين" });
    await expect(list.getByText("مساعد الاختبار")).toBeVisible();
    await list.getByRole("button", { name: "حذف" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
    await expect(page.getByTestId("empty-state")).toBeVisible();
  });

  test("mobile: conversations open in a sheet", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile-only layout");
    await page.goto("/chat");
    await page.getByRole("button", { name: "فتح قائمة المحادثات" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
