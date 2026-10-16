"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "@/components/providers/services-provider";
import { useSettings } from "@/features/settings/queries";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/media/limits";
import { DEFAULT_MEDIA_SETTINGS, type Attachment } from "@/lib/models";
import { AttachmentError, type AttachmentErrorCode } from "./attachment-service";

export type DraftStage = "reading" | "processing" | "frames" | "saving";

export interface Draft {
  localId: string;
  name: string;
  size: number;
  status: "processing" | "ready" | "error";
  stage?: DraftStage;
  attachment?: Attachment;
  error?: AttachmentErrorCode | "too_many" | "storage";
  videoMode?: "native" | "frames";
}

export interface DraftsController {
  drafts: Draft[];
  add: (files: FileList | File[]) => void;
  remove: (localId: string) => void;
  setVideoMode: (localId: string, mode: "native" | "frames") => void;
  /** Forget drafts after a successful send (attachments now belong to the message). */
  consume: () => void;
  busy: boolean;
  ready: Attachment[];
  videoModes: Record<string, "native" | "frames">;
}

let counter = 0;

/** Composer attachment drafts: processed in the background, removable before sending. */
export function useDrafts(conversationId: string): DraftsController {
  const services = useServices();
  const settings = useSettings();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const update = (localId: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));

  const add = useCallback(
    (input: FileList | File[]) => {
      const files = Array.from(input);
      const room = MAX_ATTACHMENTS_PER_MESSAGE - draftsRef.current.length;
      const accepted = files.slice(0, Math.max(0, room));
      const rejected = files.slice(accepted.length).map<Draft>((file) => ({ localId: `d${++counter}`, name: file.name, size: file.size, status: "error", error: "too_many" }));
      const fresh = accepted.map<Draft>((file) => ({ localId: `d${++counter}`, name: file.name, size: file.size, status: "processing", stage: "reading" }));
      setDrafts((list) => [...list, ...fresh, ...rejected]);
      const media = settings.data?.media ?? DEFAULT_MEDIA_SETTINGS;
      accepted.forEach((file, index) => {
        const draft = fresh[index]!;
        const controller = new AbortController();
        controllers.current.set(draft.localId, controller);
        void services()
          .attachments.prepare(file, media, { conversationId, signal: controller.signal, onStage: (stage) => update(draft.localId, { stage }) })
          .then((attachment) => {
            if (controller.signal.aborted) {
              void services().attachments.remove(attachment);
              return;
            }
            update(draft.localId, { status: "ready", attachment, name: attachment.name, size: attachment.size });
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            update(draft.localId, { status: "error", error: error instanceof AttachmentError ? error.code : "storage" });
          })
          .finally(() => controllers.current.delete(draft.localId));
      });
    },
    [conversationId, services, settings.data?.media],
  );

  const remove = useCallback(
    (localId: string) => {
      const draft = draftsRef.current.find((d) => d.localId === localId);
      controllers.current.get(localId)?.abort();
      if (draft?.attachment) void services().attachments.remove(draft.attachment);
      setDrafts((list) => list.filter((d) => d.localId !== localId));
    },
    [services],
  );

  const setVideoMode = useCallback((localId: string, mode: "native" | "frames") => update(localId, { videoMode: mode }), []);
  const consume = useCallback(() => setDrafts([]), []);

  // Leaving the conversation: abandon unfinished work (sent drafts were already consumed).
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      for (const draft of draftsRef.current) if (draft.attachment) void services().attachments.remove(draft.attachment);
    },
    [conversationId, services],
  );

  return useMemo(() => {
    const ready = drafts.filter((d) => d.status === "ready" && d.attachment).map((d) => d.attachment!);
    const videoModes: Record<string, "native" | "frames"> = {};
    for (const d of drafts) if (d.attachment && d.videoMode) videoModes[d.attachment.id] = d.videoMode;
    return { drafts, add, remove, setVideoMode, consume, busy: drafts.some((d) => d.status === "processing"), ready, videoModes };
  }, [drafts, add, remove, setVideoMode, consume]);
}
