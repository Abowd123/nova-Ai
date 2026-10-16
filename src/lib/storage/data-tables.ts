/**
 * Tables that hold user data. Never included: cryptoKeys (non-extractable vault key),
 * secrets (device-bound ciphertexts; plaintext only inside encrypted backups), attachmentBlobs
 * (stored as separate archive entries), sync bookkeeping and the audit log.
 */
export const DATA_TABLES = [
  "settings",
  "providers",
  "assistants",
  "tags",
  "conversations",
  "messages",
  "attachments",
  "imageGenerations",
  "comfyWorkflows",
  "memoryChunks",
  "memoryVectors",
  "summaries",
  "lorebooks",
  "mcpServers",
  "usageRecords",
] as const;
