import { reveal } from "@charonchain/ui";

import type { Dictionary } from "../../i18n/index";

/**
 * „Drukowana lista gości”: trzy dowody jako trzy ustalenia na odchylonej kartce przyciętej dolną krawędzią
 * sekcji. Dowody są rozdzielone celowo (CLAUDE.md pkt 12): płatność, organizacja, wpływ.
 */
export function Proofs({ t }: { readonly t: Dictionary }) {
  return (
    <section id="dowody" aria-labelledby="proofs-title" className="ground-field overflow-hidden">
      <div className="mx-auto max-w-[1440px] px-gutter pt-16 md:pt-24">
        <div className="paper mx-auto -mb-16 w-[96%] max-w-[760px] rotate-[-1.2deg] px-6 pb-28 pt-10 text-center md:w-[62%] md:px-14 md:pt-14">
          <h2 id="proofs-title" {...reveal(0)} className="type-head text-head">
            {t.proofs.heading}
          </h2>
          <ul className="m-0 mt-10 flex list-none flex-col gap-8 p-0">
            {t.proofs.items.map((item, index) => (
              <li key={item.name} {...reveal(index + 1)}>
                <p className="type-lead">
                  <strong className="font-display font-bold">{item.name}.</strong> {item.text}
                </p>
              </li>
            ))}
          </ul>
          <p {...reveal(4)} className="mx-auto mt-10 max-w-[36ch] text-body font-semibold">
            {t.proofs.note}
          </p>
        </div>
      </div>
    </section>
  );
}
