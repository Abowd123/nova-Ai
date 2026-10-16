/** In-memory WebDAV server speaking Nextcloud-flavoured XML, with failure injection. */
export interface FakeDavOptions {
  /** Base path, e.g. /remote.php/dav/files/alice/ */
  basePath?: string;
  username?: string;
  password?: string;
}

export class FakeWebDav {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(["/"]);
  readonly log: string[] = [];
  /** Return a network error for requests matching this predicate (consumed when it returns true once per call). */
  failWhen: ((method: string, path: string) => boolean) | null = null;
  /** Cut GET bodies after N bytes (simulates a dropped download; next Range request continues). */
  truncateNextGetAt: number | null = null;
  readonly origin = "https://cloud.test";
  readonly basePath: string;

  constructor(private readonly options: FakeDavOptions = {}) {
    this.basePath = options.basePath ?? "/remote.php/dav/files/alice/";
  }

  get baseUrl(): string {
    return this.origin + this.basePath;
  }

  private rel(url: string): string {
    const path = decodeURIComponent(new URL(url).pathname);
    if (!path.startsWith(this.basePath.replace(/\/$/, ""))) throw new Error(`outside base: ${path}`);
    const rest = "/" + path.slice(this.basePath.length).replace(/^\/+/, "");
    return rest.length > 1 ? rest.replace(/\/+$/, "") : "/";
  }

  private parent(path: string): string {
    const index = path.lastIndexOf("/");
    return index <= 0 ? "/" : path.slice(0, index);
  }

  private entryXml(path: string): string {
    const isDir = this.dirs.has(path);
    const href = this.basePath.replace(/\/$/, "") + path.split("/").map(encodeURIComponent).join("/") + (isDir && path !== "/" ? "/" : "");
    const size = isDir ? "" : `<d:getcontentlength>${this.files.get(path)!.byteLength}</d:getcontentlength>`;
    return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${isDir ? "<d:collection/>" : ""}</d:resourcetype>${size}<d:getlastmodified>Fri, 16 Oct 2026 01:00:00 GMT</d:getlastmodified><d:getetag>&quot;e${path.length}&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><oc:fileid/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`;
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = this.rel(url);
    this.log.push(`${method} ${path}`);
    if (this.failWhen?.(method, path)) throw new TypeError("Failed to fetch");
    const auth = new Headers(init.headers).get("authorization");
    if (this.options.username) {
      const expected = `Basic ${btoa(`${this.options.username}:${this.options.password ?? ""}`)}`;
      if (auth !== expected) return new Response("", { status: 401 });
    }
    const body = init.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : new Uint8Array(0);
    switch (method) {
      case "PROPFIND": {
        const depth = new Headers(init.headers).get("depth") ?? "1";
        if (!this.dirs.has(path) && !this.files.has(path)) return new Response("", { status: 404 });
        const entries = [path];
        if (depth === "1" && this.dirs.has(path)) {
          for (const p of [...this.dirs, ...this.files.keys()]) if (p !== path && this.parent(p) === path) entries.push(p);
        }
        const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${entries.map((p) => this.entryXml(p)).join("")}</d:multistatus>`;
        return new Response(xml, { status: 207, headers: { "content-type": "application/xml; charset=utf-8" } });
      }
      case "MKCOL":
        if (this.dirs.has(path) || this.files.has(path)) return new Response("", { status: 405 });
        if (!this.dirs.has(this.parent(path))) return new Response("", { status: 409 });
        this.dirs.add(path);
        return new Response("", { status: 201 });
      case "PUT":
        if (!this.dirs.has(this.parent(path))) return new Response("", { status: 409 });
        this.files.set(path, body);
        return new Response("", { status: 201 });
      case "GET": {
        const data = this.files.get(path);
        if (!data) return new Response("", { status: 404 });
        const range = new Headers(init.headers).get("range");
        let start = 0;
        if (range) start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
        let slice = data.subarray(start);
        if (this.truncateNextGetAt !== null) {
          slice = slice.subarray(0, this.truncateNextGetAt);
          this.truncateNextGetAt = null;
        }
        return new Response(slice as BodyInit, { status: range ? 206 : 200 });
      }
      case "DELETE": {
        if (!this.dirs.has(path) && !this.files.has(path)) return new Response("", { status: 404 });
        for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + "/")) this.files.delete(p);
        for (const p of [...this.dirs]) if (p === path || p.startsWith(path + "/")) this.dirs.delete(p);
        return new Response(null, { status: 204 });
      }
      case "MOVE": {
        const destination = this.rel(new Headers(init.headers).get("destination")!);
        const data = this.files.get(path);
        if (!data) return new Response("", { status: 404 });
        this.files.delete(path);
        this.files.set(destination, data);
        return new Response("", { status: 201 });
      }
      default:
        return new Response("", { status: 405 });
    }
  };
}
