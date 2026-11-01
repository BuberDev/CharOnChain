import { notFound } from "next/navigation";

import { Cta } from "../../src/components/home/cta";
import { Faq } from "../../src/components/home/faq";
import { Hero } from "../../src/components/home/hero";
import { How } from "../../src/components/home/how";
import { Leagues } from "../../src/components/home/leagues";
import { Proofs } from "../../src/components/home/proofs";
import { Showcase } from "../../src/components/home/showcase";
import { getDictionary, isLocale } from "../../src/i18n/index";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <>
      <Hero locale={locale} t={t} />
      <Proofs t={t} />
      <Showcase locale={locale} t={t} />
      <How t={t} />
      <Leagues locale={locale} t={t} />
      <Faq t={t} />
      <Cta locale={locale} t={t} />
    </>
  );
}
