import {
  ReceiptRow,
  ReceiptRows,
  ReceiptTotal,
  ShortAddress,
  UsdcAmount,
  formatUsdcLocale,
  reveal,
} from "@charonchain/ui";
import Link from "next/link";

import type { DemoCampaign } from "../../demo/campaigns";
import { text } from "../../demo/campaigns";
import { format, type Dictionary, type Locale } from "../../i18n/index";

export const CHECKOUT_STATES = [
  "review",
  "authorizing",
  "submitted",
  "confirmed",
  "rejected",
  "sponsorship",
  "reverted",
] as const;
export type CheckoutState = (typeof CHECKOUT_STATES)[number];

export function isCheckoutState(value: string | undefined): value is CheckoutState {
  return value !== undefined && (CHECKOUT_STATES as readonly string[]).includes(value);
}

type StepState = "done" | "current" | "failed" | "pending";

/** Stan czterech kroków dla każdego stanu przepływu (docs/11 §7). `OP_INCLUDED` nie jest sukcesem. */
function stepStates(state: CheckoutState): readonly [StepState, StepState, StepState, StepState] {
  switch (state) {
    case "review":
      return ["done", "current", "pending", "pending"];
    case "authorizing":
      return ["done", "current", "pending", "pending"];
    case "submitted":
      return ["done", "done", "current", "pending"];
    case "confirmed":
      return ["done", "done", "done", "done"];
    case "rejected":
    case "sponsorship":
      return ["done", "failed", "pending", "pending"];
    case "reverted":
      return ["done", "done", "failed", "pending"];
  }
}

const FAILURES: readonly CheckoutState[] = ["rejected", "sponsorship", "reverted"];

const DEMO_OP = `0x${"ab".repeat(32)}`;

/**
 * Ekran przeglądu i autoryzacji (UX-22, Beginner): kwit po prawej, stan przepływu po lewej. Każda porażka
 * mówi, że środki są bez zmian, i co zrobić dalej. Sukces dopiero po potwierdzeniu (nigdy po samym wysłaniu).
 * Podgląd stanów jest dostępny wyłącznie w wersji podglądowej (linki), bo prawdziwy przepływ to maszyna stanów.
 */
