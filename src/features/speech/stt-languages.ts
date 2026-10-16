/** Common dictation languages; "auto" lets the engine detect (Whisper) or use the device language. */
export const STT_LANGUAGES = [
  { value: "auto", label: { ar: "تلقائي", en: "Auto" } },
  { value: "ar-SA", label: { ar: "العربية (السعودية)", en: "Arabic (Saudi Arabia)" } },
  { value: "ar-EG", label: { ar: "العربية (مصر)", en: "Arabic (Egypt)" } },
  { value: "ar-YE", label: { ar: "العربية (اليمن)", en: "Arabic (Yemen)" } },
  { value: "ar-AE", label: { ar: "العربية (الإمارات)", en: "Arabic (UAE)" } },
  { value: "en-US", label: { ar: "الإنجليزية (أمريكا)", en: "English (US)" } },
  { value: "en-GB", label: { ar: "الإنجليزية (بريطانيا)", en: "English (UK)" } },
  { value: "fr-FR", label: { ar: "الفرنسية", en: "French" } },
  { value: "de-DE", label: { ar: "الألمانية", en: "German" } },
  { value: "es-ES", label: { ar: "الإسبانية", en: "Spanish" } },
  { value: "tr-TR", label: { ar: "التركية", en: "Turkish" } },
  { value: "ur-PK", label: { ar: "الأردية", en: "Urdu" } },
] as const;
