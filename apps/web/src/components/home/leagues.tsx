import { TIERS } from "@charonchain/shared";
import { UsdcAmount, formatInteger, reveal } from "@charonchain/ui";

import { format, type Dictionary, type Locale } from "../../i18n/index";

/**
 * „Arkusz menu”: ligi jako wydrukowana karta z festonami u góry i u dołu, przesunięta do prawej połowy;
 * po lewej nagłówek i objaśnienie. Nazwa ligi + próg (cyfry tabelaryczne). Progi pochodzą z
 * `@charonchain/shared` — jedno źródło prawdy z PRD.
 */
export function Leagues({ locale, t }: { readonly locale: Locale; readonly t: Dictionary }) {
  return (
    <section aria-labelledby="leagues-title" className="ground-navy">
      <div className="mx-auto grid max-w-[1440px] items-start gap-12 px-gutter py-section grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="leagues-title" {...reveal(0)} className="type-head text-head">
            {t.leagues.heading}
          </h2>
          <p {...reveal(1)} className="type-lead mt-6 max-w-[30ch]">
            {t.leagues.note}
          </p>
          <p {...reveal(2)} className="mt-8 max-w-[38ch] text-body text-mist">
            {t.leagues.rule}
          </p>
        </div>

        <div className="paper edge-scallop-both w-full max-w-[560px] px-6 pb-16 pt-20 md:px-12 lg:col-span-6 lg:col-start-7">
          <ul data-ui className="m-0 flex list-none flex-col gap-5 p-0">
            {TIERS.map((tier, index) => (
              <li key={tier.id} {...reveal(index + 2)}>
                <div className="flex items-baseline justify-between gap-4 text-body">
                  <span className="font-display font-bold">{t.leagues.names[tier.id]}</span>
                  <span className="font-semibold">
                    {t.leagues.threshold}{" "}
                    <UsdcAmount raw={tier.thresholdRaw} locale={locale} minFractionDigits={0} />
                  </span>
                </div>
                <p className="m-0 text-small text-ink-soft">
                  {format(t.leagues.xpFrom, { xp: formatInteger(tier.minXp, locale) })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
