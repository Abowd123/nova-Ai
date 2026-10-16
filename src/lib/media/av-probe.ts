import { frameTimestamps } from "./geometry";

export interface AvInfo {
  durationMs: number;
  width?: number;
  height?: number;
}

function loadElement(kind: "video" | "audio", url: string): Promise<HTMLVideoElement | HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind);
    element.preload = "metadata";
    element.muted = true;
    if (element instanceof HTMLVideoElement) element.playsInline = true;
    const timer = setTimeout(() => reject(new Error("media-timeout")), 15_000);
    element.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve(element);
    };
    element.onerror = () => {
      clearTimeout(timer);
      reject(new Error("media-unreadable"));
    };
    element.src = url;
  });
}

/** Duration (and size for video) using the browser's own demuxer. */
export async function probeMedia(blob: Blob, kind: "video" | "audio"): Promise<AvInfo> {
  const url = URL.createObjectURL(blob);
  try {
    const element = await loadElement(kind, url);
    let duration = element.duration;
    if (!Number.isFinite(duration)) {
      // MediaRecorder WebM has no duration header: seek far to force calculation.
      element.currentTime = 1e7;
      await new Promise((r) => (element.ontimeupdate = r));
      duration = element.duration;
    }
    const info: AvInfo = { durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0 };
    if (element instanceof HTMLVideoElement && element.videoWidth) {
      info.width = element.videoWidth;
      info.height = element.videoHeight;
    }
    return info;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("seek-timeout")), 10_000);
    video.onseeked = () => {
      clearTimeout(timer);
      resolve();
    };
    video.currentTime = seconds;
  });
}

export function webCodecsAvailable(): boolean {
  return typeof VideoFrame !== "undefined";
}

/**
 * Captures frames at evenly spaced timestamps. Uses WebCodecs VideoFrame when available
 * (zero-copy, transferable to the worker), else ImageBitmap. Encoding runs in the worker.
 */
export async function captureFrames(
  blob: Blob,
  count: number,
  onFrame: (frame: VideoFrame | ImageBitmap, timeMs: number, index: number) => Promise<void>,
): Promise<number[]> {
  const url = URL.createObjectURL(blob);
  try {
    const video = (await loadElement("video", url)) as HTMLVideoElement;
    const times = frameTimestamps(video.duration * 1000, count);
    for (const [index, ms] of times.entries()) {
      await seek(video, ms / 1000);
      const frame = webCodecsAvailable() ? new VideoFrame(video, { timestamp: Math.round(ms * 1000) }) : await createImageBitmap(video);
      await onFrame(frame, ms, index);
    }
    return times;
  } finally {
    URL.revokeObjectURL(url);
  }
}
