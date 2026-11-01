"use client";

import { xpFromRaw } from "@charonchain/shared";
import {
  ReceiptRow,
  ReceiptRows,
  ReceiptTotal,
  ShortAddress,
  UsdcAmount,
  formatUsdcLocale,
} from "@charonchain/ui";
import Link from "next/link";
import { useId, useState } from "react";

import { format, type Dictionary, type Locale } from "../../i18n/index";
import { amountToInput, validateAmount } from "../../lib/amount";

const PRESETS = [5, 10, 25, 100] as const;

export interface DonationPanelProps {
  readonly locale: Locale;
  readonly t: Dictionary;
  readonly slug: string;
  readonly organisation: string;
  readonly safe: string;
  readonly capRaw: bigint;
  readonly raisedRaw: bigint;
}

/**
 * „Wystaw kwit”: element żywy kierunku B. Zmiana kwoty od razu zmienia kwit (kwota, odbiorca, prowizja,
 * opłata, pozostały limit, XP). Walidacja korzysta z tych samych funkcji co backend (`@charonchain/shared`),
 * czyli z reguł kontraktu: minimum 1 USDC z wyjątkiem końcówki celu, limit twardy, bez zaokrągleń.
 */
export function DonationPanel(props: DonationPanelProps) {
  const { locale, t, slug, organisation, safe, capRaw, raisedRaw } = props;
  const remainingRaw = capRaw > raisedRaw ? capRaw - raisedRaw : 0n;
  const defaultText = remainingRaw >= 25_000_000n ? "25" : amountToInput(remainingRaw);
  const [text, setText] = useState(defaultText);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  const result = validateAmount(text, remainingRaw);
  const valid = result.state === "ok";
  const amountRaw = valid ? result.raw : 0n;
  const afterRaw = valid ? remainingRaw - amountRaw : remainingRaw;

  return (
    <div className="paper edge-zigzag-bottom w-full px-4 pb-[calc(2rem+14px)] pt-8 md:px-8">
      <h2 className="type-head text-title">{t.panel.heading}</h2>

      <fieldset className="m-0 mt-6 border-0 p-0">
        <legend className="type-small font-semibold">{t.panel.amountLegend}</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t.panel.presets}>
          {PRESETS.map((preset) => {
            const presetRaw = BigInt(preset) * 1_000_000n;
            const fits = presetRaw <= remainingRaw;
            const selected = text === String(preset);
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                aria-disabled={!fits}
                onClick={() => {
                  if (fits) setText(String(preset));
                }}
                className={`btn min-w-16 ${
                  selected ? "btn-ink" : fits ? "btn-tone" : "btn-tone opacity-60"
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>

        <label htmlFor={fieldId} className="mt-5 block type-small font-semibold">
          {t.panel.custom}
        </label>
        <input
          id={fieldId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          aria-invalid={!valid}
          aria-describedby={`${hintId}${valid ? "" : ` ${errorId}`}`}
          className="mt-1 block min-h-12 w-full border-2 border-ink-soft bg-field px-4 font-display text-lead font-semibold tabular text-ink"
        />
        <p id={hintId} className="m-0 mt-2 type-small text-ink-soft">
          {t.panel.customHint} {t.panel.remaining}:{" "}
          <UsdcAmount raw={remainingRaw} locale={locale} />.
        </p>
        <div id={errorId} role="alert" className="min-h-6">
          {result.state === "error" ? (
            <p className="m-0 mt-2 text-body font-semibold text-critical">
              {t.panel.errors[result.code] ?? result.code}
              {result.suggestRaw !== null ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => {
                      setText(amountToInput(result.suggestRaw ?? 0n));
                    }}
                    className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-critical underline underline-offset-4"
                  >
                    {format(t.panel.suggest, {
                      amount: formatUsdcLocale(result.suggestRaw, locale),
                    })}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </fieldset>

      <div data-ui className="mt-6">
        <ReceiptRows className="text-body">
          <ReceiptRow label={t.panel.amount}>
            {valid ? <UsdcAmount raw={amountRaw} locale={locale} /> : "—"}
          </ReceiptRow>
          <ReceiptRow label={t.panel.recipient}>
            <span>{organisation}</span>
            {", "}
            <ShortAddress address={safe} label={t.campaign.safeLabel} />
          </ReceiptRow>
          <ReceiptRow label={t.panel.fee}>0%</ReceiptRow>
          <ReceiptRow label={t.panel.networkFee}>{t.panel.networkFeeValue}</ReceiptRow>
          <ReceiptRow label={t.panel.after}>
            <UsdcAmount raw={afterRaw} locale={locale} />
          </ReceiptRow>
          <ReceiptRow label={t.panel.xp}>
            {valid ? `+${xpFromRaw(amountRaw).toString()}` : "—"}
          </ReceiptRow>
        </ReceiptRows>
        <ReceiptTotal label={t.panel.toOrg}>
          {valid ? <UsdcAmount raw={amountRaw} locale={locale} /> : "—"}
        </ReceiptTotal>
        <p className="m-0 mt-2 type-small text-ink-soft">{t.panel.xpNote}</p>
      </div>

      {valid ? (
        <Link
          href={`/${locale}/campaigns/${slug}/donate?amount=${encodeURIComponent(text.trim().replace(",", "."))}`}
          className="btn btn-ink btn-block mt-6"
        >
          {t.panel.action}
        </Link>
      ) : (
        <button type="button" disabled className="btn btn-ink btn-block mt-6">
          {t.panel.actionDisabled}
        </button>
      )}

      <ul className="m-0 mt-6 flex list-none flex-col gap-2 p-0 type-small text-ink-soft">
        <li>
          {format(t.panel.disclosure.transfer, {
            amount: valid ? formatUsdcLocale(amountRaw, locale) : "—",
            org: organisation,
            address: `${safe.slice(0, 6)}…${safe.slice(-4)}`,
          })}
        </li>
        <li>{t.panel.disclosure.fee}</li>
        <li>{t.panel.disclosure.irreversible}</li>
        <li>{t.panel.disclosure.outside}</li>
        <li>{t.panel.disclosure.scope}</li>
      </ul>
    </div>
  );
}
