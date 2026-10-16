// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SSEParser, parseNDJSON, parseSSE } from "@/lib/ai/sse";

async function* from(chunks: string[]) {
  for (const chunk of chunks) yield chunk;
}

describe("SSEParser", () => {
  it("parses LF, CRLF and CR line endings", () => {
    for (const nl of ["\n", "\r\n", "\r"]) {
      const parser = new SSEParser();
      const messages = [...parser.feed(`data: a${nl}${nl}data: b${nl}${nl}`), ...parser.flush()];
      expect(messages.map((m) => m.data)).toEqual(["a", "b"]);
    }
  });

  it("handles chunks split anywhere, including inside CRLF", () => {
    const text = "event: delta\r\ndata: {\"x\":1}\r\n\r\ndata: two\r\n\r\n";
    for (let size = 1; size <= text.length; size += 1) {
      const parser = new SSEParser();
      const out = [];
      for (let i = 0; i < text.length; i += size) out.push(...parser.feed(text.slice(i, i + size)));
      out.push(...parser.flush());
      expect(out).toEqual([
        { event: "delta", data: '{"x":1}' },
        { event: "message", data: "two" },
      ]);
    }
  });

  it("joins multi-line data, ignores comments and unknown fields", () => {
    const parser = new SSEParser();
    const out = parser.feed(": keep-alive\nfoo: bar\ndata: line1\ndata: line2\nid: 7\nretry: 3000\n\n");
    expect(out).toEqual([{ event: "message", data: "line1\nline2", id: "7", retry: 3000 }]);
  });

  it("keeps the space-less form and strips only one leading space", () => {
    const parser = new SSEParser();
    expect(parser.feed("data:x\ndata:  y\n\n")[0]?.data).toBe("x\n y");
  });

  it("strips a BOM and dispatches a final event without trailing blank line", () => {
    const parser = new SSEParser();
    expect(parser.feed("\ufeffdata: last")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "message", data: "last" }]);
  });

  it("does not dispatch events without data", () => {
    const parser = new SSEParser();
    expect(parser.feed("event: ping\n\n")).toEqual([]);
  });

  it("parseSSE works over async chunks", async () => {
    const out = [];
    for await (const message of parseSSE(from(["da", "ta: 1\n", "\ndata: [DONE]\n\n"]))) out.push(message.data);
    expect(out).toEqual(["1", "[DONE]"]);
  });
});

describe("parseNDJSON", () => {
  it("yields complete lines across chunk boundaries", async () => {
    const out = [];
    for await (const line of parseNDJSON(from(['{"a":', '1}\n{"b"', ":2}\n\n", '{"c":3}']))) out.push(line);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});
