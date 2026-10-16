export declare const DEEP_LINK_SCHEME: string;
export declare const PERMISSIONS: string[];
export declare function patchManifest(xml: string, options?: { cleartext?: boolean }): string;
export declare function patchVariables(gradle: string): string;
export declare function patchAppGradle(gradle: string, version?: { name: string; code: number }): string;
export declare function versionCode(semver: string): number;
export declare function patchStyles(xml: string): string;
