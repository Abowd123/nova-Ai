import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown/markdown";
import { ReasoningSection } from "@/components/markdown/reasoning-section";

function html(content: string, streaming = false) {
  const { container } = render(<Markdown content={content} streaming={streaming} />);
  return container;
}

function assertNoActiveContent(container: HTMLElement) {
  expect(container.querySelector("script, iframe, object, embed, style, form, base, meta, link")).toBeNull();
  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.getAttributeNames()) {
      expect(attribute.startsWith("on")).toBe(false);
      if (attribute === "style" && !element.closest(".katex, .katex-error")) {
        throw new Error(`unexpected style attribute on <${element.tagName.toLowerCase()}>`);
      }
    }
    const href = element.getAttribute("href") ?? element.getAttribute("src") ?? "";
    expect(href.toLowerCase().replace(/\s/g, "")).not.toMatch(/^(javascript|vbscript|data):/);
  }
}

describe("Markdown rendering", () => {
  it("renders headings, lists, quotes, links and tables", () => {
    const container = html(
      "# Title\n\n- one\n- two\n\n1. first\n\n> quoted\n\n[site](https://example.com)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(container.querySelectorAll("ul li").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("ol li")).toHaveTextContent("first");
    expect(container.querySelector("blockquote")).toHaveTextContent("quoted");
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("href", "https://example.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    const table = container.querySelector("table");
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
  });

  it("renders inline and block LaTeX with KaTeX", () => {
    const container = html("Inline $E=mc^2$ and\n\n$$\n\\int_0^1 x\\,dx\n$$");
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("renders code blocks with language label, highlighting and a copy button", () => {
    const container = html("```typescript\nconst x: number = 1;\n```");
    expect(screen.getByTestId("code-language")).toHaveTextContent("typescript");
    expect(screen.getByRole("button", { name: /نسخ الكود|Copy code/ })).toBeInTheDocument();
    expect(container.querySelector("code.hljs")?.textContent).toContain("const x: number = 1;");
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(container.querySelector("pre")?.closest("[dir=ltr]")).not.toBeNull();
  });

  it("keeps unknown languages as plain code", () => {
    html("```notalanguage\nhello\n```");
    expect(screen.getByTestId("code-language")).toHaveTextContent("notalanguage");
  });

  it("uses auto direction for mixed Arabic/English content", () => {
    const container = html("مرحبا Nova، كيف حالك؟\n\nHello مرحبا");
    expect(container.querySelector('[data-testid="markdown"]')).toHaveAttribute("dir", "auto");
    expect(container.textContent).toContain("مرحبا Nova");
  });

  it("renders unfinished markdown while streaming", () => {
    const container = html("Here:\n\n```js\nconsole.log(1)", true);
    expect(container.querySelector("pre code")?.textContent).toContain("console.log(1)");
    const bold = html("This is **impor", true);
    expect(bold.querySelector("strong")).toHaveTextContent("impor");
  });

  describe("XSS protection", () => {
    it.each([
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe src="https://evil"></iframe>',
      '<svg onload="alert(1)"></svg>',
      '<div style="background:url(javascript:alert(1))">x</div>',
      "<style>body{display:none}</style>",
      '<form action="https://evil"><input name="q"></form>',
      "[click](javascript:alert(1))",
      "[click](JaVaScRiPt:alert(1))",
      "[click](java\tscript:alert(1))",
      "[click](&#106;avascript:alert(1))",
      "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      "[click](vbscript:msgbox)",
      "![img](javascript:alert(1))",
      "![img](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
      "<javascript:alert(1)>",
      "[ref]\n\n[ref]: javascript:alert(1)",
      "$\\href{javascript:alert(1)}{x}$",
      "$$\\htmlStyle{color:red}{x}$$",
    ])("neutralises %j", (payload) => {
      const container = html(payload);
      assertNoActiveContent(container);
    });

    it("does not render raw HTML as elements", () => {
      const container = html("<b>bold?</b> <marquee>hi</marquee>");
      expect(container.querySelector("b, marquee")).toBeNull();
    });

    it("also sanitises while streaming", () => {
      assertNoActiveContent(html("[x](javascript:alert(1)) <img src=x onerror=alert(1)> **bo", true));
    });
  });
});

describe("ReasoningSection", () => {
  it("is collapsible and open while streaming", () => {
    const { container, rerender } = render(<ReasoningSection text="step 1" streaming />);
    expect(container.querySelector("details")).toHaveAttribute("open");
    rerender(<ReasoningSection text="step 1" streaming={false} />);
    expect(container.querySelector("summary")).toBeInTheDocument();
  });

  it("renders nothing without reasoning", () => {
    const { container } = render(<ReasoningSection text="  " streaming={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
