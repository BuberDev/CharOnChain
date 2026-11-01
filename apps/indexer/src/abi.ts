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

export const ALL_EVENTS = [
  ...REGISTRY_EVENTS,
  ...ROUTER_EVENTS,
  ...REPUTATION_EVENTS,
  ...IMPACT_EVENTS,
] as const;

export type ContractKind = "registry" | "router" | "reputation" | "impact";

export const EVENTS_BY_CONTRACT = {
  registry: REGISTRY_EVENTS,
  router: ROUTER_EVENTS,
  reputation: REPUTATION_EVENTS,
  impact: IMPACT_EVENTS,
} as const;
