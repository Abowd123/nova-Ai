export interface EncodeImageRequest {
  id: number;
  type: "encode-image";
  /** Blob (image file) or a transferable frame (ImageBitmap / VideoFrame). */
  source: Blob | ImageBitmap | VideoFrame;
  maxDimension: number;
  format: "image/webp" | "image/jpeg";
  quality: number;
  thumbnailSize: number;
}

export interface EncodeImageResult {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  thumbnail: Blob;
}

export type WorkerRequest = EncodeImageRequest;
export type WorkerResponse = { id: number; ok: true; result: EncodeImageResult } | { id: number; ok: false; error: string };
