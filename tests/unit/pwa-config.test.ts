import { describe, expect, it } from "vitest";
import { isServiceWorkerEnabled, serviceWorkerUrl } from "@/features/pwa/sw-config";
import { getBootScript } from "@/lib/boot-script";

describe("service worker config", () => {
  it("enables SW only in production for auto mode", () => {
    expect(isServiceWorkerEnabled("auto", "production")).toBe(true);
    expect(isServiceWorkerEnabled("auto", "development")).toBe(false);
    expect(isServiceWorkerEnabled("always", "development")).toBe(true);
    expect(isServiceWorkerEnabled("never", "production")).toBe(false);
  });

  it("versions the SW url by build id", () => {
    expect(serviceWorkerUrl("abc 123")).toBe("/sw.js?v=abc%20123");
  });
});

describe("boot script", () => {
  it("applies the stored locale direction before paint", () => {
    localStorage.setItem("nova-ui", JSON.stringify({ state: { locale: "en" }, version: 1 }));
    new Function(getBootScript("ar"))();
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.documentElement.lang).toBe("en");
    localStorage.clear();
  });

  it("falls back to the default locale on corrupt storage", () => {
    localStorage.setItem("nova-ui", "{not json");
    new Function(getBootScript("ar"))();
    expect(document.documentElement.dir).toBe("rtl");
    localStorage.clear();
  });
});
