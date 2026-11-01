import { reveal } from "@charonchain/ui";
import Link from "next/link";

import type { Dictionary, Locale } from "../../i18n/index";

/** „Karta odpowiedzi”: wezwanie do działania jako kartka odchylona o dwa stopnie na polu granatu. */
export function Cta({ locale, t }: { readonly locale: Locale; readonly t: Dictionary }) {
  return (
    <section aria-labelledby="cta-title" className="ground-navy overflow-hidden">
      <div className="mx-auto grid max-w-[1440px] items-end gap-12 px-gutter pt-section grid-cols-1 lg:grid-cols-12">
        <p {...reveal(0)} className="type-lead max-w-[30ch] pb-0 lg:col-span-4 lg:pb-16">
          {t.cta.side}
        </p>
        <div
          {...reveal(1)}
          className="paper -mb-10 mx-auto w-full max-w-[560px] rotate-[1.4deg] px-6 pb-20 pt-10 text-center lg:col-span-6 lg:col-start-7 md:px-12 md:pt-12"
        >
          <h2 id="cta-title" className="type-head text-title">
            {t.cta.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-[30ch] text-body">{t.cta.text}</p>
          <Link href={`/${locale}#zbiorki`} className="btn btn-ink btn-block mt-8">
            {t.cta.action}
          </Link>
        </div>
      </div>
    </section>
  );
}
