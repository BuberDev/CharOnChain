#!/usr/bin/env bash
# Komplet zrzutów COC-003A z działającego serwera (QA_BASE_URL, domyślnie http://localhost:3100).
# Uruchom po `pnpm --filter @charonchain/web build && pnpm --filter @charonchain/web exec next start -p 3100`.
set -euo pipefail
cd "$(dirname "$0")/../.."
C=/pl/campaigns/cieple-posilki
OUT=design-evidence/COC-003A
# Pięć szerokości z docs/09 (360/390/768/1280/1440) dla czterech głównych ekranów + 320 (reflow WCAG 1.4.10)
QA_OUT=$OUT/screenshots node tools/visual-qa/capture.mjs home-pl=/pl campaign-pl=$C checkout-review-pl="$C/donate?amount=25" profile-pl=/pl/profile
QA_WIDTHS=320 QA_OUT=$OUT/screenshots node tools/visual-qa/capture.mjs home-pl=/pl campaign-pl=$C checkout-review-pl="$C/donate?amount=25" profile-pl=/pl/profile
# Stany i warianty: telefon (390) i desktop (1440)
QA_WIDTHS=390,1440 QA_OUT=$OUT/screenshots node tools/visual-qa/capture.mjs \
  campaign-edge-pl=/pl/campaigns/szkolne-pracownie campaign-empty-pl=/pl/campaigns/sprzet-ratownikow \
  checkout-authorizing-pl="$C/donate?amount=25&state=authorizing" checkout-submitted-pl="$C/donate?amount=25&state=submitted" \
  checkout-confirmed-pl="$C/donate?amount=25&state=confirmed" checkout-rejected-pl="$C/donate?amount=25&state=rejected" \
  checkout-sponsorship-pl="$C/donate?amount=25&state=sponsorship" checkout-reverted-pl="$C/donate?amount=25&state=reverted" \
  checkout-invalid-pl="$C/donate?amount=0.5" home-en=/en campaign-en=/en/campaigns/cieple-posilki \
  checkout-review-en="/en/campaigns/cieple-posilki/donate?amount=25" profile-en=/en/profile
# prefers-reduced-motion
QA_REDUCED=1 QA_WIDTHS=390,1440 QA_OUT=$OUT/screenshots-reduced-motion node tools/visual-qa/capture.mjs home-pl=/pl
# Stany interaktywne
QA_OUT=$OUT/screenshots-states node tools/visual-qa/states.mjs
