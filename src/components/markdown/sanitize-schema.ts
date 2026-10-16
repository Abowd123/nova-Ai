import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

/**
 * GitHub-style sanitize schema (no raw HTML, no event handlers, no style) plus the
 * classes remark-math and code blocks need. Runs BEFORE KaTeX/highlight so their trusted
 * output is not stripped.
 */
export const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./, "math-inline", "math-display"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math-inline", "math-display"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "math-display"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};
