import { reveal } from "@charonchain/ui";

import type { Dictionary } from "../../i18n/index";

/**
 * FAQ jako tekst ciągły (nie akordeon): pytanie to otwierająca fraza akapitu, odpowiedź jej dalszy ciąg.
 * Dwie kolumny na szerokim ekranie, jedna na wąskim; akapity się nie rozcinają.
 */
export function Faq({ t }: { readonly t: Dictionary }) {
  return (
    <section id="pytania" aria-labelledby="faq-title" className="ground-paper">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-gutter py-section grid-cols-1 lg:grid-cols-12">
        <h2 id="faq-title" {...reveal(0)} className="type-head text-head lg:col-span-3">
          {t.faq.heading}
        </h2>
        <div className="lg:col-span-8 lg:col-start-5 lg:columns-2 lg:gap-14">
          {t.faq.items.map((item, index) => (
            <p
              key={item.q}
              {...reveal(index + 1)}
              className="m-0 mb-5 break-inside-avoid text-body"
            >
              <strong className="font-display font-semibold">{item.q}</strong> {item.a}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
