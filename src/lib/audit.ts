import type { AuditKind } from "@/lib/models";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/lib/security/redact";

/**
 * Local, secret-free audit log of security-relevant actions (keys, tool approvals, MCP,
 * backups, sync, imports, data deletion). Stays on this device; never synced or uploaded.
 */
type Sink = (kind: AuditKind, detail: string) => Promise<unknown>;

let sink: Sink | null = null;

export function setAuditSink(next: Sink | null): void {
  sink = next;
}

export function audit(kind: AuditKind, detail = ""): void {
  if (!sink) return;
  void sink(kind, redactSecrets(detail).slice(0, 500)).catch((error: unknown) => logger.warn("Audit log write failed", error));
}