export function CheckoutView(props: {
  readonly locale: Locale;
  readonly t: Dictionary;
  readonly campaign: DemoCampaign;
  readonly amountRaw: bigint;
  readonly amountText: string;
  readonly state: CheckoutState;
}) {
  const { locale, t, campaign, amountRaw, amountText, state } = props;
  const organisation = text(campaign.organisation, locale);
  const base = `/${locale}/campaigns/${campaign.slug}`;
  const here = (next: CheckoutState): string =>
    `${base}/donate?amount=${encodeURIComponent(amountText)}&state=${next}`;
  const failed = FAILURES.includes(state);
  const confirmed = state === "confirmed";
  const info = t.checkout.status[state];
  const steps = stepStates(state);
  const stepLabels = [
    t.checkout.steps.amount,
    t.checkout.steps.approve,
    t.checkout.steps.network,
    t.checkout.steps.done,
  ];

  return (
    <div className="ground-navy">
      <div className="mx-auto grid max-w-[1440px] items-start gap-x-16 gap-y-12 px-gutter pb-section pt-8 grid-cols-1 lg:grid-cols-12 lg:pt-12">
        <div className="lg:col-span-6">
          <Link href={base} className="link inline-flex min-h-11 items-center text-small">
            {t.checkout.back}
          </Link>
          <h1
            {...reveal(0)}
            className="type-display mt-6 text-[clamp(2.25rem,1.2rem+3.8vw,4.25rem)]"
          >
            {t.checkout.title}
          </h1>
          <p {...reveal(1)} className="type-lead mt-5 max-w-[32ch] text-mist">
            {t.checkout.lead}
          </p>

          <ol
            {...reveal(2)}
            className="m-0 mt-10 grid list-none grid-cols-2 gap-x-6 gap-y-5 p-0 sm:grid-cols-4"
          >
            {steps.map((step, index) => (
              <li
                key={stepLabels[index]}
                aria-current={step === "current" ? "step" : undefined}
                className="text-body"
              >
                <span
                  className={`block font-display font-bold [overflow-wrap:anywhere] ${
                    step === "failed"
                      ? "text-critical-on-navy"
                      : step === "pending"
                        ? "text-mist"
                        : "text-paper"
                  }`}
                >
                  {stepLabels[index]}
                </span>
                <span className="block type-small text-mist">{t.checkout.stepState[step]}</span>
              </li>
            ))}
          </ol>

          <div
            {...reveal(3)}
            role={failed ? "alert" : "status"}
            className="mt-10 bg-navy-2 p-6 md:p-8"
          >
            <h2
              className={`type-head text-title ${
                failed ? "text-critical-on-navy" : confirmed ? "text-success-on-navy" : "text-paper"
              }`}
            >
              {info.title}
            </h2>
            <p className="m-0 mt-4 max-w-[46ch] text-body text-paper">{info.text}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {state === "review" ? (
                <Link href={here("authorizing")} className="btn btn-mint min-h-14">
                  {t.checkout.approve}
                </Link>
              ) : null}
              {failed ? (
                <Link href={here("review")} className="btn btn-mint min-h-14">
                  {t.checkout.retry}
                </Link>
              ) : null}
              {confirmed ? (
                <Link href={`/${locale}/profile`} className="btn btn-mint min-h-14">
                  {t.nav.profile}
                </Link>
              ) : null}
            </div>
          </div>

          <nav aria-label={t.checkout.previewStates} className="mt-10">
            <p className="m-0 type-small text-mist">{t.checkout.previewStates}</p>
            <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-small">
              {CHECKOUT_STATES.map((item) => (
                <li key={item}>
                  <Link
                    href={here(item)}
                    aria-current={item === state ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center ${
                      item === state
                        ? "link font-semibold text-paper"
                        : "link-plain text-mist hover:text-paper"
                    }`}
                  >
                    {t.checkout.stateLinks[item]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="lg:col-span-6">
          <div
            {...reveal(2)}
            className="paper edge-zigzag-bottom w-full px-6 pb-[calc(2rem+14px)] pt-8 md:px-10"
          >
            <p className="m-0 type-small text-ink-soft">{t.hero.caption}</p>
            <div data-ui className="mt-4">
              <ReceiptRows className="text-body">
                <ReceiptRow label={t.panel.amount}>
                  <UsdcAmount raw={amountRaw} locale={locale} />
                </ReceiptRow>
                <ReceiptRow label={t.panel.recipient}>
                  <span>{organisation}</span>
                  {", "}
                  <ShortAddress address={campaign.safe} label={t.campaign.safeLabel} />
                </ReceiptRow>
                <ReceiptRow label={t.panel.fee}>0%</ReceiptRow>
                <ReceiptRow label={t.panel.networkFee}>{t.panel.networkFeeValue}</ReceiptRow>
                <ReceiptRow label={t.hero.status}>
                  {t.checkout.receiptStatus[state] ?? state}
                </ReceiptRow>
              </ReceiptRows>
              <ReceiptTotal label={t.panel.toOrg}>
                <UsdcAmount raw={amountRaw} locale={locale} />
              </ReceiptTotal>
            </div>

            <ul className="m-0 mt-6 flex list-none flex-col gap-2 p-0 type-small text-ink-soft">
              <li>
                {format(t.panel.disclosure.transfer, {
                  amount: formatUsdcLocale(amountRaw, locale),
                  org: organisation,
                  address: `${campaign.safe.slice(0, 6)}…${campaign.safe.slice(-4)}`,
                })}
              </li>
              <li>{t.panel.disclosure.fee}</li>
              <li>{t.panel.disclosure.irreversible}</li>
              <li>{t.panel.disclosure.outside}</li>
              <li>{t.panel.disclosure.scope}</li>
            </ul>

            {confirmed ? (
              <p className="m-0 mt-4 type-small text-ink-soft">{t.checkout.confirmedNote}</p>
            ) : null}

            <details className="mt-6">
              <summary className="min-h-11 cursor-pointer py-2 font-display font-semibold">
                {t.checkout.detailsSummary}
              </summary>
              <dl className="m-0 mt-2 grid grid-cols-1 gap-2 type-small">
                <div>
                  <dt className="text-ink-soft">{t.checkout.detailsNetwork}</dt>
                  <dd className="m-0">Arbitrum Sepolia (421614)</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">{t.checkout.detailsToken}</dt>
                  <dd className="m-0">{t.checkout.detailsTokenValue}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">{t.checkout.detailsSafe}</dt>
                  <dd className="m-0 break-all tabular">{campaign.safe}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">{t.checkout.detailsOp}</dt>
                  <dd className="m-0 break-all tabular">{DEMO_OP}</dd>
                </div>
              </dl>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
