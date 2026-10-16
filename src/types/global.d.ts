export {};

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    prompt(): Promise<void>;
    readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }

  interface NovaFilePickerType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface NovaFileSystemWritable {
    write(data: string | Blob | BufferSource): Promise<void>;
    close(): Promise<void>;
  }

  interface NovaFileHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<NovaFileSystemWritable>;
  }

  interface Window {
    __novaInstallPrompt?: BeforeInstallPromptEvent | null;
    /** File System Access API (Chromium). Optional everywhere else. */
    showSaveFilePicker?: (options?: { suggestedName?: string; types?: NovaFilePickerType[] }) => Promise<NovaFileHandle>;
    showOpenFilePicker?: (options?: { multiple?: boolean; types?: NovaFilePickerType[] }) => Promise<NovaFileHandle[]>;
  }

  interface Navigator {
    standalone?: boolean;
  }
}
