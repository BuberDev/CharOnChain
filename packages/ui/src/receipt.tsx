import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

/**
 * Kwit: lista pozycji `etykieta ....... wartość`. Prawdziwy fragment interfejsu produktu
 * (`data-ui`, docs/08): pozycje to dane kwitu, nie dekoracja. Semantyka: `<dl>`.
 */
export function ReceiptRows({
  className,
  children,
  print,
  ...rest
}: HTMLAttributes<HTMLDListElement> & {
  /** Pozycje pojawiają się kolejno (jednorazowo) po odsłonięciu karty nadrzędnej. */
  readonly print?: boolean;
}) {
  return (
    <dl className={cx("cc-rows", print === true && "cc-print", className)} {...rest}>
      {children}
    </dl>
  );
}

export interface ReceiptRowProps {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function ReceiptRow({ label, children, className }: ReceiptRowProps) {
  return (
    <div className={cx("cc-row", className)}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Odwrócona pozycja końcowa: papier na atramencie (wynik kwitu). */
export function ReceiptTotal({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="cc-total">
      <span>{label}</span>
      <span className="tabular">{children}</span>
    </div>
  );
}
