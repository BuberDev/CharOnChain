import type { Dictionary } from "../i18n/index";

/**
 * Stały pasek uczciwości wersji podglądowej (AC-41): dane są demonstracyjne, darowizn nie ma.
 * To komunikat serwisowy, nie dekoracja — pozostaje na każdej stronie do czasu uruchomienia.
 */
export function DemoNotice({ t }: { readonly t: Dictionary }) {
  return (
    <div role="note" className="ground-paper">
      <p className="mx-auto max-w-[1440px] px-gutter py-3 text-small">
        <strong className="font-display font-bold">{t.demo.tag}</strong>
        {"  "}
        {t.demo.notice}
      </p>
    </div>
  );
}
