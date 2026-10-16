import { UI_STORAGE_KEY } from "@/stores/ui-store";

/**
 * Runs before first paint (inline in <head>):
 *  1. Applies saved lang/dir to avoid an RTL/LTR flash.
 *  2. Captures `beforeinstallprompt` early so the install button never misses it.
 * Contains no secrets and reads only non-sensitive UI prefs.
 */
export function getBootScript(defaultLocale: "ar" | "en"): string {
  return `(function(){try{var d=document.documentElement;var l=${JSON.stringify(defaultLocale)};var raw=localStorage.getItem(${JSON.stringify(UI_STORAGE_KEY)});if(raw){var p=JSON.parse(raw);if(p&&p.state&&(p.state.locale==="ar"||p.state.locale==="en")){l=p.state.locale;}}d.lang=l;d.dir=l==="ar"?"rtl":"ltr";}catch(e){}window.__novaInstallPrompt=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__novaInstallPrompt=e;window.dispatchEvent(new Event("nova:installprompt"));});})();`;
}
