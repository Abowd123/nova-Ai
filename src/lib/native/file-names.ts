/** Only safe characters in file names written to shared storage. */
export function safeFileName(name: string): string {
  const clean = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\p{Cc}+/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return clean || "nova-file";
}
