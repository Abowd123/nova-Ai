import {
  APP_SETTINGS_KEY,
  appSettingsPatchSchema,
  appSettingsSchema,
  DEFAULT_SETTINGS,
  type AppSettings,
} from "@/lib/models";
import { withStorageErrors } from "../../errors";
import type { RepositoryDeps, SettingsRepository } from "../../types";
import type { NovaDatabase } from "../database";
import { mergeSettings } from "@/lib/models/settings-merge";

export { mergeSettings };
import { parseOrThrow } from "../utils";

export function createSettingsRepository(db: NovaDatabase, deps: RepositoryDeps): SettingsRepository {
  return {
    get: () =>
      withStorageErrors(async () => mergeSettings((await db.settings.get(APP_SETTINGS_KEY))?.value)),

    update: (patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(appSettingsPatchSchema, patch, "settings patch");
        return db.transaction("rw", db.settings, async () => {
          const current = mergeSettings((await db.settings.get(APP_SETTINGS_KEY))?.value);
          const next = parseOrThrow(appSettingsSchema, { ...current, ...data }, "settings");
          await db.settings.put({ key: APP_SETTINGS_KEY, value: next, updatedAt: deps.clock() });
          return next;
        });
      }),

    reset: () =>
      withStorageErrors(async () => {
        await db.settings.delete(APP_SETTINGS_KEY);
        return { ...DEFAULT_SETTINGS };
      }),
  };
}
