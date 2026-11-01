import "@fontsource-variable/libre-franklin/wght.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "../globals.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DemoNotice } from "../../src/components/demo-notice";
import { RevealInit } from "../../src/components/reveal-init";
import { SiteFooter } from "../../src/components/site-footer";
import { SiteHeader } from "../../src/components/site-header";
import { getDictionary, isLocale, locales } from "../../src/i18n/index";

export const dynamicParams = false;

export function generateStaticParams(): { locale: string }[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: { languages: { pl: "/pl", en: "/en" } },
    // Wersja podglądowa z danymi demonstracyjnymi: nie indeksujemy.
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main">
          {t.a11y.skip}
        </a>
        <DemoNotice t={t} />
        <SiteHeader locale={locale} t={t} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter locale={locale} t={t} />
        <RevealInit />
      </body>
    </html>
  );
}
