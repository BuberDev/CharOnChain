import Link from "next/link";
import { Suspense } from "react";

import type { Dictionary, Locale } from "../i18n/index";

import { LocaleSwitch } from "./locale-switch";
import { MobileMenu } from "./mobile-menu";

/** Nagłówek: znak, 3–4 zwykłe linki, jedna akcja. Na telefonie menu to przycisk (komponent kliencki). */
export function SiteHeader({ locale, t }: { readonly locale: Locale; readonly t: Dictionary }) {
  const base = `/${locale}`;
  const links = [
    { href: `${base}#zbiorki`, label: t.nav.campaigns },
    { href: `${base}#jak`, label: t.nav.how },
    { href: `${base}#dowody`, label: t.nav.proofs },
    { href: `${base}/profile`, label: t.nav.profile },
  ];

  return (
    <header className="ground-navy relative">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-2 gap-y-2 px-gutter py-4 min-[400px]:gap-x-4 lg:py-6">
        <Link
          href={base}
          className="link-plain font-display text-[1.25rem] font-bold tracking-[-0.03em] text-paper min-[400px]:text-[1.5rem]"
        >
          CharOnChain
        </Link>

        <nav aria-label={t.a11y.mainNav} className="hidden items-center gap-8 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="link-plain inline-flex min-h-11 items-center font-display text-small font-semibold text-paper"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 lg:gap-4">
          <Suspense fallback={null}>
            <LocaleSwitch
              locale={locale}
              label={t.a11y.language}
              names={{ pl: t.a11y.langPl, en: t.a11y.langEn }}
            />
          </Suspense>
          <Link href={`${base}#zbiorki`} className="btn btn-mint hidden lg:inline-flex">
            {t.nav.discover}
          </Link>
          <MobileMenu
            links={links}
            navLabel={t.a11y.mainNav}
            ctaHref={`${base}#zbiorki`}
            ctaLabel={t.nav.discover}
          />
        </div>
      </div>
    </header>
  );
}
