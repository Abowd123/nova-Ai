/**
 * Downscales a user-picked image to a small square avatar (center crop) and returns a
 * JPEG/WebP data URL. SVG is rejected: it can embed scripts.
 */
export async function imageFileToAvatar(file: File, size = 128): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("unsupported-image");
  if (file.size > 10 * 1024 * 1024) throw new Error("image-too-large");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas-unavailable");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
