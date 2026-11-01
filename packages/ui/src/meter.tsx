/**
 * Pole postępu zbiórki: wypełniony kształt (nie linia). Procent pochodzi z arytmetyki całkowitej
 * (punkty bazowe na `bigint`); liczba zmiennoprzecinkowa służy wyłącznie do szerokości paska CSS.
 */
export function progressBasisPoints(raisedRaw: bigint, capRaw: bigint): number {
  if (capRaw <= 0n) return 0;
  const bp = (raisedRaw * 10_000n) / capRaw;
  return Number(bp > 10_000n ? 10_000n : bp);
}

export function Meter({
  raisedRaw,
  capRaw,
  label,
}: {
  readonly raisedRaw: bigint;
  readonly capRaw: bigint;
  /** Dostępna nazwa, np. „Postęp zbiórki”. */
  readonly label: string;
}) {
  const bp = progressBasisPoints(raisedRaw, capRaw);
  const percent = Math.floor(bp / 100);
  return (
    <div
      className="fill-meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span style={{ inlineSize: `${(bp / 100).toFixed(2)}%` }} />
    </div>
  );
}
