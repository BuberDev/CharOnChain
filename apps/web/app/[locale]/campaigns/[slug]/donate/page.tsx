import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CheckoutView,
  isCheckoutState,
} from "../../../../../src/components/campaign/checkout-view";
import { demoCampaigns, findCampaign } from "../../../../../src/demo/campaigns";
import { getDictionary, isLocale, locales } from "../../../../../src/i18n/index";
import { validateAmount } from "../../../../../src/lib/amount";

export const dynamicParams = false;

export function generateStaticParams(): { locale: string; slug: string }[] {
  return locales.flatMap((locale) =>
    demoCampaigns.map((campaign) => ({ locale, slug: campaign.slug })),
  );
}

export default async function DonatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ amount?: string; state?: string }>;
}) {
  const { locale, slug } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  const campaign = findCampaign(slug);
  if (campaign === undefined) notFound();
  const t = getDictionary(locale);

  const remainingRaw =
    campaign.capRaw > campaign.raisedRaw ? campaign.capRaw - campaign.raisedRaw : 0n;
  const amountText = query.amount ?? "25";
  const validation = validateAmount(amountText, remainingRaw);

  // Niepoprawna lub niedozwolona kwota nigdy nie trafia do ekranu autoryzacji (AC-04, AC-35).
  if (validation.state === "error") {
    return (
      <div className="ground-navy">
        <div className="mx-auto max-w-[720px] px-gutter py-section">
          <h1 className="type-display text-[clamp(2.25rem,1.2rem+3.8vw,4.25rem)]">
            {t.checkout.title}
          </h1>
          <p role="alert" className="type-lead mt-6 text-critical-on-navy">
            {t.panel.errors[validation.code] ?? validation.code}
          </p>
          <Link
            href={`/${locale}/campaigns/${campaign.slug}`}
            className="btn btn-mint mt-8 min-h-14"
          >
            {t.checkout.back}
          </Link>
        </div>
      </div>
    );
  }

  const state = isCheckoutState(query.state) ? query.state : "review";
  return (
    <CheckoutView
      locale={locale}
      t={t}
      campaign={campaign}
      amountRaw={validation.raw}
      amountText={amountText}
      state={state}
    />
  );
}
