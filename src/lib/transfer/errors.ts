export type TransferErrorCode =
  | "invalid_json"
  | "unsupported_format"
  | "newer_version"
  | "invalid_data"
  | "password_required"
  | "wrong_password"
  | "too_large"
  | "compression_unavailable";

export class TransferError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    message: string,
    readonly details: string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TransferError";
  }
}
