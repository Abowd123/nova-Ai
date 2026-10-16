// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chunked, collect, recordingHttp, sse, streamOf } from "@tests/helpers/streams";
import { createProvider } from "@/lib/ai/factory";
import type { ChatEvent, ChatRequest, ProviderConfig } from "@/lib/ai/types";

const base: Omit<ProviderConfig, "kind" | "baseUrl"> = { id: "p1", name: "Test", apiKey: "sk-test-key-1234567890", transport: "direct" };
const userHi: ChatRequest = { model: "m", messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] };

function textOf(events: ChatEvent[]): string {
  return events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");
}

describe("OpenAI-compatible adapters", () => {
  const body = sse([
    { data: { id: "r1", model: "gpt-4o", choices: [{ delta: { content: "Hel" } }] } },
    { data: { choices: [{ delta: { reasoning_content: "think" } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: '{"q":' } }] } }] } },
    { data: { choices: [{ delta: { content: "lo", tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: "tool_calls" }] } },
    { data: { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, prompt_tokens_details: { cached_tokens: 4 } } } },
    { data: "[DONE]" },
  ]);

  it.each([1, 7, 64])("streams text, reasoning, tool calls and usage (chunk size %i)", async (size) => {
    const { http, requests } = recordingHttp([() => new Response(streamOf(chunked(body, size)))]);
    const provider = createProvider({ ...base, kind: "openai", baseUrl: "https://api.openai.com/v1/" }, http);
    const events = await collect(provider.streamChat({ ...userHi, system: "Be nice", temperature: 0.3, maxTokens: 50 }));

    expect(events[0]).toEqual({ type: "start", model: "gpt-4o", responseId: "r1" });
    expect(textOf(events)).toBe("Hello");
    expect(events).toContainEqual({ type: "reasoning-delta", text: "think" });
    expect(events).toContainEqual({ type: "tool-call", id: "c1", name: "search", arguments: '{"q":"x"}' });
    expect(events.at(-1)).toEqual({
      type: "finish",
      reason: "tool_calls",
      usage: { inputTokens: 12, outputTokens: 5, cachedTokens: 4, totalTokens: 17 },
    });

    const request = requests[0]!;
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer sk-test-key-1234567890");
    expect(request.body).toMatchObject({
      model: "m",
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_completion_tokens: 50,
      messages: [
        { role: "system", content: "Be nice" },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("maps images to image_url parts", async () => {
    const { http, requests } = recordingHttp([() => new Response(streamOf([sse([{ data: "[DONE]" }])]))]);
    const provider = createProvider({ ...base, kind: "custom", baseUrl: "http://localhost:8000/v1" }, http);
    await collect(
      provider.streamChat({
        model: "m",
        messages: [{ role: "user", parts: [{ type: "text", text: "what?" }, { type: "image", mimeType: "image/png", data: "AAAA" }] }],
      }),
    );
    expect(requests[0]!.body?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "what?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    ]);
    expect(requests[0]!.body).not.toHaveProperty("max_tokens");
  });

  it("OpenRouter sends attribution headers and maps model metadata", async () => {
    const { http, requests } = recordingHttp([
      () =>
        Response.json({
          data: [
            {
              id: "deepseek/deepseek-r1",
              name: "DeepSeek R1",
              context_length: 163840,
              pricing: { prompt: "0.00000055", completion: "0.00000219" },
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["tools", "reasoning"],
            },
          ],
        }),
    ]);
    const provider = createProvider({ ...base, kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }, http);
    const [model] = await provider.listModels();
    expect(requests[0]!.headers["x-title"]).toBe("Nova");
    expect(model).toMatchObject({
      id: "deepseek/deepseek-r1",
      contextWindow: 163840,
      inputCost: 0.55,
      outputCost: 2.19,
      capabilities: { vision: false, tools: true, reasoning: true },
    });
  });

  it("OpenAI model listing hides non-chat models", async () => {
    const { http } = recordingHttp([() => Response.json({ data: [{ id: "gpt-4o" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }] })]);
    const models = await createProvider({ ...base, kind: "openai", baseUrl: "https://api.openai.com/v1" }, http).listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-4o"]);
    expect(models[0]?.capabilities.vision).toBe(true);
  });

  it("surfaces in-stream errors", async () => {
    const { http } = recordingHttp([() => new Response(streamOf([sse([{ data: { error: { message: "context too long" } } }])]))]);
    const provider = createProvider({ ...base, kind: "openai", baseUrl: "https://x/v1" }, http);
    await expect(collect(provider.streamChat(userHi))).rejects.toMatchObject({ code: "server", message: "context too long" });
  });

  it("rejects malformed stream data", async () => {
    const { http } = recordingHttp([() => new Response(streamOf(["data: {not json\n\n"]))]);
    const provider = createProvider({ ...base, kind: "openai", baseUrl: "https://x/v1" }, http);
    await expect(collect(provider.streamChat(userHi))).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Anthropic adapter", () => {
  const body = sse(
    [
      { event: "message_start", data: { type: "message_start", message: { id: "msg", model: "claude", usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 1 } } } },
      { event: "ping", data: { type: "ping" } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "مرحبا" } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "search" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":' } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "1}" } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ],
    "\r\n",
  );

  it("streams thinking, text, tool use and usage", async () => {
    const { http, requests } = recordingHttp([() => new Response(streamOf(chunked(body, 11)))]);
    const provider = createProvider({ ...base, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1" }, http);
    const events = await collect(
      provider.streamChat({
        model: "claude",
        system: "S",
        temperature: 1.5,
        messages: [
          { role: "user", parts: [{ type: "text", text: "a" }] },
          { role: "user", parts: [{ type: "text", text: "b" }] },
        ],
      }),
    );
    expect(textOf(events)).toBe("مرحبا");
    expect(events).toContainEqual({ type: "reasoning-delta", text: "hmm" });
    expect(events).toContainEqual({ type: "reasoning-delta", text: "", signature: "sig" });
    expect(events).toContainEqual({ type: "tool-call", id: "t1", name: "search", arguments: '{"q":1}' });
    expect(events.at(-1)).toEqual({
      type: "finish",
      reason: "tool_calls",
      usage: { inputTokens: 14, outputTokens: 7, cachedTokens: 4, totalTokens: 21 },
    });

    const request = requests[0]!;
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("sk-test-key-1234567890");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(request.headers.authorization).toBeUndefined();
    expect(request.body).toMatchObject({ system: "S", max_tokens: 4096, temperature: 1 });
    // Consecutive user turns are merged to satisfy role alternation.
    expect(request.body?.messages).toEqual([{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }]);
  });

  it("enables extended thinking without temperature", () => {
    const provider = createProvider({ ...base, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1" }) as unknown as {
      buildBody: (r: ChatRequest) => Record<string, unknown>;
    };
    const body = provider.buildBody({ ...userHi, temperature: 0.5, reasoning: { enabled: true, budgetTokens: 2048 } });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(body.temperature).toBeUndefined();
  });

  it("omits the browser-access header when proxied", async () => {
    const { http, requests } = recordingHttp([() => new Response(streamOf([""]))]);
    const provider = createProvider({ ...base, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", transport: "proxy" }, http);
    await collect(provider.streamChat(userHi));
    expect(requests[0]!.headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
  });

  it("maps stream error events", async () => {
    const { http } = recordingHttp([
      () => new Response(streamOf([sse([{ event: "error", data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }])])),
    ]);
    const provider = createProvider({ ...base, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1" }, http);
    await expect(collect(provider.streamChat(userHi))).rejects.toMatchObject({ code: "server", message: "Overloaded" });
  });
});

describe("Gemini adapter", () => {
  it("streams thoughts and text, keeps the key out of the URL", async () => {
    const body = sse(
      [
        { data: { modelVersion: "gemini-2.5-flash", candidates: [{ content: { parts: [{ text: "plan", thought: true }] } }] } },
        { data: { candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, thoughtsTokenCount: 1, totalTokenCount: 6 } } },
      ],
      "\r\n",
    );
    const { http, requests } = recordingHttp([() => new Response(streamOf(chunked(body, 9)))]);
    const provider = createProvider({ ...base, kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }, http);
    const events = await collect(
      provider.streamChat({
        model: "models/gemini-2.5-flash",
        system: "S",
        reasoning: { enabled: true },
        messages: [
          { role: "user", parts: [{ type: "text", text: "x" }, { type: "video", mimeType: "video/mp4", url: "https://files/v1" }] },
          { role: "assistant", parts: [{ type: "text", text: "y" }] },
        ],
      }),
    );
    expect(events).toContainEqual({ type: "reasoning-delta", text: "plan" });
    expect(textOf(events)).toBe("Hi");
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop", usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 } });

    const request = requests[0]!;
    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
    expect(request.url).not.toContain("key=");
    expect(request.headers["x-goog-api-key"]).toBe("sk-test-key-1234567890");
    expect(request.body).toMatchObject({
      systemInstruction: { parts: [{ text: "S" }] },
      generationConfig: { thinkingConfig: { includeThoughts: true } },
      contents: [
        { role: "user", parts: [{ text: "x" }, { file_data: { mime_type: "video/mp4", file_uri: "https://files/v1" } }] },
        { role: "model", parts: [{ text: "y" }] },
      ],
    });
  });

  it("lists only generateContent models without the models/ prefix", async () => {
    const { http } = recordingHttp([
      () =>
        Response.json({
          models: [
            { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
    ]);
    const models = await createProvider({ ...base, kind: "gemini", baseUrl: "https://g/v1beta" }, http).listModels();
    expect(models.map((m) => m.id)).toEqual(["gemini-2.5-pro"]);
    expect(models[0]).toMatchObject({ contextWindow: 1048576, capabilities: { video: true, reasoning: true } });
  });

  it("maps safety stops to content_filter", async () => {
    const { http } = recordingHttp([() => new Response(streamOf([sse([{ data: { candidates: [{ finishReason: "SAFETY" }] } }])]))]);
    const events = await collect(createProvider({ ...base, kind: "gemini", baseUrl: "https://g/v1beta" }, http).streamChat(userHi));
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "content_filter" });
  });
});

describe("Ollama adapter", () => {
  it("streams NDJSON from /api/chat", async () => {
    const body =
      ['{"model":"llama3.2","message":{"content":"A","thinking":"t"},"done":false}', '{"message":{"content":"B"},"done":false}', '{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":5,"eval_count":2}'].join("\n") + "\n";
    const { http, requests } = recordingHttp([() => new Response(streamOf(chunked(body, 5)))]);
    const provider = createProvider({ id: "o", name: "Ollama", kind: "ollama", baseUrl: "http://localhost:11434", transport: "direct" }, http);
    const events = await collect(
      provider.streamChat({
        model: "llama3.2",
        maxTokens: 20,
        messages: [{ role: "user", parts: [{ type: "text", text: "x" }, { type: "image", mimeType: "image/png", data: "QUJD" }] }],
      }),
    );
    expect(textOf(events)).toBe("AB");
    expect(events).toContainEqual({ type: "reasoning-delta", text: "t" });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 5, outputTokens: 2, cachedTokens: 0, totalTokens: 7 } });
    expect(requests[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(requests[0]!.headers.authorization).toBeUndefined();
    expect(requests[0]!.body).toMatchObject({ options: { num_predict: 20 }, messages: [{ role: "user", content: "x", images: ["QUJD"] }] });
  });

  it("lists models from /api/tags as free", async () => {
    const { http } = recordingHttp([() => Response.json({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5" }] })]);
    const models = await createProvider({ id: "o", name: "O", kind: "ollama", baseUrl: "http://localhost:11434", transport: "direct" }, http).listModels();
    expect(models.map((m) => [m.id, m.inputCost])).toEqual([
      ["llama3.2:3b", 0],
      ["qwen2.5", 0],
    ]);
  });

  it("rejects unsupported media", async () => {
    const provider = createProvider({ id: "o", name: "O", kind: "ollama", baseUrl: "http://localhost:11434", transport: "direct" }, recordingHttp([() => new Response("")]).http);
    await expect(
      collect(provider.streamChat({ model: "m", messages: [{ role: "user", parts: [{ type: "video", mimeType: "video/mp4", url: "https://v" }] }] })),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("custom headers", () => {
  it("adds safe custom headers and ignores forbidden ones", async () => {
    const { http, requests } = recordingHttp([() => new Response(streamOf([sse([{ data: "[DONE]" }])]))]);
    const provider = createProvider(
      { ...base, kind: "custom", baseUrl: "https://llm.example/v1", headers: { "X-Org": "acme", Cookie: "steal=1", Host: "evil" } },
      http,
    );
    await collect(provider.streamChat(userHi));
    expect(requests[0]!.headers["x-org"]).toBe("acme");
    expect(requests[0]!.headers.cookie).toBeUndefined();
    expect(requests[0]!.headers.host).toBeUndefined();
  });
});
