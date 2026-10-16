import { expect, type Page, type Route } from "@playwright/test";

export const MOCK_BASE = "https://mock.nova.test/v1";
export const MOCK_KEY = "sk-e2e-secret-key-0123456789";

export type ChatHandler = (body: { messages: { role: string; content: unknown }[]; model: string }) =>
  | { kind: "sse"; chunks: string[] }
  | { kind: "error"; status: number; message: string }
  | { kind: "hang" };

export function sseBody(chunks: string[], usage = { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 }): string {
  const events = chunks.map((text) => ({ choices: [{ delta: { content: text } }] }));
  events.push({ choices: [{ delta: {}, finish_reason: "stop" }] } as never);
  return [...events.map((e) => `data: ${JSON.stringify(e)}\n\n`), `data: ${JSON.stringify({ choices: [], usage })}\n\n`, "data: [DONE]\n\n"].join("");
}

const isTitleRequest = (body: { messages: { role: string; content: unknown }[] }) =>
  body.messages.some((m) => m.role === "system" && String(m.content).includes("short title"));

/** Intercepts the mock OpenAI-compatible provider. Returns captured request headers for assertions. */
export async function mockProvider(page: Page, handler: ChatHandler, title = "عنوان تجريبي") {
  const seen: { url: string; authorization?: string }[] = [];
  await page.route(`${MOCK_BASE}/**`, async (route: Route) => {
    const request = route.request();
    seen.push({ url: request.url(), authorization: request.headers().authorization });
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.url().endsWith("/models")) {
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ data: [{ id: "mock-model" }, { id: "mock-vision-4o" }] }) });
    }
    const body = request.postDataJSON() as Parameters<ChatHandler>[0];
    if (isTitleRequest(body)) {
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sseBody([title]) });
    }
    const result = handler(body);
    if (result.kind === "hang") return; // never respond: the app must stop it
    if (result.kind === "error") {
      return route.fulfill({ status: result.status, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { message: result.message } }) });
    }
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sseBody(result.chunks) });
  });
  return seen;
}

/** Adds the mock provider through the real UI and fetches its models. */
export async function addMockProvider(page: Page) {
  await page.goto("/settings/providers");
  await page.getByRole("button", { name: "إضافة مزود" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("النوع").selectOption("custom");
  await dialog.getByLabel("الاسم").fill("Mock AI");
  await dialog.getByLabel("Base URL").fill(MOCK_BASE);
  await dialog.getByLabel(/مفتاح API/).fill(MOCK_KEY);
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByTestId("provider-card").filter({ hasText: "Mock AI" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "جلب النماذج" }).click();
  await expect(card.getByRole("status")).toContainText("2");
  return card;
}

export async function newConversation(page: Page) {
  await page.goto("/chat");
  await page.getByTestId("home-new-conversation").click();
  await expect(page).toHaveURL(/\/chat\/.+/);
}

export async function send(page: Page, text: string) {
  const composer = page.getByLabel("اكتب رسالتك", { exact: true });
  await composer.fill(text);
  await composer.press("Control+Enter");
}
