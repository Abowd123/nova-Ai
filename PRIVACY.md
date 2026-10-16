# Privacy policy (Nova)

_Last updated: October 2026_

**Your device first.** Nova runs locally. Conversations, assistants, memories, attachments and settings are stored in your browser (IndexedDB / OPFS) on your device. Nova has no backend that collects your data and uses no analytics, trackers or advertising.

**What leaves your device, and only when you use it:**
- Messages and attachments you send go to the AI provider you configured, using your own API key.
- Web search queries go to the search provider you chose (Tavily, Brave, Exa or your SearXNG); page reading goes through the Nova server you run.
- MCP servers receive the tool calls you approve.
- WebDAV receives your backups and sync files (encrypted with your passphrase when enabled).
- "Route through the Nova server" relays requests through the app server you deploy; it does not store them.

**Keys.** API keys and tokens are encrypted on your device with a non-extractable key, never logged, never synced, and only included in exports or backups when those are encrypted with your password.

**Your control.** Export all data at any time; delete all data (IndexedDB, OPFS, caches and local storage) from Settings. A local event log records sensitive actions and can be cleared. Nothing is shared with the developers of Nova.

**Contact.** Questions: the maintainers of your Nova deployment.
