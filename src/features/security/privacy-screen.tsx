"use client";

import { PageHeader } from "@/components/feedback/page-header";
import { useI18n } from "@/hooks/use-i18n";

/** Short, plain-language privacy policy (full text: PRIVACY.md in the repository). */
export function PrivacyScreen() {
  const { t } = useI18n();
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
      <PageHeader title={t.privacy.title} description={t.privacy.updated} />
      <div className="grid gap-5">
        {t.privacy.sections.map((section) => (
          <section key={section.title} className="grid gap-2">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
