import { progressToNextTier, tierFromRaw, tierInfo, xpFromRaw } from "@charonchain/shared";
import { Meter, UsdcAmount, formatInteger, reveal } from "@charonchain/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BadgeClaim } from "../../../src/components/profile/badge-claim";
import { demoProfile, findCampaign, formatDate, text } from "../../../src/demo/campaigns";
import { format, getDictionary, isLocale, locales } from "../../../src/i18n/index";

export const dynamicParams = false;

export function generateStaticParams(): { locale: string }[] {
  return locales.map((locale) => ({ locale }));
}

/**
 * Panel darczyńcy (UX-08), ekran aplikacji: najpierw odpowiedź na pytanie „gdzie jestem?” (suma, XP, liga,
 * brakująca kwota), potem odznaka (osobny gest) i historia. KPI to typografia, nie kafelki. Dane DEMO.
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  const total = demoProfile.totalRaw;
  const tier = tierFromRaw(total);
  const leagueName = tier === 0 ? "—" : (t.leagues.names[tier] ?? "—");
  const progress = progressToNextTier(total);
  const nextName = progress.next === null ? "" : (t.leagues.names[progress.next.id] ?? "");
  const current = tierInfo(tier);

  return (
    <>
      <section aria-labelledby="profile-title" className="ground-field">
        <div className="mx-auto grid max-w-[1440px] items-start gap-12 px-gutter py-12 grid-cols-1 lg:grid-cols-12 lg:py-16">
          <div className="lg:col-span-7">
            <h1 id="profile-title" {...reveal(0)} className="type-head text-title">
              {t.profile.title}
            </h1>
            <p {...reveal(1)} className="m-0 mt-3 text-body text-ink-soft">
              {t.profile.lead}
            </p>

            <dl className="m-0 mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
              <div {...reveal(2)}>
                <dt className="type-small text-ink-soft">{t.profile.total}</dt>
                <dd className="m-0 type-display text-[clamp(1.75rem,1rem+2.2vw,2.75rem)] tabular normal-case tracking-[-0.03em]">
                  {/* Kwota KPI nie łamie się („550,00 USDC” w jednej linii): kolumna dopasowuje się do niej */}
                  <UsdcAmount raw={total} locale={locale} className="whitespace-nowrap" />
                </dd>
              </div>
              <div {...reveal(3)}>
                <dt className="type-small text-ink-soft">{t.profile.xp}</dt>
                <dd className="m-0 type-display text-[clamp(1.75rem,1rem+2.2vw,2.75rem)] tabular normal-case tracking-[-0.03em]">
                  {formatInteger(xpFromRaw(total), locale)}
                </dd>
              </div>
              <div {...reveal(4)}>
                <dt className="type-small text-ink-soft">{t.profile.league}</dt>
                <dd className="m-0 type-display text-[clamp(1.75rem,1rem+2.2vw,2.75rem)] normal-case tracking-[-0.03em]">
                  {leagueName}
                </dd>
              </div>
            </dl>

            <div {...reveal(5)} className="mt-10 max-w-[640px]">
              <p className="m-0 text-body">
                {progress.next === null
                  ? t.profile.top
                  : `${format(t.profile.next, { name: nextName })} `}
                {progress.next === null ? null : (
                  <strong className="font-display font-bold">
                    <UsdcAmount raw={progress.remainingRaw} locale={locale} />
                  </strong>
                )}
              </p>
              <div className="mt-3">
                <Meter
                  raisedRaw={progress.progressBp}
                  capRaw={10_000n}
                  label={t.profile.progress}
                />
              </div>
              <p className="m-0 mt-2 flex justify-between gap-4 type-small text-ink-soft">
                <span>
                  {leagueName}
                  {current === null ? null : (
                    <>
                      {" · "}
                      <UsdcAmount
                        raw={current.thresholdRaw}
                        locale={locale}
                        minFractionDigits={0}
                      />
                    </>
                  )}
                </span>
                {progress.next === null ? null : (
                  <span>
                    {nextName}
                    {" · "}
                    <UsdcAmount
                      raw={progress.next.thresholdRaw}
                      locale={locale}
                      minFractionDigits={0}
                    />
                  </span>
                )}
              </p>
            </div>
          </div>

          <section aria-labelledby="badge-title" className="ground-navy p-6 md:p-10 lg:col-span-5">
            <h2 id="badge-title" {...reveal(0)} className="type-head text-title">
              {t.profile.badgeHeading}
            </h2>
            <div className="mt-8">
              <BadgeClaim
                leagueName={leagueName}
                labels={{
                  none: t.profile.badgeNone,
                  noneText: t.profile.badgeNoneText,
                  claim: t.profile.claim,
                  claimedTitle: t.profile.claimedTitle,
                  claimedText: t.profile.claimedText,
                  notForSale: t.profile.notForSale,
                }}
              />
            </div>
          </section>
        </div>
      </section>

      <section aria-labelledby="history-title" className="ground-paper">
        <div className="mx-auto max-w-[1440px] px-gutter py-section">
          <h2 id="history-title" {...reveal(0)} className="type-head text-title">
            {t.profile.historyHeading}
          </h2>
          {demoProfile.history.length === 0 ? (
            <p className="mt-6 text-body text-ink-soft">{t.profile.historyEmpty}</p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table data-ui className="w-full min-w-[34rem] border-collapse text-left text-body">
                <caption className="sr-only">{t.profile.historyHeading}</caption>
                <thead>
                  <tr className="text-ink-soft">
                    <th scope="col" className="py-3 pe-4 font-semibold">
                      {t.profile.colDate}
                    </th>
                    <th scope="col" className="py-3 pe-4 font-semibold">
                      {t.profile.colCampaign}
                    </th>
                    <th scope="col" className="py-3 pe-4 text-end font-semibold">
                      {t.profile.colAmount}
                    </th>
                    <th scope="col" className="py-3 ps-4 font-semibold">
                      {t.profile.colStatus}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {demoProfile.history.map((row) => {
                    const campaign = findCampaign(row.slug);
                    return (
                      <tr
                        key={row.id}
                        /* taste-skill-ignore: linia wiersza prawdziwej tabeli */ className="border-t border-field"
                      >
                        <td className="py-4 pe-4 tabular">{formatDate(row.date, locale)}</td>
                        <td className="py-4 pe-4">
                          {campaign === undefined ? (
                            row.slug
                          ) : (
                            <Link href={`/${locale}/campaigns/${campaign.slug}`} className="link">
                              {text(campaign.title, locale)}
                            </Link>
                          )}
                        </td>
                        <td className="py-4 pe-4 text-end font-semibold tabular">
                          <UsdcAmount raw={row.amountRaw} locale={locale} />
                        </td>
                        <td className="py-4 ps-4">{t.profile.confirmed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="privacy-title" className="ground-field">
        <div className="mx-auto max-w-[1440px] px-gutter py-section">
          <h2 id="privacy-title" {...reveal(0)} className="type-head text-title">
            {t.profile.privacyHeading}
          </h2>
          <p {...reveal(1)} className="mt-4 max-w-[56ch] text-body text-ink-soft">
            {t.profile.privacyText}
          </p>
          <dl className="m-0 mt-6 grid max-w-[520px] grid-cols-1 gap-3 text-body">
            <div className="cc-row cc-row--plain">
              <dt>{t.profile.publicProfile}</dt>
              <dd className="m-0 font-semibold">{t.profile.off}</dd>
            </div>
            <div className="cc-row cc-row--plain">
              <dt>{t.profile.leaderboard}</dt>
              <dd className="m-0 font-semibold">{t.profile.off}</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
