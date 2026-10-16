import { describe, expect, it } from "vitest";
import { ComfyClient, ComfyImageGenerator, comfyWsUrl } from "@/lib/imagegen/comfy-client";
import { applyParams, ComfyWorkflowError, detectMapping, listNodeInputs, parseWorkflow } from "@/lib/imagegen/comfy-workflow";
import { ImageGenError } from "@/lib/imagegen/types";
import type { ComfyWorkflowJson } from "@/lib/models";
import { defaultWorkflow, params } from "./fixtures";

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("ComfyUI workflows", () => {
  it("parses API-format JSON and rejects the UI format and garbage", () => {
    expect(Object.keys(parseWorkflow(JSON.stringify(defaultWorkflow())))).toHaveLength(7);
    expect(() => parseWorkflow("{nope")).toThrow(ComfyWorkflowError);
    let code = "";
    try {
      parseWorkflow(JSON.stringify({ nodes: [], links: [] }));
    } catch (e) {
      code = (e as ComfyWorkflowError).code;
    }
    expect(code).toBe("ui_format");
    try {
      parseWorkflow(JSON.stringify({ a: 1 }));
    } catch (e) {
      code = (e as ComfyWorkflowError).code;
    }
    expect(code).toBe("invalid_workflow");
  });

  it("lists editable inputs only (not links)", () => {
    const nodes = listNodeInputs(defaultWorkflow());
    const sampler = nodes.find((n) => n.nodeId === "3")!;
    expect(sampler.inputs).toContain("seed");
    expect(sampler.inputs).not.toContain("positive");
    expect(nodes.find((n) => n.nodeId === "6")!.title).toBe("Positive");
    expect(nodes.find((n) => n.nodeId === "8")).toBeUndefined();
  });

  it("detects the mapping by following the sampler links", () => {
    expect(detectMapping(defaultWorkflow())).toEqual({
      prompt: { nodeId: "6", input: "text" },
      negativePrompt: { nodeId: "7", input: "text" },
      seed: { nodeId: "3", input: "seed" },
      width: { nodeId: "5", input: "width" },
      height: { nodeId: "5", input: "height" },
      batchSize: { nodeId: "5", input: "batch_size" },
      steps: { nodeId: "3", input: "steps" },
      guidance: { nodeId: "3", input: "cfg" },
    });
  });

  it("detects Flux graphs with a guider and noise_seed", () => {
    const flux = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "x", clip: ["9", 0] } },
      "2": { class_type: "FluxGuidance", inputs: { guidance: 3.5, conditioning: ["1", 0] } },
      "3": { class_type: "BasicGuider", inputs: { model: ["9", 0], conditioning: ["2", 0] } },
      "4": { class_type: "RandomNoise", inputs: { noise_seed: 7 } },
      "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
      "9": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors" } },
    } as ComfyWorkflowJson;
    const mapping = detectMapping(flux);
    expect(mapping.prompt).toEqual({ nodeId: "1", input: "text" });
    expect(mapping.seed).toEqual({ nodeId: "4", input: "noise_seed" });
    expect(mapping.guidance).toEqual({ nodeId: "2", input: "guidance" });
    expect(mapping.width).toEqual({ nodeId: "5", input: "width" });
  });

  it("fails clearly without a prompt node", () => {
    expect(() => detectMapping({ "1": { class_type: "LoadImage", inputs: { image: "a.png" } } } as ComfyWorkflowJson)).toThrow(ComfyWorkflowError);
  });

  it("applies params to a copy and never overwrites links", () => {
    const workflow = defaultWorkflow();
    const mapping = { ...detectMapping(workflow), steps: { nodeId: "3", input: "positive" } };
    const next = applyParams(workflow, mapping, params({ negativePrompt: "ugly", steps: 30, guidance: 5 }), 42, 3);
    expect(next["6"]!.inputs.text).toBe("a red fox");
    expect(next["7"]!.inputs.text).toBe("ugly");
    expect(next["3"]!.inputs.seed).toBe(42);
    expect(next["3"]!.inputs.cfg).toBe(5);
    expect(next["3"]!.inputs.positive).toEqual(["6", 0]);
    expect(next["5"]!.inputs).toMatchObject({ width: 1344, height: 768, batch_size: 3 });
    expect(workflow["6"]!.inputs.text).toBe("a cat");
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onopen: ((event: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(type: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }
  close() {
    this.closed = true;
  }
}

function server(options: { historyDoneAfter?: number; failQueue?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let historyCalls = 0;
  let queued = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path.endsWith("/prompt")) {
      if (options.failQueue) return new Response(JSON.stringify({ error: { message: "Prompt outputs failed validation" }, node_errors: { "4": { errors: [{ message: "Value not in list", details: "ckpt_name" }] } } }), { status: 400 });
      queued += 1;
      return new Response(JSON.stringify({ prompt_id: `p${queued}` }));
    }
    if (path.includes("/history/")) {
      historyCalls += 1;
      const id = decodeURIComponent(path.split("/").pop()!);
      if (historyCalls <= (options.historyDoneAfter ?? 0)) return new Response("{}");
      return new Response(JSON.stringify({ [id]: { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: `${id}.png`, subfolder: "", type: "output" }, { filename: "t.png", subfolder: "", type: "temp" }] } } } }));
    }
    if (path.endsWith("/view")) return new Response(new Blob(["png"], { type: "image/png" }));
    if (path.endsWith("/system_stats")) return new Response(JSON.stringify({ system: { comfyui_version: "0.3.40" }, devices: [{ name: "cuda:0 RTX" }] }));
    return new Response("", { status: 404 });
  };
  return { fetch, calls };
}

