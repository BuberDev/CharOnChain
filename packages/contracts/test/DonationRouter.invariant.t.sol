// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {DonationRouter} from "../src/DonationRouter.sol";

import {ICampaignRegistry} from "../src/interfaces/ICharOnChain.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {MockUSDC} from "./utils/MockUSDC.sol";

/// @notice Handler dla testow invariantowych: wykonuje losowe, ale poprawnie typowane operacje i prowadzi
///         zmienne referencyjne (ghost), z ktorymi porownujemy stan kontraktow.
contract DonationHandler is Test {
    uint256 internal constant USDC = 1_000_000;

    MockUSDC public usdc;
    CampaignRegistry public registry;
    DonationRouter public router;
    address internal registrar;
    address internal guardian;
    address internal admin;
    address internal foundation;

    address[] public donors;
    uint256 public campaignCount;

    struct Terms {
        address beneficiary;
        uint128 capRaw;
        uint64 startAt;
        uint64 endAt;
        bytes32 orgHash;
    }

    mapping(uint64 => Terms) internal _terms;
    mapping(uint64 => uint256) public ghostRaised;
    mapping(address => uint256) public ghostDonor;
    uint256 public ghostTotal;
    uint256 public ghostDonorSpent;
    uint256 public ghostMinted;
    uint256 public illegalAccepted;
    bool public raisedDecreased;

    constructor(
        MockUSDC usdc_,
        CampaignRegistry registry_,
        DonationRouter router_,
        address registrar_,
        address guardian_,
        address admin_,
        address foundation_
    ) {
        usdc = usdc_;
        registry = registry_;
        router = router_;
        registrar = registrar_;
        guardian = guardian_;
        admin = admin_;
        foundation = foundation_;

        for (uint256 i = 0; i < 5; i++) {
            address donor = makeAddr(string.concat("handlerDonor", vm.toString(i)));
            donors.push(donor);
            usdc.mint(donor, 1_000_000 * USDC);
            ghostMinted += 1_000_000 * USDC;
            vm.prank(donor);
            usdc.approve(address(router), type(uint256).max);
        }
        _newCampaign(uint128(100 * USDC), 0, 5 days);
        _newCampaign(uint128(5 * USDC + 500_000), 0, 20 days);
        _newCampaign(uint128(1 * USDC), 1 days, 3 days);
    }

    function donorCount() external view returns (uint256) {
        return donors.length;
    }

    function initialTerms(uint64 id) external view returns (address, uint128, uint64, uint64, bytes32) {
        Terms memory t = _terms[id];
        return (t.beneficiary, t.capRaw, t.startAt, t.endAt, t.orgHash);
    }

    function _newCampaign(uint128 cap, uint64 startDelta, uint64 duration) internal {
        uint64 start = uint64(block.timestamp) + startDelta;
        uint64 end_ = start + duration;
        bytes32 org = keccak256(abi.encode("org", campaignCount));
        vm.prank(registrar);
        uint64 id = registry.createCampaign(foundation, cap, start, end_, org, keccak256("meta"));
        campaignCount = id;
        _terms[id] = Terms(foundation, cap, start, end_, org);
    }

    // ------------------------------------------------------------ akcje fuzzowane

    function donate(uint256 donorSeed, uint256 campaignSeed, uint256 amountSeed) external {
        address donor = donors[donorSeed % donors.length];
        uint64 id = uint64((campaignSeed % campaignCount) + 1);
        ICampaignRegistry.Campaign memory c = registry.getCampaign(id);
        uint256 remaining = uint256(c.capRaw) - router.raisedRaw(id);
        // Mieszanka: poprawne kwoty, dokladne domkniecia, kwoty niepoprawne.
        uint256 mode = amountSeed % 5;
        uint256 amount;
        if (mode == 0) amount = remaining;
        else if (mode == 1) amount = bound(amountSeed, 0, 2 * USDC);
        else if (mode == 2) amount = remaining + 1;
        else amount = bound(amountSeed, 0, remaining == 0 ? 10 * USDC : remaining);

        bool allowedNow = !router.paused() && c.status == 1 && block.timestamp >= c.startAt && block.timestamp < c.endAt
            && amount <= remaining && amount > 0 && (amount >= USDC || amount == remaining);

        uint256 before_ = router.raisedRaw(id);
        vm.prank(donor);
        try router.donate(id, amount) {
            if (!allowedNow) illegalAccepted++; // INV-08: przyjeto wplate, ktorej reguly zabraniaja
            ghostRaised[id] += amount;
            ghostDonor[donor] += amount;
            ghostTotal += amount;
            ghostDonorSpent += amount;
        } catch {}
        if (router.raisedRaw(id) < before_) raisedDecreased = true;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 6 days));
    }

    function pauseRouter() external {
        vm.prank(guardian);
        try router.pause() {} catch {}
    }

    function unpauseRouter() external {
        vm.prank(admin);
        try router.unpause() {} catch {}
    }

    /// 0 = pause (guardian), 1 = resume (admin), 2 = close (admin)
    function changeCampaignStatus(uint256 campaignSeed, uint256 action) external {
        uint64 id = uint64((campaignSeed % campaignCount) + 1);
        action = action % 3;
        if (action == 0) {
            vm.prank(guardian);
            try registry.pauseCampaign(id) {} catch {}
        } else if (action == 1) {
            vm.prank(admin);
            try registry.resumeCampaign(id) {} catch {}
        } else {
            vm.prank(admin);
            try registry.closeCampaign(id) {} catch {}
        }
    }

    function createCampaign(uint256 capSeed, uint256 durationSeed) external {
        if (campaignCount >= 8) return;
        _newCampaign(uint128(bound(capSeed, 1, 500 * USDC)), 0, uint64(bound(durationSeed, 1 hours, 10 days)));
    }
}

