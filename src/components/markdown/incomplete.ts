const FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface FenceState {
  open: boolean;
  marker: string;
}

function scanFences(lines: string[]): FenceState {
  const state: FenceState = { open: false, marker: "" };
  for (const line of lines) {
    const match = line.match(FENCE);
    if (!match?.[1]) continue;
    const marker = match[1];
    if (!state.open) {
      state.open = true;
      state.marker = marker;
    } else if (marker[0] === state.marker[0] && marker.length >= state.marker.length && line.trim() === marker) {
      state.open = false;
      state.marker = "";
    }
  }
  return state;
}

function countOutsideCode(line: string, token: string): number {
  // Ignore tokens inside inline code spans.
  const stripped = line.replace(/`[^`]*`/g, "");
  return stripped.split(token).length - 1;
}

/**
 * Makes partial Markdown (mid-stream) render sanely without changing completed content:
 * closes open code fences, $$ math blocks, inline code, bold/italic/strike on the last line,
 * and hides a dangling link/image opener.
 */
export function repairIncompleteMarkdown(input: string): string {
  if (!input) return input;
  let text = input;
  const lines = text.split("\n");
  const fence = scanFences(lines);
  if (fence.open) return `${text}${text.endsWith("\n") ? "" : "\n"}${fence.marker}`;

  // $$ blocks (outside code).
  const displayMath = text.replace(/`[^`]*`/g, "").split("$$").length - 1;
  if (displayMath % 2 === 1) return `${text}${text.endsWith("\n") ? "" : "\n"}$$`;

  const lastLine = lines.at(-1) ?? "";
  let suffix = "";

  // Fence lines (```) are not inline code delimiters.
  const backticks = FENCE.test(lastLine) ? 0 : (lastLine.match(/`/g) ?? []).length;
  if (backticks % 2 === 1) return `${text}\``;

  // Dangling link/image start: "[text](http://exa" -> drop the unfinished target.
  const dangling = lastLine.match(/!?\[[^\]]*\]\([^)\s]*$/);
  if (dangling) {
    text = text.slice(0, text.length - dangling[0].length) + dangling[0].replace(/^!?\[([^\]]*)\]\(.*$/, "$1");
  } else if (/!?\[[^\]]*$/.test(lastLine) && !/\]/.test(lastLine.slice(lastLine.lastIndexOf("[")))) {
    text = text.replace(/!?\[([^\]]*)$/, "$1");
  }

  const current = text.split("\n").at(-1) ?? "";
  for (const token of ["**", "__", "~~"]) {
    if (countOutsideCode(current, token) % 2 === 1) suffix = token + suffix;
  }
  // Single-* emphasis: an opener is followed by non-space, a closer preceded by non-space.
  // This ignores list bullets ("* item") and arithmetic ("5 * 3").
  const singles = current.replace(/`[^`]*`/g, "").replace(/\*\*/g, "");
  const openers = (singles.match(/\*(?=[^\s*])/g) ?? []).length;
  const closers = (singles.match(/(?<=[^\s*])\*/g) ?? []).length;
  if (openers > closers) suffix = `*${suffix}`;

  return text + suffix;
}

/**
 * Splits Markdown into top-level blocks on blank lines outside code fences and $$ blocks.
 * While streaming, completed blocks are memoized and only the tail re-parses.
 */
export function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let inMath = false;

  for (const line of text.split("\n")) {
    const fence = line.match(FENCE);
    if (fence?.[1]) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length && line.trim() === fence[1]) {
        inFence = false;
      }
    } else if (!inFence && line.trim() === "$$") {
      inMath = !inMath;
    }

    if (!inFence && !inMath && line.trim() === "" && current.length > 0) {
      // Keep list items / indented continuations together with their block.
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}
