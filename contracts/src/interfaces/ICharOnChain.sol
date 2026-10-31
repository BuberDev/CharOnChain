// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Specyfikacja interfejsów dla CharOnChain MVP, NIE wdrożenie.
/// @dev Typy, argumenty i eventy muszą być zachowane lub zmiany wymagają aktualizacji docs.
interface ICampaignRegistry {
    struct Campaign {
        address beneficiary;
        uint128 capRaw;
        uint64 startAt;
        uint64 endAt;
        bytes32 orgHash;
        bytes32 metadataHash;
        uint8 status; // 1=ACTIVE, 2=PAUSED, 3=CLOSED
    }

    event CampaignCreated(
        uint64 indexed campaignId,
        address indexed beneficiary,
        bytes32 indexed orgHash,
        uint128 capRaw
    );
    event CampaignStatusChanged(uint64 indexed campaignId, uint8 oldStatus, uint8 newStatus);
    event CampaignMetadataChanged(uint64 indexed campaignId, bytes32 oldHash, bytes32 newHash);

    function createCampaign(
        address beneficiary,
        uint128 capRaw,
        uint64 startAt,
        uint64 endAt,
        bytes32 orgHash,
        bytes32 metadataHash
    ) external returns (uint64 campaignId);
    function pauseCampaign(uint64 campaignId) external;
    function resumeCampaign(uint64 campaignId) external;
    function closeCampaign(uint64 campaignId) external;
    function updateMetadataHash(uint64 campaignId, bytes32 newHash) external;
    function getCampaign(uint64 campaignId) external view returns (Campaign memory);
}

interface IDonationRouter {
    event DonationReceived(
        uint64 indexed campaignId,
        address indexed donor,
        address indexed beneficiary,
        uint256 amountRaw
    );

    function donate(uint64 campaignId, uint256 amountRaw) external;
    function pause() external;
    function unpause() external;
    function raisedRaw(uint64 campaignId) external view returns (uint256);
    function totalDonatedRaw(address donor) external view returns (uint256);
    function usdc() external view returns (address);
}

interface IReputationSBT {
    event ReputationClaimed(address indexed wallet, uint256 indexed tokenId);
    event ReputationSuspended(address indexed wallet, bytes32 reasonHash);
    event ReputationRestored(address indexed wallet, bytes32 reasonHash);
    function claim() external;
    function burn() external;
    function tierOf(address wallet) external view returns (uint8);
    function locked(uint256 tokenId) external view returns (bool);
    function suspendReputation(address wallet, bytes32 reasonHash) external;
    function restoreReputation(address wallet, bytes32 reasonHash) external;
}

interface IImpactRegistry {
    struct Report {
        uint64 campaignId;
        bytes32 contentSha256;
        string publicUri;
        uint32 version;
        uint8 decision; // 0=UNREVIEWED, 1=VERIFIED, 2=REJECTED, 3=REVOKED
        address publisher;
    }
    event ReportPublished(
        uint64 indexed reportId,
        uint64 indexed campaignId,
        bytes32 contentSha256,
        string publicUri,
        uint32 version
    );
    event ReportReviewed(uint64 indexed reportId, uint8 decision, bytes32 reasonHash);
    function publishReport(
        uint64 campaignId,
        bytes32 contentSha256,
        string calldata publicUri,
        uint32 version
    ) external returns (uint64 reportId);
    function reviewReport(uint64 reportId, uint8 decision, bytes32 reasonHash) external;
    function getReport(uint64 reportId) external view returns (Report memory);
}
