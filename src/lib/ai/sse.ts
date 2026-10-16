export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Incremental Server-Sent Events parser (WHATWG spec): handles CRLF/CR/LF, chunks split
 * anywhere (even mid-line), multi-line data, comments, BOM and a missing final newline.
 */
export class SSEParser {
  private buffer = "";
  private data: string[] = [];
  private event = "";
  private id: string | undefined;
  private retry: number | undefined;
  private first = true;

  feed(chunk: string): SSEMessage[] {
    if (this.first) {
      this.first = false;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    this.buffer += chunk;
    const messages: SSEMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const char = this.buffer[i];
      if (char !== "\n" && char !== "\r") continue;
      // A trailing \r may be the first half of \r\n: wait for more input.
      if (char === "\r" && i === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, i);
      if (char === "\r" && this.buffer[i + 1] === "\n") i += 1;
      start = i + 1;
      const message = this.processLine(line);
      if (message) messages.push(message);
    }
    this.buffer = this.buffer.slice(start);
    return messages;
  }

  /** Call at end of stream to dispatch a final event without a trailing blank line. */
  flush(): SSEMessage[] {
    const messages: SSEMessage[] = [];
    if (this.buffer) {
      const message = this.processLine(this.buffer);
      this.buffer = "";
      if (message) messages.push(message);
    }
    const last = this.dispatch();
    if (last) messages.push(last);
    return messages;
  }

  private processLine(line: string): SSEMessage | undefined {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        this.data.push(value);
        break;
      case "event":
        this.event = value;
        break;
      case "id":
        if (!value.includes("\0")) this.id = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
    return undefined;
  }

  private dispatch(): SSEMessage | undefined {
    if (this.data.length === 0) {
      this.event = "";
      return undefined;
    }
    const message: SSEMessage = { event: this.event || "message", data: this.data.join("\n") };
    if (this.id !== undefined) message.id = this.id;
    if (this.retry !== undefined) message.retry = this.retry;
    this.data = [];
    this.event = "";
    return message;
  }
}

export async function* parseSSE(chunks: AsyncIterable<string>): AsyncGenerator<SSEMessage, void, undefined> {
  const parser = new SSEParser();
  for await (const chunk of chunks) {
    for (const message of parser.feed(chunk)) yield message;
  }
  for (const message of parser.flush()) yield message;
}

/** Newline-delimited JSON (Ollama). Invalid lines are surfaced as errors by the caller. */
export async function* parseNDJSON(chunks: AsyncIterable<string>): AsyncGenerator<string, void, undefined> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}
