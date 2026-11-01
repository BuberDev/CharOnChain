import Link from "next/link";

import type { Dictionary, Locale } from "../i18n/index";

/** Tył kwitu: festony u góry, pożegnanie po lewej, linki po prawej, stopka drukarska na dole. */
export function SiteFooter({ locale, t }: { readonly locale: Locale; readonly t: Dictionary }) {
  const base = `/${locale}`;
  return (
    <footer className="ground-navy px-3 pt-section md:px-6">
      <div className="paper edge-scallop-top mx-auto max-w-[1100px] px-6 pb-8 pt-16 md:px-16">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="type-head text-head">{t.footer.sign}</p>
            <p className="mt-4 max-w-[34ch] text-body">{t.footer.lines}</p>
          </div>
          <nav aria-label={t.a11y.footerNav}>
            <ul className="m-0 flex list-none flex-col p-0 text-body">
              <li>
                <Link href={`${base}#zbiorki`} className="link inline-flex min-h-11 items-center">
                  {t.nav.campaigns}
                </Link>
              </li>
              <li>
                <Link href={`${base}#jak`} className="link inline-flex min-h-11 items-center">
                  {t.nav.how}
                </Link>
              </li>
              <li>
                <Link href={`${base}#pytania`} className="link inline-flex min-h-11 items-center">
                  {t.nav.faq}
                </Link>
              </li>
              <li>
                <Link href={`${base}/profile`} className="link inline-flex min-h-11 items-center">
                  {t.nav.profile}
                </Link>
              </li>
              <li className="inline-flex min-h-11 items-center text-muted">
                {t.footer.terms} ({t.footer.soon})
              </li>
              <li className="inline-flex min-h-11 items-center text-muted">
                {t.footer.privacy} ({t.footer.soon})
              </li>
            </ul>
          </nav>
        </div>
        <p className="mt-12 text-center text-small text-muted">{t.footer.imprint}</p>
      </div>
    </footer>
  );
}
