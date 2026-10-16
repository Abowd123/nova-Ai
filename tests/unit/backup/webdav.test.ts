// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FakeWebDav } from "@tests/helpers/fake-webdav";
import { WebDavClient, WebDavError, encodePath, normalizeBaseUrl, withRetry } from "@/lib/webdav/client";
import { decodeXmlEntities, descendants, parseXml } from "@/lib/webdav/xml";

const client = (server: FakeWebDav, password = "pw") => new WebDavClient({ baseUrl: server.baseUrl, auth: { type: "basic", username: "alice", password }, http: server.fetch });

describe("WebDAV XML", () => {
  it("parses namespaced multistatus, entities and CDATA; ignores DTDs", () => {
    const doc = parseXml(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><D:multistatus xmlns:D="DAV:"><D:response><D:href>/a%20b/&amp;x</D:href><D:prop><![CDATA[<raw>]]></D:prop></D:response></D:multistatus>`);
    const responses = descendants(doc, "response");
    expect(responses).toHaveLength(1);
    expect(responses[0]!.children[0]!.text).toBe("/a%20b/&x");
    expect(responses[0]!.children[1]!.text).toBe("<raw>");
    expect(decodeXmlEntities("&xxe; &#x41;")).toBe("&xxe; A");
  });
});

describe("WebDavClient against a Nextcloud-style server", () => {
  it("creates folders, uploads, lists with sizes, downloads, moves and deletes", async () => {
    const server = new FakeWebDav({ username: "alice", password: "pw" });
    const dav = client(server);
    await dav.ensureDir("Nova/backups/x");
    await dav.put("Nova/backups/x/hello world.txt", "héllo");
    const list = await dav.list("Nova/backups/x");
    expect(list).toEqual([{ path: "/Nova/backups/x/hello world.txt", name: "hello world.txt", isCollection: false, size: 6, lastModified: Date.parse("Fri, 16 Oct 2026 01:00:00 GMT"), etag: expect.any(String), contentType: null }]);
    expect(await dav.getText("Nova/backups/x/hello world.txt")).toBe("héllo");
    await dav.move("Nova/backups/x/hello world.txt", "Nova/backups/x/b.txt");
    expect((await dav.stat("Nova/backups/x/b.txt"))?.size).toBe(6);
    await dav.delete("Nova/backups", { collection: true });
    expect(await dav.stat("Nova/backups")).toBeNull();
    expect(await dav.list("Nova/missing")).toEqual([]);
  });

  it("maps auth and conflict errors", async () => {
    const server = new FakeWebDav({ username: "alice", password: "pw" });
    let error: WebDavError | null = null;
    await client(server, "wrong").propfind("", 0).catch((e: WebDavError) => (error = e));
    expect(error!.code).toBe("unauthorized");
    await client(server).put("no/such/dir/f", "x").catch((e: WebDavError) => (error = e));
    expect(error!.code).toBe("conflict");
    expect(error!.retryable).toBe(false);
  });

  it("resumes an interrupted download with a Range request", async () => {
    const server = new FakeWebDav();
    const dav = new WebDavClient({ baseUrl: server.baseUrl, auth: null, http: server.fetch });
    await dav.put("f.bin", new Uint8Array([1, 2, 3, 4, 5, 6]));
    server.truncateNextGetAt = 2;
    const first = await dav.get("f.bin");
    expect(Array.from(first.bytes)).toEqual([1, 2]);
    const rest = await dav.get("f.bin", { from: 2 });
    expect(rest.partial).toBe(true);
    expect(Array.from(rest.bytes)).toEqual([3, 4, 5, 6]);
  });

  it("retries network drops, not auth failures", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new WebDavError("network", "drop");
        return "ok";
      },
      { baseDelayMs: 1 },
    );
    expect([value, calls]).toEqual(["ok", 3]);
    calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        throw new WebDavError("unauthorized", "no");
      },
      { baseDelayMs: 1 },
    ).catch(() => undefined);
    expect(calls).toBe(1);
  });

  it("validates URLs and paths", () => {
    expect(normalizeBaseUrl("https://x.test/dav").toString()).toBe("https://x.test/dav/");
    expect(() => normalizeBaseUrl("https://u:p@x.test/")).toThrow();
    expect(() => normalizeBaseUrl("ftp://x.test/")).toThrow();
    expect(encodePath("/a b/c#d")).toBe("a%20b/c%23d");
    expect(() => encodePath("a/../b")).toThrow();
  });
});
