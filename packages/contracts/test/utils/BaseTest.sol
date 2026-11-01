// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {CampaignRegistry} from "../../src/CampaignRegistry.sol";
import {DonationRouter} from "../../src/DonationRouter.sol";
import {ImpactRegistry} from "../../src/ImpactRegistry.sol";
import {ReputationSBT} from "../../src/ReputationSBT.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice Wspólna baza testów: pełny zestaw kontraktów, osobne adresy ról (odpowiedniki Safe) i pomocniki.
///         Admin, guardian, registrar, governor, publisher i reviewer to RÓŻNE adresy, jak w deployu (docs/02 §5).
abstract contract BaseTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;
    uint256 internal constant USDC = 1_000_000;
    uint64 internal constant T0 = 1_800_000_000;

    address internal admin = makeAddr("adminSafe");
    address internal registrar = makeAddr("registrarSafe");
    address internal guardian = makeAddr("guardian");
    address internal governor = makeAddr("reputationGovernorSafe");
    address internal publisher = makeAddr("reportPublisherSafe");
    address internal reviewer = makeAddr("reviewerSafe");
    address internal developerEoa = makeAddr("developerEoa");
    address internal foundation = makeAddr("foundationSafe");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockUSDC internal usdc;
    CampaignRegistry internal registry;
    DonationRouter internal router;
    ReputationSBT internal sbt;
    ImpactRegistry internal impact;

    bytes32 internal constant ORG_HASH = keccak256("org:foundation-1");
    bytes32 internal constant META_HASH = keccak256("meta:v1");

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        registry = new CampaignRegistry(ADMIN_DELAY, admin);
        router = new DonationRouter(address(usdc), address(registry), ADMIN_DELAY, admin);

        string[6] memory uris = [
            "ipfs://tier1-supporter",
            "ipfs://tier2-bronze",
            "ipfs://tier3-silver",
            "ipfs://tier4-gold",
            "ipfs://tier5-platinum",
            "ipfs://tier6-diamond"
        ];
        sbt = new ReputationSBT(address(router), ADMIN_DELAY, admin, uris, "ipfs://suspended");
        impact = new ImpactRegistry(address(registry), ADMIN_DELAY, admin);

        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
        registry.grantRole(registry.PAUSER_ROLE(), guardian);
        router.grantRole(router.PAUSER_ROLE(), guardian);
        sbt.grantRole(sbt.REPUTATION_GOVERNOR_ROLE(), governor);
        impact.grantRole(impact.REPORT_PUBLISHER_ROLE(), publisher);
        impact.grantRole(impact.REVIEWER_ROLE(), reviewer);
        vm.stopPrank();
    }

    /// @dev Aktywna kampania od `T0 - 1` do `T0 + 30 days` dla `foundation`.
    function _createCampaign(uint128 capRaw) internal returns (uint64 id) {
        return _createCampaign(capRaw, T0 - 1, T0 + 30 days);
    }

    function _createCampaign(uint128 capRaw, uint64 startAt, uint64 endAt) internal returns (uint64 id) {
        vm.prank(registrar);
        id = registry.createCampaign(foundation, capRaw, startAt, endAt, ORG_HASH, META_HASH);
    }

    function _fund(address donor, uint256 amountRaw) internal {
        usdc.mint(donor, amountRaw);
        vm.prank(donor);
        usdc.approve(address(router), type(uint256).max);
    }

    function _donate(address donor, uint64 campaignId, uint256 amountRaw) internal {
        vm.prank(donor);
        router.donate(campaignId, amountRaw);
    }
}
