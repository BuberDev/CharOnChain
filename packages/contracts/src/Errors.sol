// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Wspólny zestaw błędów SC-1.0 (docs/02 §4) plus kilka doprecyzowań (opisane niżej). Błędy plikowe,
// importowane nazwanie — selektory są takie same we wszystkich kontraktach (łatwe dekodowanie w UI/indexerze).

error Unauthorized();
error ZeroAddress();
error InvalidTimeRange();
error InvalidCap();
error CampaignNotFound();
error CampaignNotActive();
error CampaignNotStarted();
error CampaignExpired();
error CapExceeded();
error BelowMinimumDonation();
error InvalidTokenDecimals();
error AlreadyClosed();
error AlreadyClaimed();
error NotEligible();
error Soulbound();
error InvalidReportVersion();
error AlreadyReviewed();
error InvalidReviewDecision();
error ReputationAlreadySuspended();

// Doprecyzowania poza minimalnym zestawem z docs/02 §4 (zachowują semantykę, dodają czytelność):
/// @dev Zerowy hash organizacji/metadanych/treści raportu albo pusty URI.
error InvalidHash();
/// @dev Przejście statusu kampanii niedozwolone w obecnym stanie (np. resume aktywnej).
error InvalidStatusTransition();
/// @dev Odwołanie zawieszenia reputacji portfela, który nie jest zawieszony.
error ReputationNotSuspended();
/// @dev Raport o podanym ID nie istnieje.
error ReportNotFound();
/// @dev Decyzja REJECTED/REVOKED wymaga niepustego hasha powodu.
error ReasonRequired();
/// @dev Role REPORT_PUBLISHER_ROLE i REVIEWER_ROLE nie mogą należeć do jednego adresu (docs/02 §5).
error RolesMustBeSeparate();