describe("ComfyClient", () => {
  it("builds the WebSocket URL", () => {
    expect(comfyWsUrl("http://127.0.0.1:8188/", "abc")).toBe("ws://127.0.0.1:8188/ws?clientId=abc");
    expect(comfyWsUrl("https://comfy.example.com/base", "a b")).toBe("wss://comfy.example.com/base/ws?clientId=a%20b");
  });

  it("reads system stats", async () => {
    const client = new ComfyClient("http://c:8188", { fetch: server().fetch });
    expect(await client.systemStats()).toEqual({ version: "0.3.40", devices: ["cuda:0 RTX"] });
  });

  it("surfaces node validation errors from /prompt", async () => {
    const client = new ComfyClient("http://c:8188", { fetch: server({ failQueue: true }).fetch });
    const error = (await caught(client.queue(defaultWorkflow(), "cid"))) as ImageGenError;
    expect(error.code).toBe("bad_request");
    expect(error.message).toContain("node 4");
  });

  it("tracks progress over WebSocket, then downloads output images", async () => {
    FakeSocket.instances = [];
    const srv = server();
    const client = new ComfyClient("http://c:8188", { fetch: srv.fetch, WebSocket: FakeSocket });
    const progress: number[] = [];
    const generator = new ComfyImageGenerator(client, defaultWorkflow(), detectMapping(defaultWorkflow()), { clientId: () => "cid", random: () => 0.5 });
    const jobs: string[] = [];
    const run = generator.generate(params({ count: 2 }), { onProgress: (f) => progress.push(f), onJob: (id) => jobs.push(id) });
    await new Promise((r) => setTimeout(r, 0));
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("ws://c:8188/ws?clientId=cid");
    socket.send("progress", { prompt_id: "other", value: 9, max: 10 });
    socket.send("progress", { prompt_id: "p1", value: 5, max: 10 });
    socket.send("executing", { prompt_id: "p1", node: null });
    const result = await run;
    expect(jobs).toEqual(["p1"]);
    expect(progress).toContain(0.5);
    expect(progress.at(-1)).toBe(1);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.seed).toBe(2 ** 31);
    expect(socket.closed).toBe(true);
    const body = JSON.parse(srv.calls.find((c) => c.url.endsWith("/prompt"))!.init!.body as string);
    expect(body.client_id).toBe("cid");
    expect(body.prompt["5"].inputs.batch_size).toBe(2);
    expect(srv.calls.some((c) => c.url.includes("filename=p1.png"))).toBe(true);
  });

  it("resolves if the job finished before the socket opened", async () => {
    FakeSocket.instances = [];
    const client = new ComfyClient("http://c:8188", { fetch: server().fetch, WebSocket: FakeSocket });
    const wait = client.wait("p7", "cid");
    FakeSocket.instances[0]!.onopen?.({});
    expect(await wait).toEqual([{ filename: "p7.png", subfolder: "", type: "output" }]);
  });

  it("falls back to polling when the socket fails and runs sequential seeds without batch_size", async () => {
    const srv = server({ historyDoneAfter: 2 });
    const failing = class extends FakeSocket {
      constructor(url: string) {
        super(url);
        queueMicrotask(() => this.onerror?.({}));
      }
    };
    const client = new ComfyClient("http://c:8188", { fetch: srv.fetch, WebSocket: failing, sleep: async () => undefined });
    const mapping = { ...detectMapping(defaultWorkflow()), batchSize: null };
    const generator = new ComfyImageGenerator(client, defaultWorkflow(), mapping, { clientId: () => "cid" });
    const result = await generator.generate(params({ count: 2, seed: 10 }));
    expect(result.images.map((i) => i.seed)).toEqual([10, 11]);
    const seeds = srv.calls.filter((c) => c.url.endsWith("/prompt")).map((c) => JSON.parse(c.init!.body as string).prompt["3"].inputs.seed);
    expect(seeds).toEqual([10, 11]);
  });

  it("reports execution errors and cancellation", async () => {
    FakeSocket.instances = [];
    const client = new ComfyClient("http://c:8188", { fetch: server().fetch, WebSocket: FakeSocket });
    const wait = client.wait("p1", "cid");
    FakeSocket.instances[0]!.send("execution_error", { prompt_id: "p1", exception_message: "CUDA out of memory" });
    const error = (await caught(wait)) as ImageGenError;
    expect(error.code).toBe("server");
    expect(error.message).toBe("CUDA out of memory");

    const controller = new AbortController();
    const cancelled = client.wait("p2", "cid", { signal: controller.signal });
    controller.abort();
    expect(((await caught(cancelled)) as ImageGenError).code).toBe("aborted");
  });

  it("maps network failures", async () => {
    const client = new ComfyClient("http://c:8188", {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(((await caught(client.systemStats())) as ImageGenError).code).toBe("network");
  });
});
