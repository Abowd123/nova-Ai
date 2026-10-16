import { TransferError } from "./errors";

export function compressionAvailable(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!compressionAvailable()) throw new TransferError("compression_unavailable", "CompressionStream is not supported");
  return pipe(bytes, new CompressionStream("gzip"));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!compressionAvailable()) throw new TransferError("compression_unavailable", "DecompressionStream is not supported");
  try {
    return await pipe(bytes, new DecompressionStream("gzip"));
  } catch (error) {
    throw new TransferError("invalid_data", "Compressed data is corrupted", [], { cause: error });
  }
}
