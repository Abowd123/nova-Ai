"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChatService, type ReplyCompleteInfo } from "@/features/chat/engine/chat-service";
import { createWebLocks } from "@/features/chat/engine/stream-locks";
import { zustandStreamingSink } from "@/features/chat/engine/streaming-store";
import { AttachmentService } from "@/features/attachments/attachment-service";
import { ImageGenService } from "@/features/images/image-gen-service";
import { ProviderService } from "@/features/providers/provider-service";
import { SpeechService } from "@/features/speech/speech-service";
import { MemoryService } from "@/features/memory/memory-service";
import { SummaryService } from "@/features/memory/summary-service";
import { createWorkerIndexClient } from "@/lib/memory/index-client";
import { httpForTransport } from "@/lib/ai/transport";
import { ImageProcessor } from "@/lib/media/image-processor";
import { createOpfsBlobStore, opfsAvailable } from "@/lib/storage/opfs-blob-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { SecretVault } from "@/lib/crypto/vault";
import { logger } from "@/lib/logger";
import { getKeyStore } from "@/lib/storage";
import { useUiStore } from "@/stores/ui-store";
import { useRepositories } from "./repository-provider";
import { ToolRegistry } from "@/lib/tools/registry";
import { ToolRunner } from "@/lib/tools/runner";
import { useToolStore } from "@/features/chat/engine/tool-store";
import { JsSandbox, browserWorkerFactory } from "@/lib/sandbox/js-sandbox";
import { PyodidePythonProvider } from "@/lib/sandbox/pyodide-provider";
import { createProxyHttp, directHttp } from "@/lib/ai/transport";
import { ServiceKeys } from "@/features/tools/service-keys";
import { SubagentService } from "@/features/tools/subagent-service";
import { createBuiltinTools } from "@/features/tools/builtin-tools";
import { McpService } from "@/features/tools/mcp-service";
import { useMcpStatusStore } from "@/features/tools/mcp-status";
import { redirectUriFor } from "@/lib/mcp/oauth";
import { DEFAULT_PYODIDE_URL, DEFAULT_TOOL_SETTINGS, type ToolPermission } from "@/lib/models";
import { isNativeApp } from "@/lib/platform";
import { BackupService } from "@/features/backup/backup-service";
import { Scheduler } from "@/features/backup/scheduler";
import { SyncService } from "@/features/sync/sync-service";
import { deviceIdentity } from "@/features/backup/device";
import { audit, setAuditSink } from "@/lib/audit";
import type { Attachment } from "@/lib/models";

export interface Services {
  vault: SecretVault;
  providers: ProviderService;
  chat: ChatService;
  attachments: AttachmentService;
  speech: SpeechService;
  imageGen: ImageGenService;
  memory: MemoryService;
  summaries: SummaryService;
  tools: ToolRegistry;
  keys: ServiceKeys;
  subagent: SubagentService;
  mcp: McpService;
  js: JsSandbox;
  python: PyodidePythonProvider;
  setToolPermission: (name: string, permission: ToolPermission) => Promise<void>;
  backup: BackupService;
  sync: SyncService;
  scheduler: Scheduler;
  /** Reply-finished events (native notifications, haptics). Returns unsubscribe. */
  onReply: (listener: (info: ReplyCompleteInfo) => void) => () => void;
  device: ReturnType<typeof deviceIdentity>;
}

function notify(title: string, body: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png", tag: "nova-image" });
  } catch {
    /* some mobile browsers only allow notifications from the service worker */
  }
}

const ServicesContext = createContext<(() => Services) | null>(null);

