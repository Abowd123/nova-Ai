import { fitWithin } from "./geometry";
import type { EncodeImageRequest, EncodeImageResult } from "./worker-protocol";

type Drawable = ImageBitmap | VideoFrame;

function sizeOf(source: Drawable): { width: number; height: number } {
  if ("displayWidth" in source) return { width: source.displayWidth, height: source.displayHeight };
  return { width: source.width, height: source.height };
}

async function toBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode-failed"))), type, quality));
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function render(source: Drawable, width: number, height: number, type: string, quality: number): Promise<Blob> {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!context) throw new Error("canvas-unavailable");
  if (type === "image/jpeg") {
    // JPEG has no alpha: paint white instead of black behind transparent pixels.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
  const blob = await toBlob(canvas, type, quality);
  // Browsers without WebP encoding silently return PNG: fall back to JPEG.
  if (type === "image/webp" && blob.type !== "image/webp") return render(source, width, height, "image/jpeg", quality);
  return blob;
}

/** Shared by the worker and the main-thread fallback. Strips EXIF/GPS by re-encoding. */
export async function encodeImage(request: Omit<EncodeImageRequest, "id" | "type">): Promise<EncodeImageResult> {
  let drawable: Drawable;
  let owned = false;
  if (request.source instanceof Blob) {
    drawable = await createImageBitmap(request.source, { imageOrientation: "from-image" } as ImageBitmapOptions);
    owned = true;
  } else {
    drawable = request.source;
    owned = true;
  }
  try {
    const original = sizeOf(drawable);
    const target = fitWithin(original.width, original.height, request.maxDimension);
    const blob = await render(drawable, target.width, target.height, request.format, request.quality);
    const thumbSize = fitWithin(original.width, original.height, request.thumbnailSize);
    const thumbnail = await render(drawable, thumbSize.width, thumbSize.height, "image/jpeg", 0.7);
    return { blob, width: target.width, height: target.height, originalWidth: original.width, originalHeight: original.height, thumbnail };
  } finally {
    if (owned) drawable.close();
  }
}
