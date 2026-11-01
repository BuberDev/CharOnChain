// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {ICampaignRegistry} from "./interfaces/ICharOnChain.sol";
import {
    AlreadyClosed,
    CampaignNotFound,
    InvalidCap,
    InvalidHash,
    InvalidStatusTransition,
    InvalidTimeRange,
    Unauthorized,
    ZeroAddress
} from "./Errors.sol";

/// @title CampaignRegistry
/// @notice Rejestr zaakceptowanych kampanii (docs/02 §2). Beneficjent, limit, okno czasu i `orgHash` są
///         niezmienne po utworzeniu (INV-05): w kontrakcie nie ma funkcji, które mogłyby je zmienić.
///         Brak funkcji przenoszących środki; kontrakt nigdy nie trzyma tokenów.
/// @dev Role: DEFAULT_ADMIN_ROLE (Safe, zmiana z opóźnieniem — AccessControlDefaultAdminRules),
///      REGISTRAR_ROLE (tworzy kampanie), PAUSER_ROLE (guardian: tylko wstrzymanie, bez wznawiania).
///      Status `DRAFT/REJECTED` istnieje wyłącznie w backendzie.
contract CampaignRegistry is ICampaignRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_PAUSED = 2;
    uint8 public constant STATUS_CLOSED = 3;

    /// @notice Następny identyfikator kampanii; pierwsza kampania ma ID 1 (0 oznacza „brak”).
    uint64 public nextCampaignId = 1;

    mapping(uint64 => Campaign) private _campaigns;

    constructor(uint48 adminTransferDelay, address initialAdmin)
        AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin)
    {}

    /// @inheritdoc ICampaignRegistry
    function createCampaign(
        address beneficiary,
        uint128 capRaw,
        uint64 startAt,
        uint64 endAt,
        bytes32 orgHash,
        bytes32 metadataHash
    ) external onlyRole(REGISTRAR_ROLE) returns (uint64 campaignId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (capRaw == 0) revert InvalidCap();
        // Okno [startAt, endAt): niepuste i jeszcze niezakończone w chwili tworzenia.
        if (startAt >= endAt || endAt <= block.timestamp) revert InvalidTimeRange();
        if (orgHash == bytes32(0) || metadataHash == bytes32(0)) revert InvalidHash();

        campaignId = nextCampaignId++;
        _campaigns[campaignId] = Campaign({
            beneficiary: beneficiary,
            capRaw: capRaw,
            startAt: startAt,
            endAt: endAt,
            orgHash: orgHash,
            metadataHash: metadataHash,
            status: STATUS_ACTIVE
        });

        emit CampaignCreated(campaignId, beneficiary, orgHash, capRaw);
    }

    /// @inheritdoc ICampaignRegistry
    /// @dev PAUSER_ROLE albo admin. ACTIVE -> PAUSED.
    function pauseCampaign(uint64 campaignId) external {
        if (!hasRole(PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        Campaign storage campaign = _load(campaignId);
        if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();
        if (campaign.status != STATUS_ACTIVE) revert InvalidStatusTransition();
        _setStatus(campaignId, campaign, STATUS_PAUSED);
    }

    /// @inheritdoc ICampaignRegistry
    /// @dev Tylko admin. PAUSED -> ACTIVE. Guardian nigdy nie może wznowić.
    function resumeCampaign(uint64 campaignId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Campaign storage campaign = _load(campaignId);
        if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();
        if (campaign.status != STATUS_PAUSED) revert InvalidStatusTransition();
        _setStatus(campaignId, campaign, STATUS_ACTIVE);
    }

    /// @inheritdoc ICampaignRegistry
    /// @dev Tylko admin. ACTIVE|PAUSED -> CLOSED; CLOSED jest stanem ostatecznym.
    function closeCampaign(uint64 campaignId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Campaign storage campaign = _load(campaignId);
        if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();
        _setStatus(campaignId, campaign, STATUS_CLOSED);
    }

    /// @inheritdoc ICampaignRegistry
    /// @dev Tylko admin. Wersje opisów są przechowywane poza łańcuchem; zdarzenie niesie stary i nowy hash.
    ///      Decyzja projektowa: zamknięta kampania ma metadane zamrożone (CLOSED = stan ostateczny).
    function updateMetadataHash(uint64 campaignId, bytes32 newHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newHash == bytes32(0)) revert InvalidHash();
        Campaign storage campaign = _load(campaignId);
        if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();
        bytes32 oldHash = campaign.metadataHash;
        campaign.metadataHash = newHash;
        emit CampaignMetadataChanged(campaignId, oldHash, newHash);
    }

    /// @inheritdoc ICampaignRegistry
    function getCampaign(uint64 campaignId) external view returns (Campaign memory) {
        return _load(campaignId);
    }

    function _setStatus(uint64 campaignId, Campaign storage campaign, uint8 newStatus) private {
        uint8 oldStatus = campaign.status;
        campaign.status = newStatus;
        emit CampaignStatusChanged(campaignId, oldStatus, newStatus);
    }

    function _load(uint64 campaignId) private view returns (Campaign storage campaign) {
        if (campaignId == 0 || campaignId >= nextCampaignId) revert CampaignNotFound();
        campaign = _campaigns[campaignId];
    }
}
