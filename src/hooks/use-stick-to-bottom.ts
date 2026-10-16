"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const THRESHOLD = 80;

/** Keeps a scroll container pinned to the bottom while content grows, unless the user scrolls up. */
export function useStickToBottom(containerRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>) {
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      stuck.current = true;
      setAtBottom(true);
    },
    [containerRef],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;
      stuck.current = near;
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerRef]);

  useEffect(() => {
    const content = contentRef.current;
    const el = containerRef.current;
    if (!content || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [containerRef, contentRef]);

  return { atBottom, scrollToBottom };
}