/**
 * Lazily builds browser-only services (vault, provider service, chat engine) the first
 * time they are needed. Nothing touches IndexedDB/WebCrypto during SSR.
 */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const repos = useRepositories();
  const queryClient = useQueryClient();

  const getServices = useMemo(() => {
    let services: Services | null = null;
    return () => {
      if (services) return services;
      const repositories = repos();
      const vault = new SecretVault(getKeyStore());
      const providers = new ProviderService(repositories, vault);
      const images = new ImageProcessor();
      const opfs = opfsAvailable() ? createOpfsBlobStore() : null;
      const attachments = new AttachmentService({ repos: repositories, images, opfs });
      setAuditSink((kind, detail) => repositories.audit.add(kind, detail));
      const getProviderConfig = (id: string) => providers.getConfig(id);
      const speech = new SpeechService({
        repos: repositories,
        vault,
        getProviderConfig,
        locale: () => useUiStore.getState().locale,
        codePlaceholder: () => dictionaries[useUiStore.getState().locale].speech.codeOmitted,
      });
      const imageGen = new ImageGenService({
        repos: repositories,
        images,
        getProviderConfig,
        notify,
        appUrl: typeof location !== "undefined" ? location.origin : undefined,
        onChange: () => void queryClient.invalidateQueries({ queryKey: ["image-generations"] }),
      });
      const invalidateMemory = () => void queryClient.invalidateQueries({ queryKey: ["memory"] });
      let memoryRef: MemoryService | null = null;
      const memory = new MemoryService({
        repos: repositories,
        getProviderConfig,
        httpFor: (config) => httpForTransport(config.transport),
        index: createWorkerIndexClient({ onLost: () => memoryRef?.invalidate() }),
        onChange: invalidateMemory,
        isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
        appUrl: typeof location !== "undefined" ? location.origin : undefined,
      });
      memoryRef = memory;
      let summaries: SummaryService | null = null;
      const replyListeners = new Set<(info: ReplyCompleteInfo) => void>();
      let chatRef: ChatService | null = null;

      // ---- tools (1.4)
      const registry = new ToolRegistry();
      const keys = new ServiceKeys({ repos: repositories, vault });
      const toolSettings = async () => (await repositories.settings.get()).tools ?? DEFAULT_TOOL_SETTINGS;
      const setToolPermission = async (name: string, permission: ToolPermission) => {
        const current = await toolSettings();
        await repositories.settings.update({ tools: { ...current, permissions: { ...current.permissions, [name]: permission } } });
        audit("permission_changed", `${name} → ${permission}`);
        void queryClient.invalidateQueries({ queryKey: ["settings"] });
      };
      const js = new JsSandbox({ createWorker: browserWorkerFactory });
      const python = new PyodidePythonProvider({ indexUrl: () => DEFAULT_PYODIDE_URL });
      const proxyHttp = createProxyHttp();
      const subagent = new SubagentService({
        repos: repositories,
        getChatProvider: (id) => providers.getChatProvider(id),
        fallbackModel: async (conversationId) => {
          if (!conversationId || !chatRef) return null;
          const resolved = await chatRef.resolveModel(conversationId).catch(() => null);
          return resolved ? { providerId: resolved.provider.id, modelId: resolved.modelId } : null;
        },
        tools: async () => registry.resolve({ enabledTools: null, settings: await toolSettings() }),
      });
      for (const tool of createBuiltinTools({
        settings: async () => {
          const current = await toolSettings();
          python.configure(current.python.indexUrl);
          return current;
        },
        getAssistant: (id) => repositories.assistants.get(id),
        memory,
        js,
        python,
        keys,
        searchHttp: proxyHttp,
        subagent,
        saveFile: async (conversationId, file) => (await attachments.saveGenerated(file, conversationId)).id,
      })) {
        registry.register(tool);
      }
      const mcp = new McpService({
        repos: repositories,
        vault,
        registry,
        fetchFor: (viaProxy) => (viaProxy ? proxyHttp : directHttp),
        setStatus: (id, status) => useMcpStatusStore.getState().set(id, status),
        storage: () => localStorage,
        redirectUri: () => redirectUriFor(location, isNativeApp()),
        onChange: () => void queryClient.invalidateQueries({ queryKey: ["mcp-servers"] }),
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
      });
      const runner = new ToolRunner({
        approve: async (request, signal) => {
          const decision = await useToolStore.getState().request(request, signal);
          audit(decision === "deny" ? "tool_denied" : decision === "always" ? "tool_always_allowed" : "tool_approved", request.toolName);
          return decision;
        },
        setPermission: setToolPermission,
        onState: (_conversationId, state) => useToolStore.getState().setCall(state),
      });

      const chat = new ChatService({
        repos: repositories,
        getChatProvider: (id) => providers.getChatProvider(id),
        sink: zustandStreamingSink,
        locks: createWebLocks(),
        locale: () => useUiStore.getState().locale,
        onChange: () => {
          void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        },
        media: attachments.asMediaSource(),
        context: { retriever: memory, summaries: repositories.summaries, lorebooks: repositories.lorebooks },
        tools: {
          resolve: async ({ assistant, settings }) => {
            const servers = await repositories.mcpServers.list().catch(() => []);
            const slugs = new Map(servers.map((server) => [server.id, server.slug]));
            return registry.resolve({ enabledTools: assistant ? assistant.enabledTools : null, settings: settings.tools ?? DEFAULT_TOOL_SETTINGS, mcpSlugOf: (id) => slugs.get(id) });
          },
          runner,
          onRunFinished: (callIds) => setTimeout(() => useToolStore.getState().clearConversation(callIds), 1500),
        },
        auxiliary: {
          titleModel: async () => ((await toolSettings()).subagent.useForTitles ? subagent.configuredModel() : null),
          recordUsage: ({ kind, providerId, modelId, conversationId, usage }) => subagent.record(kind, providerId, modelId, conversationId, usage),
        },
        onReplyComplete: (info) => {
          for (const listener of replyListeners) listener(info);
          void speech.handleReplyComplete(info).catch((error: unknown) => logger.warn("TTS autoplay failed", error));
          void memory.indexLatestTurn(info.conversationId).catch((error: unknown) => logger.warn("Memory indexing failed", error));
          void summaries
            ?.maybeAutoSummarize(info.conversationId, info.historyTokens, info.contextWindow)
            .catch((error: unknown) => logger.warn("Auto summary failed", error));
        },
      });
      summaries = new SummaryService({
        repos: repositories,
        getChatProvider: (id) => providers.getChatProvider(id),
        resolveModel: (conversationId) => chat.resolveModel(conversationId),
        onChange: (conversationId) => void queryClient.invalidateQueries({ queryKey: ["summary", conversationId] }),
        fallbackModel: () => subagent.configuredModel(),
        recordUsage: ({ providerId, modelId, conversationId, usage }) => subagent.record("summary", providerId, modelId, conversationId, usage),
      });
      chatRef = chat;

      // ---- WebDAV backups + sync (1.4.2)
      const device = deviceIdentity(repositories);
      const httpFor = (viaProxy: boolean) => (viaProxy ? proxyHttp : directHttp);
      const readBlob = (attachment: Attachment) => attachments.getBlob(attachment);
      const writeBlob = async (attachment: Attachment, blob: Blob): Promise<Attachment["storage"]> => {
        if (attachment.storage === "opfs" && opfs) {
          await opfs.put(attachment.id, blob);
          return "opfs";
        }
        await repositories.blobs.put(attachment.id, blob);
        return "idb";
      };
      const afterRemoteChange = (tables: Set<string>) => {
        if (tables.has("memoryChunks")) {
          memory.invalidate();
          void memory.ensureIndex().catch((error: unknown) => logger.warn("Memory index reload failed", error));
        }
        void queryClient.invalidateQueries();
      };
      const backup = new BackupService({
        repos: repositories,
        vault,
        httpFor,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.4.2",
        device: () => device.get(),
        readBlob,
        writeBlob,
        scratch: repositories.blobs,
        onRestored: () => afterRemoteChange(new Set(["memoryChunks"])),
        audit,
      });
      const sync = new SyncService({
        repos: repositories,
        vault,
        httpFor,
        deviceId: async () => (await device.get()).id,
        readBlob,
        writeBlob,
        scratch: repositories.blobs,
        onApplied: afterRemoteChange,
        audit,
      });
      const scheduler = new Scheduler({
        jobs: [
          {
            name: "backup",
            dueIn: async () => {
              const settings = (await repositories.settings.get()).backup;
              if (!settings.schedule.enabled || !settings.webdav.url) return null;
              if (await backup.pendingUpload()) return 0;
              const last = await backup.lastBackup();
              return (last?.at ?? 0) + settings.schedule.intervalHours * 3_600_000 - Date.now();
            },
            run: async () => ((await backup.pendingUpload()) ? backup.resumeUpload() : backup.createBackup()),
          },
          {
            name: "sync",
            dueIn: async () => {
              const settings = (await repositories.settings.get()).backup;
              if (!settings.sync.enabled || !settings.webdav.url) return null;
              const last = await sync.lastSync();
              return (last?.at ?? 0) + settings.sync.intervalMinutes * 60_000 - Date.now();
            },
            run: () => sync.sync(),
          },
        ],
      });
      services = { vault, providers, chat, attachments, speech, imageGen, memory, summaries, tools: registry, keys, subagent, mcp, js, python, setToolPermission, backup, sync, scheduler, device,
        onReply: (listener) => {
          replyListeners.add(listener);
          return () => replyListeners.delete(listener);
        },
      };
      return services;
    };
  }, [repos, queryClient]);

  // Crash recovery: streams left "streaming" by a closed/reloaded tab become "interrupted".
  useEffect(() => {
    const run = () =>
      getServices()
        .chat.recoverInterrupted()
        .catch((error: unknown) => logger.warn("Stream recovery failed", error));
    void run();
    const timer = setTimeout(() => void run(), 16_000);
    const idle = setTimeout(() => {
      void getServices().attachments.sweep().catch((error: unknown) => logger.warn("Attachment sweep failed", error));
      void getServices().imageGen.resumeInterrupted().catch((error: unknown) => logger.warn("Image job resume failed", error));
      // Resume background embedding left over from the last session.
      void getServices().memory.ensureIndex().catch((error: unknown) => logger.warn("Memory index load failed", error));
      void getServices().mcp.start().catch((error: unknown) => logger.warn("MCP start failed", error));
      getServices().scheduler.start();
    }, 2_000);
    const onOnline = () => getServices().memory.schedule();
    window.addEventListener("online", onOnline);
    const onPageHide = () => getServices().chat.stopAll();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearTimeout(timer);
      clearTimeout(idle);
      getServices().scheduler.stop();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
    };
  }, [getServices]);

  return <ServicesContext.Provider value={getServices}>{children}</ServicesContext.Provider>;
}

export function useServices(): () => Services {
  const context = useContext(ServicesContext);
  if (!context) throw new Error("useServices must be used inside <ServicesProvider>");
  return context;
}
