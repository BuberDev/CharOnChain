// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {ICampaignRegistry, IImpactRegistry} from "./interfaces/ICharOnChain.sol";
import {
    AlreadyReviewed,
    InvalidHash,
    InvalidReportVersion,
    InvalidReviewDecision,
    ReasonRequired,
    ReportNotFound,
    RolesMustBeSeparate,
    Unauthorized,
    ZeroAddress
} from "./Errors.sol";

/// @title ImpactRegistry
/// @notice Rejestr publicznych raportów wpływu: tylko dopisywanie (INV-09). Kontrakt przechowuje hash
///         SHA-256 kanonicznego JSON (RFC 8785), publiczny URI, wersję i decyzję weryfikatora — nigdy treść,
///         nigdy dane prywatne. „Zweryfikowany” oznacza decyzję wyznaczonego weryfikatora, nie dowód
///         prawdziwości wykonania usługi (docs/02 §2).
/// @dev Role REPORT_PUBLISHER_ROLE i REVIEWER_ROLE nie mogą należeć do jednego adresu (`_grantRole`), a
///      autor raportu nie może go zrecenzować (`reviewReport`). Wersje raportu danej kampanii rosną o 1.
contract ImpactRegistry is IImpactRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant REPORT_PUBLISHER_ROLE = keccak256("REPORT_PUBLISHER_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    uint8 public constant DECISION_UNREVIEWED = 0;
    uint8 public constant DECISION_VERIFIED = 1;
    uint8 public constant DECISION_REJECTED = 2;
    uint8 public constant DECISION_REVOKED = 3;

    ICampaignRegistry public immutable REGISTRY;

    /// @notice Następny identyfikator raportu; pierwszy raport ma ID 1.
    uint64 public nextReportId = 1;
    /// @notice Najwyższa opublikowana wersja raportu danej kampanii (0 = brak).
    mapping(uint64 => uint32) public latestVersion;

    mapping(uint64 => Report) private _reports;

    constructor(address registry_, uint48 adminTransferDelay, address initialAdmin)
        AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin)
    {
        if (registry_ == address(0)) revert ZeroAddress();
        REGISTRY = ICampaignRegistry(registry_);
    }

    /// @inheritdoc IImpactRegistry
    /// @dev Kampania musi istnieć (rewert CampaignNotFound), ale może być zamknięta — raporty końcowe
    ///      powstają po zakończeniu zbiórki. Pierwsza wersja to 1; każda następna dokładnie o 1 wyższa.
    function publishReport(
        uint64 campaignId,
        bytes32 contentSha256,
        string calldata publicUri,
        uint32 version
    ) external onlyRole(REPORT_PUBLISHER_ROLE) returns (uint64 reportId) {
        REGISTRY.getCampaign(campaignId);
        if (contentSha256 == bytes32(0) || bytes(publicUri).length == 0) revert InvalidHash();
        if (version != latestVersion[campaignId] + 1) revert InvalidReportVersion();

        latestVersion[campaignId] = version;
        reportId = nextReportId++;
        _reports[reportId] = Report({
            campaignId: campaignId,
            contentSha256: contentSha256,
            publicUri: publicUri,
            version: version,
            decision: DECISION_UNREVIEWED,
            publisher: msg.sender
        });

        emit ReportPublished(reportId, campaignId, contentSha256, publicUri, version);
    }

    /// @inheritdoc IImpactRegistry
    /// @dev Dozwolone przejścia: UNREVIEWED -> VERIFIED|REJECTED oraz VERIFIED -> REVOKED. REJECTED i REVOKED
    ///      są ostateczne dla danej wersji; korekta to nowa wersja raportu. Historia jest w zdarzeniach.
    function reviewReport(uint64 reportId, uint8 decision, bytes32 reasonHash) external onlyRole(REVIEWER_ROLE) {
        Report storage report = _load(reportId);
        // Autor raportu nie recenzuje własnego raportu (AC-23: rozdzielone role).
        if (msg.sender == report.publisher) revert Unauthorized();
        if (decision < DECISION_VERIFIED || decision > DECISION_REVOKED) revert InvalidReviewDecision();
        if ((decision == DECISION_REJECTED || decision == DECISION_REVOKED) && reasonHash == bytes32(0)) {
            revert ReasonRequired();
        }

        uint8 current = report.decision;
        if (current == DECISION_UNREVIEWED) {
            if (decision == DECISION_REVOKED) revert InvalidReviewDecision(); // nie ma czego odwoływać
        } else if (current == DECISION_VERIFIED) {
            if (decision != DECISION_REVOKED) revert AlreadyReviewed();
        } else {
            revert AlreadyReviewed(); // REJECTED / REVOKED: stan ostateczny
        }

        report.decision = decision;
        emit ReportReviewed(reportId, decision, reasonHash);
    }

    /// @inheritdoc IImpactRegistry
    function getReport(uint64 reportId) external view returns (Report memory) {
        return _load(reportId);
    }

    /// @dev Rozdzielenie ról publisher/reviewer wymuszone przy każdym nadaniu roli (docs/02 §5).
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (role == REPORT_PUBLISHER_ROLE && hasRole(REVIEWER_ROLE, account)) revert RolesMustBeSeparate();
        if (role == REVIEWER_ROLE && hasRole(REPORT_PUBLISHER_ROLE, account)) revert RolesMustBeSeparate();
        return super._grantRole(role, account);
    }

    function _load(uint64 reportId) private view returns (Report storage report) {
        if (reportId == 0 || reportId >= nextReportId) revert ReportNotFound();
        report = _reports[reportId];
    }
}
