import { ReceiptRow, ReceiptRows, ReceiptTotal, ShortAddress, UsdcAmount } from "@charonchain/ui";
import Link from "next/link";

import { demoCampaigns, text } from "../../demo/campaigns";
import type { Dictionary, Locale } from "../../i18n/index";

const AMOUNT_RAW = 25_000_000n;

/**
 * Hero „karta przycięta” (kierunek B): pionowa karta-kwit na polu granatu, zygzakowata dolna krawędź.
 * h1 mówi, co się robi; zdanie niżej mówi, czym to jest. Karta pokazuje PRAWDZIWY fragment interfejsu
 * (kwit z danymi demonstracyjnymi) — nie zdjęcie i nie ilustrację. Sygnatura ruchu: pozycje kwitu
 * „drukują się” kolejno, raz (bez autoodtwarzania; przy reduced-motion od razu widoczne).
 */
export function Hero({ locale, t }: { readonly locale: Locale; readonly t: Dictionary }) {
  const campaign = demoCampaigns[0];
  if (campaign === undefined) return null;

  return (
    <section aria-labelledby="hero-title" className="ground-navy">
      <div className="mx-auto max-w-[1440px] px-gutter pb-12 pt-6 md:pb-16 md:pt-10">
        <div
          data-reveal
          className="paper edge-zigzag-bottom mx-auto w-full max-w-[720px] px-6 pb-[calc(3.5rem+14px)] pt-10 md:px-14 md:pt-14"
        >
          <h1 id="hero-title" className="type-display text-display">
            {t.hero.line1}
            <br />
            {t.hero.line2}
          </h1>
          <p className="type-lead mt-6 max-w-[34ch]">{t.hero.lead}</p>

          <div data-ui className="mt-10">
            <p className="type-small text-muted">{t.hero.caption}</p>
            <ReceiptRows print className="mt-3 text-body">
              <ReceiptRow label={t.hero.amount}>
                <UsdcAmount raw={AMOUNT_RAW} locale={locale} />
              </ReceiptRow>
              <ReceiptRow label={t.hero.recipient}>
                <span>{text(campaign.organisation, locale)}</span>
                {", "}
                <ShortAddress address={campaign.safe} label={t.campaign.safeLabel} />
              </ReceiptRow>
              <ReceiptRow label={t.hero.fee}>0%</ReceiptRow>
              <ReceiptRow label={t.hero.networkFee}>{t.hero.networkFeeValue}</ReceiptRow>
              <ReceiptRow label={t.hero.status}>{t.hero.statusValue}</ReceiptRow>
            </ReceiptRows>
            <ReceiptTotal label={t.hero.total}>
              <UsdcAmount raw={AMOUNT_RAW} locale={locale} />
            </ReceiptTotal>
          </div>

          <Link href={`/${locale}#zbiorki`} className="btn btn-ink btn-block mt-8 lg:hidden">
            {t.nav.discover}
          </Link>
        </div>
      </div>
    </section>
  );
}
