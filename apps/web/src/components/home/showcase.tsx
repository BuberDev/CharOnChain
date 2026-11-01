"use client";

import { Meter, ShortAddress, UsdcAmount, reveal } from "@charonchain/ui";
import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { demoCampaigns, formatDate, text } from "../../demo/campaigns";
import type { Dictionary, Locale } from "../../i18n/index";

/**
 * Plansza zbiórki: karta z danymi (prawdziwy fragment interfejsu: kwota, postęp, ostatnie wpłaty albo
 * uczciwy stan pusty) po lewej; zakładki, tytuł, opis, fakty i dwa wypełnione pola akcji po prawej.
 * Zakładki to wzorzec tablist (strzałki, Home/End). Zmiana zbiórki odpowiada na działanie użytkownika.
 */
export function Showcase({ locale, t }: { readonly locale: Locale; readonly t: Dictionary }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const campaign = demoCampaigns[active] ?? demoCampaigns[0];
  if (campaign === undefined) return null;

  const focusTab = (index: number): void => {
    const next = (index + demoCampaigns.length) % demoCampaigns.length;
    setActive(next);
    tabs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === "ArrowRight") focusTab(index + 1);
    else if (event.key === "ArrowLeft") focusTab(index - 1);
    else if (event.key === "Home") focusTab(0);
    else if (event.key === "End") focusTab(demoCampaigns.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <section id="zbiorki" aria-labelledby="showcase-title" className="ground-navy">
      <div className="mx-auto max-w-[1440px] px-gutter py-section">
        <h2 id="showcase-title" {...reveal(0)} className="type-head text-head max-w-[16ch]">
          {t.showcase.heading}
        </h2>

        <div className="mt-12 grid items-start gap-10 grid-cols-1 lg:grid-cols-2 lg:gap-16">
          <div
            data-ui
            {...reveal(1)}
            className="paper flex w-full min-w-0 max-w-[640px] flex-col gap-10 p-6 text-ink md:p-10"
          >
            <p className="m-0 type-small text-ink-soft">{text(campaign.organisation, locale)}</p>
            <div>
              <p className="m-0 type-small text-ink-soft">{t.showcase.raised}</p>
              <p className="m-0 type-display text-title tabular normal-case tracking-[-0.03em]">
                <UsdcAmount raw={campaign.raisedRaw} locale={locale} />
              </p>
              <p className="m-0 mt-2 text-body tabular">
                {t.showcase.of}{" "}
                <UsdcAmount raw={campaign.capRaw} locale={locale} minFractionDigits={0} />
              </p>
              <div className="mt-5">
                <Meter
                  raisedRaw={campaign.raisedRaw}
                  capRaw={campaign.capRaw}
                  label={t.showcase.progress}
                />
              </div>
            </div>
            <div>
              <p className="m-0 type-small font-semibold">{t.campaign.donationsHeading}</p>
              {campaign.donations.length === 0 ? (
                <p className="m-0 mt-3 text-body text-ink-soft">{t.campaign.donationsEmpty}</p>
              ) : (
                <ul className="m-0 mt-2 flex list-none flex-col p-0 text-body">
                  {campaign.donations.slice(0, 3).map((donation) => (
                    <li key={donation.id} className="cc-row cc-row--plain">
                      <span className="tabular">
                        <ShortAddress address={donation.donor} label={t.campaign.safeLabel} />
                        <span className="text-ink-soft">
                          {" "}
                          · {formatDate(donation.date, locale)}
                        </span>
                      </span>
                      <span className="font-semibold">
                        <UsdcAmount raw={donation.amountRaw} locale={locale} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <div
              role="tablist"
              aria-label={t.showcase.tablist}
              {...reveal(2)}
              className="flex flex-wrap gap-x-6 gap-y-1"
            >
              {demoCampaigns.map((item, index) => (
                <button
                  key={item.slug}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  id={`${baseId}-tab-${String(index)}`}
                  type="button"
                  role="tab"
                  aria-selected={index === active}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => {
                    setActive(index);
                  }}
                  onKeyDown={(event) => {
                    onKeyDown(event, index);
                  }}
                  className={`min-h-11 cursor-pointer border-0 bg-transparent px-0 py-2 text-left font-display text-body font-semibold ${
                    index === active ? "text-paper" : "text-mist hover:text-paper"
                  }`}
                >
                  {text(item.title, locale)}
                </button>
              ))}
            </div>

            <div
              id={`${baseId}-panel`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${String(active)}`}
              {...reveal(3)}
            >
              <h3 className="type-head text-title">{text(campaign.title, locale)}</h3>
              <p className="type-lead mt-6 max-w-[32ch] text-mist">
                {text(campaign.summary, locale)}
              </p>
              <dl className="m-0 mt-8 grid grid-cols-1 gap-2 text-body">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-mist">{t.showcase.window}:</dt>
                  <dd className="m-0 tabular">
                    {t.showcase.from} {formatDate(campaign.startAt, locale)} {t.showcase.to}{" "}
                    {formatDate(campaign.endAt, locale)}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-mist">{t.showcase.safe}:</dt>
                  <dd className="m-0">
                    <ShortAddress address={campaign.safe} label={t.campaign.safeLabel} />
                  </dd>
                </div>
              </dl>
            </div>

            <div {...reveal(4)} className="grid gap-3 sm:grid-cols-2">
              <Link
                href={`/${locale}/campaigns/${campaign.slug}`}
                className="btn btn-mint min-h-[4.5rem]"
              >
                {t.showcase.open}
              </Link>
              <Link href={`/${locale}#dowody`} className="btn btn-tone min-h-[4.5rem]">
                {t.showcase.verify}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
