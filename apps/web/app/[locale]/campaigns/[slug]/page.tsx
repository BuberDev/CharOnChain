import { Meter, ShortAddress, UsdcAmount, progressBasisPoints, reveal } from "@charonchain/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DonationPanel } from "../../../../src/components/campaign/donation-panel";
import { demoCampaigns, findCampaign, formatDate, text } from "../../../../src/demo/campaigns";
import { getDictionary, isLocale, locales } from "../../../../src/i18n/index";

export const dynamicParams = false;

export function generateStaticParams(): { locale: string; slug: string }[] {
  return locales.flatMap((locale) =>
    demoCampaigns.map((campaign) => ({ locale, slug: campaign.slug })),
  );
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const campaign = findCampaign(slug);
  if (campaign === undefined) notFound();
  const t = getDictionary(locale);
  const organisation = text(campaign.organisation, locale);
  const title = text(campaign.title, locale);

  const proofs = [
    {
      key: "payment",
      label: t.campaign.proofLabels.payment,
      status: t.campaign.proofStatus.payment,
    },
    { key: "org", label: t.campaign.proofLabels.org, status: t.campaign.proofStatus.org },
    { key: "impact", label: t.campaign.proofLabels.impact, status: t.campaign.proofStatus.impact },
  ];

  return (
    <div className="ground-navy">
      <div className="mx-auto grid max-w-[1440px] items-start gap-x-16 gap-y-12 px-gutter pb-section pt-8 grid-cols-1 lg:grid-cols-12 lg:pt-12">
        <div className="lg:col-span-7">
          <h1 {...reveal(0)} className="type-display mt-6 text-[clamp(2.25rem,1.2rem+3.4vw,4rem)]">
            {title}
          </h1>
          <p className="m-0 mt-4 text-body text-mist">{organisation}</p>
          <p {...reveal(1)} className="type-lead mt-6 max-w-none text-mist md:max-w-[34ch]">
            {text(campaign.summary, locale)}
          </p>

          <div data-ui {...reveal(2)} className="mt-10 max-w-[520px]">
            <p className="m-0 text-body text-mist">{t.showcase.raised}</p>
            <p className="m-0 type-head text-title tabular normal-case">
              <UsdcAmount raw={campaign.raisedRaw} locale={locale} />
            </p>
            <p className="m-0 mt-1 flex justify-between gap-4 text-body tabular text-mist">
              <span>
                {t.showcase.of}{" "}
                <UsdcAmount raw={campaign.capRaw} locale={locale} minFractionDigits={0} />
              </span>
              <span>
                {Math.floor(progressBasisPoints(campaign.raisedRaw, campaign.capRaw) / 100)}%
              </span>
            </p>
            <div className="mt-4">
              <Meter
                raisedRaw={campaign.raisedRaw}
                capRaw={campaign.capRaw}
                label={t.showcase.progress}
              />
            </div>
            <p className="m-0 mt-3 type-small text-mist">
              {t.showcase.window}: {t.showcase.from} {formatDate(campaign.startAt, locale)}{" "}
              {t.showcase.to} {formatDate(campaign.endAt, locale)}
            </p>
          </div>
        </div>

        <aside
          aria-label={t.panel.heading}
          className="lg:col-span-5 lg:row-span-2 lg:sticky lg:top-6"
        >
          <DonationPanel
            locale={locale}
            t={t}
            slug={campaign.slug}
            organisation={organisation}
            safe={campaign.safe}
            capRaw={campaign.capRaw}
            raisedRaw={campaign.raisedRaw}
          />
        </aside>

        <div className="flex flex-col gap-section lg:col-span-7">
          <section
            data-ui
            aria-labelledby="proofs-h"
            className="paper px-4 py-8 md:px-10"
            {...reveal(0)}
          >
            <h2 id="proofs-h" className="type-head text-title">
              {t.campaign.proofsHeading}
            </h2>
            <ul className="m-0 mt-6 flex list-none flex-col gap-5 p-0 text-body">
              {proofs.map((proof) => (
                <li key={proof.key}>
                  <p className="m-0 font-display font-bold">{proof.label}</p>
                  <p className="m-0 text-ink-soft">{proof.status}</p>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-6 type-small text-ink-soft">{t.proofs.note}</p>
          </section>

          <section aria-labelledby="about-h">
            <h2 id="about-h" {...reveal(0)} className="type-head text-title">
              {t.campaign.about}
            </h2>
            {campaign.description.map((paragraph, index) => (
              <p
                key={paragraph.pl}
                {...reveal(index + 1)}
                className="mt-5 max-w-[60ch] text-body text-paper"
              >
                {text(paragraph, locale)}
              </p>
            ))}
            <p {...reveal(3)} className="m-0 mt-5 type-small text-mist">
              {t.campaign.organisation}: {organisation} · {t.showcase.safe}:{" "}
              <ShortAddress address={campaign.safe} label={t.campaign.safeLabel} />
            </p>
          </section>

          <section
            data-ui
            aria-labelledby="wallet-h"
            className="paper px-4 py-8 md:px-10"
            {...reveal(0)}
          >
            <h2 id="wallet-h" className="type-head text-title">
              {t.campaign.walletHeading}
            </h2>
            <dl className="m-0 mt-5 grid grid-cols-1 gap-3 text-body">
              <div>
                <dt className="text-ink-soft">{t.campaign.walletAddress}</dt>
                <dd className="m-0 break-all font-semibold tabular">{campaign.safe}</dd>
              </div>
              <div className="cc-row cc-row--plain">
                <dt>{t.campaign.walletSigners}</dt>
                <dd className="m-0 text-end font-semibold">{t.campaign.walletSignersValue}</dd>
              </div>
              <div className="cc-row cc-row--plain">
                <dt>{t.campaign.walletNetwork}</dt>
                <dd className="m-0 font-semibold">Arbitrum Sepolia</dd>
              </div>
            </dl>
            <p className="m-0 mt-5 type-small text-ink-soft">{t.campaign.walletNote}</p>
          </section>

          <section
            data-ui
            aria-labelledby="donations-h"
            className="paper px-4 py-8 md:px-10"
            {...reveal(0)}
          >
            <h2 id="donations-h" className="type-head text-title">
              {t.campaign.donationsHeading}
            </h2>
            {campaign.donations.length === 0 ? (
              <p className="m-0 mt-5 text-body text-ink-soft">{t.campaign.donationsEmpty}</p>
            ) : (
              <ul className="m-0 mt-4 flex list-none flex-col p-0 text-body">
                {campaign.donations.map((donation) => (
                  <li key={donation.id} className="cc-row cc-row--plain">
                    <span className="tabular">
                      <ShortAddress address={donation.donor} label={t.campaign.safeLabel} />
                      <span className="text-ink-soft"> · {formatDate(donation.date, locale)}</span>
                      <span className="block type-small text-ink-soft">
                        {t.campaign.donationStatus[donation.status]}
                      </span>
                    </span>
                    <span className="font-semibold">
                      <UsdcAmount raw={donation.amountRaw} locale={locale} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="reports-h">
            <h2 id="reports-h" {...reveal(0)} className="type-head text-title">
              {t.campaign.reportsHeading}
            </h2>
            <p {...reveal(1)} className="mt-5 max-w-[56ch] text-body text-mist">
              {t.campaign.reportsEmpty}
            </p>
          </section>

          <Link
            href={`/${locale}#zbiorki`}
            className="link inline-flex min-h-11 items-center text-body"
          >
            {t.campaign.back}
          </Link>
        </div>
      </div>
    </div>
  );
}