/// @notice COC-015 (czesc 1): invarianty INV-01..04, INV-05, INV-08, INV-10 przy losowych sekwencjach wplat,
///         pauz, zmian statusu kampanii i uplywu czasu. Handler prowadzi ghost-variables.
contract DonationRouterInvariantTest is StdInvariant, BaseTest {
    DonationHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new DonationHandler(usdc, registry, router, registrar, guardian, admin, foundation);
        targetContract(address(handler));
        // Fuzzer wywoluje wszystkie funkcje niebedace view/pure handlera (donate, warp, pause, status, create).
    }

    /// INV-01: router nigdy nie trzyma USDC.
    function invariant_Inv01_RouterHoldsNoUsdc() public view {
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    /// INV-03: raised <= cap dla kazdej kampanii; raised zgodne z ghost.
    function invariant_Inv03_RaisedWithinCapAndMatchesGhost() public view {
        uint256 n = handler.campaignCount();
        for (uint256 i = 1; i <= n; i++) {
            uint64 cid = uint64(i);
            ICampaignRegistry.Campaign memory c = registry.getCampaign(cid);
            assertLe(router.raisedRaw(cid), c.capRaw, "raised <= cap");
            assertEq(router.raisedRaw(cid), handler.ghostRaised(cid), "raised == suma udanych wplat");
        }
    }

    /// INV-03 (monotonicznosc): raised nigdy nie maleje.
    function invariant_Inv03_RaisedNeverDecreases() public view {
        assertFalse(handler.raisedDecreased());
    }

    /// INV-02: beneficjent otrzymal dokladnie sume udanych wplat; darczyncy stracili te sama kwote.
    function invariant_Inv02_BalancesMatchSuccessfulDonations() public view {
        assertEq(usdc.balanceOf(foundation), handler.ghostTotal());
        assertEq(handler.ghostDonorSpent(), handler.ghostTotal());
    }

    /// INV-04: totalDonated per darczynca == suma jego udanych wplat; suma po darczyncach == suma raised.
    function invariant_Inv04_DonorTotalsMatchGhost() public view {
        uint256 sum;
        uint256 n = handler.donorCount();
        for (uint256 i = 0; i < n; i++) {
            address donor = handler.donors(i);
            assertEq(router.totalDonatedRaw(donor), handler.ghostDonor(donor));
            sum += router.totalDonatedRaw(donor);
        }
        assertEq(sum, handler.ghostTotal());
    }

    /// INV-05: beneficjent, limit, okno i orgHash niezmienne od utworzenia.
    function invariant_Inv05_CampaignTermsNeverChange() public view {
        uint256 n = handler.campaignCount();
        for (uint256 i = 1; i <= n; i++) {
            ICampaignRegistry.Campaign memory c = registry.getCampaign(uint64(i));
            (address ben, uint128 cap, uint64 start, uint64 end_, bytes32 org) = handler.initialTerms(uint64(i));
            assertEq(c.beneficiary, ben);
            assertEq(c.capRaw, cap);
            assertEq(c.startAt, start);
            assertEq(c.endAt, end_);
            assertEq(c.orgHash, org);
        }
    }

    /// INV-08: zadna wplata nie przeszla w stanie paused/closed, poza oknem czasu ani ponad limit.
    function invariant_Inv08_NoDonationAcceptedWhenNotAllowed() public view {
        assertEq(handler.illegalAccepted(), 0);
    }

    /// INV-10 / brak custody: pauza i zmiany statusu nie ruszyly sald (suma sald == suma wplat).
    function invariant_Inv10_SupplyConservation() public view {
        uint256 holders = usdc.balanceOf(foundation) + usdc.balanceOf(address(router));
        for (uint256 i = 0; i < handler.donorCount(); i++) holders += usdc.balanceOf(handler.donors(i));
        assertEq(holders, handler.ghostMinted());
    }
}
