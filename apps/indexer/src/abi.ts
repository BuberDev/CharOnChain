/** ABI zdarzeń SC-1.0 (lustro `contracts/src/interfaces/ICharOnChain.sol`; zgodność pilnuje test). */
import { parseAbi } from "viem";

export const REGISTRY_EVENTS = parseAbi([
  "event CampaignCreated(uint64 indexed campaignId, address indexed beneficiary, bytes32 indexed orgHash, uint128 capRaw)",
  "event CampaignStatusChanged(uint64 indexed campaignId, uint8 oldStatus, uint8 newStatus)",
  "event CampaignMetadataChanged(uint64 indexed campaignId, bytes32 oldHash, bytes32 newHash)",
]);

export const ROUTER_EVENTS = parseAbi([
  "event DonationReceived(uint64 indexed campaignId, address indexed donor, address indexed beneficiary, uint256 amountRaw)",
]);

export const REPUTATION_EVENTS = parseAbi([
  "event ReputationClaimed(address indexed wallet, uint256 indexed tokenId)",
  "event ReputationSuspended(address indexed wallet, bytes32 reasonHash)",
  "event ReputationRestored(address indexed wallet, bytes32 reasonHash)",
]);

export const IMPACT_EVENTS = parseAbi([
  "event ReportPublished(uint64 indexed reportId, uint64 indexed campaignId, bytes32 contentSha256, string publicUri, uint32 version)",
  "event ReportReviewed(uint64 indexed reportId, uint8 decision, bytes32 reasonHash)",
]);

/**
 * Zdarzenia bezpieczeństwa (OpenZeppelin 5.x): zmiany ról, transfer admina, pauza. Indexer je ZAPISUJE w journalu
 * (do alertów COC-035 i audytu), ale nie projektuje do tabel domenowych.
 */
export const ACCESS_CONTROL_EVENTS = parseAbi([
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
  "event DefaultAdminTransferScheduled(address indexed newAdmin, uint48 acceptSchedule)",
  "event DefaultAdminTransferCanceled()",
  "event DefaultAdminDelayChangeScheduled(uint48 newDelay, uint48 effectSchedule)",
  "event DefaultAdminDelayChangeCanceled()",
]);

export const PAUSABLE_EVENTS = parseAbi([
  "event Paused(address account)",
  "event Unpaused(address account)",
]);

export const SECURITY_EVENT_NAMES: readonly string[] = [
  ...ACCESS_CONTROL_EVENTS,
  ...PAUSABLE_EVENTS,
].map((e) => e.name);

export const ALL_EVENTS = [
  ...REGISTRY_EVENTS,
  ...ROUTER_EVENTS,
  ...REPUTATION_EVENTS,
  ...IMPACT_EVENTS,
] as const;

/** Wszystkie zdarzenia dekodowane z logów (domenowe + bezpieczeństwa). */
export const ALL_WATCHED_EVENTS = [
  ...ALL_EVENTS,
  ...ACCESS_CONTROL_EVENTS,
  ...PAUSABLE_EVENTS,
] as const;

export type ContractKind = "registry" | "router" | "reputation" | "impact";

export const EVENTS_BY_CONTRACT = {
  registry: [...REGISTRY_EVENTS, ...ACCESS_CONTROL_EVENTS],
  // Tylko router jest `Pausable` (rejestr pauzuje pojedyncze kampanie przez CampaignStatusChanged).
  router: [...ROUTER_EVENTS, ...ACCESS_CONTROL_EVENTS, ...PAUSABLE_EVENTS],
  reputation: [...REPUTATION_EVENTS, ...ACCESS_CONTROL_EVENTS],
  impact: [...IMPACT_EVENTS, ...ACCESS_CONTROL_EVENTS],
} as const;
