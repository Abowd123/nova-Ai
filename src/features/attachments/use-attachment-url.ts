"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";

export function useAttachment(id: string | undefined) {
  const repos = useRepositories();
  return useQuery({ queryKey: ["attachment", id], queryFn: async () => (id ? ((await repos().attachments.get(id)) ?? null) : null), enabled: Boolean(id), staleTime: 60_000 });
}

/**
 * Object URL for an attachment's binary, created lazily and revoked on unmount.
 * Returns { url, loading, missing }.
 */
export function useAttachmentUrl(id: string | undefined, enabled = true) {
  const services = useServices();
  const attachment = useAttachment(id);
  const [state, setState] = useState<{ url: string | null; loading: boolean; missing: boolean }>({ url: null, loading: Boolean(id), missing: false });

  useEffect(() => {
    if (!enabled || !attachment.data) {
      if (attachment.data === null) setState({ url: null, loading: false, missing: true });
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setState((s) => ({ ...s, loading: true }));
    void services()
      .attachments.getBlob(attachment.data)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setState({ url: null, loading: false, missing: true });
          return;
        }
        url = URL.createObjectURL(blob);
        setState({ url, loading: false, missing: false });
      })
      .catch(() => !cancelled && setState({ url: null, loading: false, missing: true }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment.data, enabled, services]);

  return { ...state, attachment: attachment.data ?? null };
}
