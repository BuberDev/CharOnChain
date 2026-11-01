"use client";

import { useState } from "react";

/**
 * Odbiór odznaki (SBT): osobny gest, niezależny od darowizny (odznaka nie może blokować płatności).
 * W wersji podglądowej stan jest lokalny. Po odbiorze komunikat jest ogłaszany czytnikom ekranu.
 */
export function BadgeClaim({
  leagueName,
  labels,
}: {
  readonly leagueName: string;
  readonly labels: {
    readonly none: string;
    readonly noneText: string;
    readonly claim: string;
    readonly claimedTitle: string;
    readonly claimedText: string;
    readonly notForSale: string;
  };
}) {
  const [claimed, setClaimed] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-8">
      <div data-ui className="paper edge-notch-sides w-full max-w-[420px] px-10 py-8 text-ink">
        <p className="m-0 type-small text-ink-soft">CharOnChain</p>
        <p className="m-0 mt-3 type-display text-title tabular">{claimed ? leagueName : "—"}</p>
        <p className="perforation m-0 mt-6 pt-4 type-small font-semibold">
          {claimed ? labels.notForSale : labels.none}
        </p>
      </div>

      <div>
        <h3 className="type-head text-title">{claimed ? labels.claimedTitle : labels.none}</h3>
        <p className="mt-4 max-w-[42ch] text-body text-mist">
          {claimed ? labels.claimedText : labels.noneText}
        </p>
        {claimed ? null : (
          <button
            type="button"
            onClick={() => {
              setClaimed(true);
            }}
            className="btn btn-mint mt-6 min-h-14"
          >
            {labels.claim}
          </button>
        )}
        <p role="status" className="sr-only">
          {claimed ? labels.claimedTitle : ""}
        </p>
      </div>
    </div>
  );
}
