import { ReceiptTotal, reveal } from "@charonchain/ui";

import type { Dictionary } from "../../i18n/index";

function Step({ label, actor }: { readonly label: string; readonly actor: string }) {
  return (
    <li className="cc-row cc-row--plain">
      <span>{label}</span>
      <span className="font-semibold">{actor}</span>
    </li>
  );
}

/**
 * „Itinerarz na kwicie”: proces wydrukowany jako slip z zygzakowatą dolną krawędzią. To prawdziwa
 * kolejność (lista uporządkowana), pogrupowana według tego, kto działa. Wynik w odwróconym wierszu.
 * Po lewej, pod nagłówkiem: tryb zaawansowany (własny portfel) — bez ukrywania, że wtedy płacisz opłatę.
 */
export function How({ t }: { readonly t: Dictionary }) {
  return (
    <section id="jak" aria-labelledby="how-title" className="ground-field">
      <div className="mx-auto grid max-w-[1440px] items-start gap-12 px-gutter py-section grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="how-title" {...reveal(0)} className="type-head text-head max-w-[12ch]">
            {t.how.heading}
          </h2>
          <p {...reveal(1)} className="type-lead mt-6 max-w-[30ch]">
            {t.how.lead}
          </p>
          <p {...reveal(2)} className="mt-10 max-w-[38ch] text-body text-ink-soft">
            {t.how.advanced}
          </p>
        </div>

        <div
          data-ui
          {...reveal(2)}
          className="paper edge-zigzag-bottom w-full max-w-[560px] px-6 pb-[calc(2rem+14px)] pt-8 md:px-8 lg:col-span-6 lg:col-start-7"
        >
          <ol className="m-0 list-none p-0 text-body">
            <li>
              <p className="m-0 font-display font-bold">{t.how.yoursTitle}</p>
              <ul className="m-0 mt-2 list-none p-0">
                <Step label={t.how.steps.amount} actor={t.how.actors.you} />
                <Step label={t.how.steps.authorize} actor={t.how.actors.you} />
              </ul>
            </li>
            <li className="mt-7">
              <p className="m-0 font-display font-bold">{t.how.networkTitle}</p>
              <ul className="m-0 mt-2 list-none p-0">
                <Step label={t.how.steps.fee} actor={t.how.actors.platform} />
                <Step label={t.how.steps.transfer} actor={t.how.actors.network} />
              </ul>
            </li>
          </ol>
          <ReceiptTotal label={t.how.resultLabel}>{t.how.resultValue}</ReceiptTotal>
        </div>
      </div>
    </section>
  );
}
