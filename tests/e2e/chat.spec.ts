import { expect, test } from "@playwright/test";
import { addMockProvider, mockProvider, newConversation, send } from "./helpers";

const RICH = ["مرحباً! هذا **رد** تجريبي.\n\n", "```ts\nconst a = 1;\n```\n\n", "المعادلة $E=mc^2$ ", "و[رابط](https://example.com)."];

test.describe("chat", () => {
  test("streams a rich reply, persists it and auto-titles the conversation", async ({ page }) => {
    await mockProvider(page, () => ({ kind: "sse", chunks: RICH }), "خطة التجربة");
    await addMockProvider(page);
    await newConversation(page);

    await send(page, "اكتب مثالاً");
    const reply = page.getByTestId("message-assistant").last();
    await expect(reply).toHaveAttribute("data-status", "complete");
    await expect(reply.locator("strong")).toHaveText("رد");
    await expect(reply.getByTestId("code-language")).toHaveText("ts");
    await expect(reply.locator(".katex")).toBeVisible();
    await expect(reply.getByRole("link", { name: "رابط" })).toHaveAttribute("rel", /noopener/);
    await expect(reply.getByText(/(7|٧) ↑ · (5|٥) ↓/)).toBeVisible();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("خطة التجربة");

    await page.reload();
    await expect(page.getByTestId("message-assistant").last().locator("strong")).toHaveText("رد");
  });

  test("regenerate, edit and delete", async ({ page }) => {
    let n = 0;
    await mockProvider(page, () => ({ kind: "sse", chunks: [`reply ${++n}`] }));
    await addMockProvider(page);
    await newConversation(page);

    await send(page, "question one");
    await expect(page.getByTestId("message-assistant").last()).toContainText("reply 1");

    await page.getByRole("button", { name: "إعادة التوليد" }).click();
    await expect(page.getByTestId("message-assistant").last()).toContainText("reply 2");
    await expect(page.getByTestId("message-assistant")).toHaveCount(1);

    const user = page.getByTestId("message-user").first();
    await user.hover();
    await user.getByRole("button", { name: "تعديل" }).click();
    await user.getByLabel("تعديل الرسالة").fill("question edited");
    await user.getByRole("button", { name: "حفظ وإعادة الإرسال" }).click();
    await expect(page.getByTestId("message-user").first()).toContainText("question edited");
    await expect(page.getByTestId("message-assistant").last()).toContainText("reply 3");

    const assistant = page.getByTestId("message-assistant").last();
    await assistant.getByRole("button", { name: "حذف الرسالة" }).click();
    await expect(page.getByTestId("message-assistant")).toHaveCount(0);
  });

  test("stop button cancels a pending reply", async ({ page }) => {
    await mockProvider(page, () => ({ kind: "hang" }));
    await addMockProvider(page);
    await newConversation(page);

    await send(page, "this will hang");
    const stop = page.getByTestId("stop-button");
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(page.getByTestId("message-assistant").last()).toHaveAttribute("data-status", "aborted");
    await expect(page.getByTestId("send-button")).toBeVisible();
  });

  test("shows provider errors (401) without leaking the key", async ({ page }) => {
    await mockProvider(page, () => ({ kind: "error", status: 401, message: "Incorrect API key provided: sk-e2e-secret-key-0123456789" }));
    await addMockProvider(page);
    await newConversation(page);

    await send(page, "hello");
    const failed = page.getByTestId("message-assistant").last();
    await expect(failed).toHaveAttribute("data-status", "error");
    await expect(failed.getByRole("alert")).toContainText("تعذّر إكمال الرد");
    await expect(page.locator("body")).not.toContainText("0123456789");
  });

  test("composer: multiline, fullscreen and copy", async ({ page, context, browserName }) => {
    await mockProvider(page, () => ({ kind: "sse", chunks: ["copied text"] }));
    await addMockProvider(page);
    await newConversation(page);

    const composer = page.getByLabel("اكتب رسالتك", { exact: true });
    await composer.fill("line 1");
    await composer.press("Enter");
    await composer.pressSequentially("line 2");
    await expect(composer).toHaveValue("line 1\nline 2");

    await page.getByRole("button", { name: "ملء الشاشة" }).click();
    await expect(page.getByRole("button", { name: "تصغير" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "ملء الشاشة" })).toBeVisible();

    await composer.press("Control+Enter");
    await expect(page.getByTestId("message-assistant").last()).toContainText("copied text");
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByTestId("message-assistant").last().getByRole("button", { name: "نسخ" }).first().click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("copied text");
    }
  });

  test("conversation search, pin and rename", async ({ page, isMobile }) => {
    test.skip(isMobile, "sidebar is persistent on desktop only");
    await mockProvider(page, () => ({ kind: "sse", chunks: ["the answer mentions zebra"] }), "Zoo chat");
    await addMockProvider(page);
    await newConversation(page);
    await send(page, "tell me about animals");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Zoo chat");

    const sidebar = page.getByRole("complementary");
    await sidebar.getByLabel("البحث في المحادثات").fill("zebra");
    await expect(sidebar.getByRole("link", { name: /Zoo chat/ })).toBeVisible();
    await sidebar.getByLabel("البحث في المحادثات").fill("nothing-matches-this");
    await expect(sidebar.getByText("لا توجد نتائج")).toBeVisible();
    await sidebar.getByLabel("البحث في المحادثات").fill("");

    await page.getByRole("button", { name: "إعادة تسمية" }).first().click();
    await page.getByRole("dialog").getByLabel("العنوان").fill("Renamed chat");
    await page.getByRole("dialog").getByRole("button", { name: "حفظ" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renamed chat");

    await sidebar.getByRole("button", { name: "تثبيت" }).first().click();
    await expect(sidebar.getByRole("region", { name: "المثبّتة" })).toContainText("Renamed chat");
  });
});
