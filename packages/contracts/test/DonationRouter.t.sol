// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {DonationRouter} from "../src/DonationRouter.sol";
import {
    BelowMinimumDonation,
    CampaignExpired,
    CampaignNotActive,
    CampaignNotFound,
    CampaignNotStarted,
    CapExceeded,
    InvalidTokenDecimals,
    Unauthorized,
    ZeroAddress
} from "../src/Errors.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {MockToken18} from "./utils/MockToken18.sol";
import {ReentrantUSDC} from "./utils/ReentrantUSDC.sol";

/// @notice COC-012: AC-04..07, AC-13 (część on-chain), AC-15, AC-29, INV-01..04, INV-08, INV-10.
contract DonationRouterTest is BaseTest {
    event DonationReceived(uint64 indexed campaignId, address indexed donor, address indexed beneficiary, uint256 amountRaw);

    uint64 internal id;

    function setUp() public override {
        super.setUp();
        id = _createCampaign(uint128(10 * USDC));
        _fund(alice, 100 * USDC);
        _fund(bob, 100 * USDC);
    }

    // ----------------------------------------------------------------------- konstruktor

    function test_constructor_ImmutablesAndNoOwnerTokens() public view {
        assertEq(router.usdc(), address(usdc));
        assertEq(address(router.REGISTRY()), address(registry));
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(router.MIN_DONATION_RAW(), USDC);
    }

    function test_constructor_RejectsZeroAddressesAndWrongDecimals() public {
        vm.expectRevert(ZeroAddress.selector);
        new DonationRouter(address(0), address(registry), ADMIN_DELAY, admin);
        vm.expectRevert(ZeroAddress.selector);
        new DonationRouter(address(usdc), address(0), ADMIN_DELAY, admin);
        // Token 18-decimalny, adres bez kodu i kontrakt bez decimals() są odrzucone.
        MockToken18 wrong = new MockToken18();
        vm.expectRevert(InvalidTokenDecimals.selector);
        new DonationRouter(address(wrong), address(registry), ADMIN_DELAY, admin);
        vm.expectRevert(InvalidTokenDecimals.selector);
        new DonationRouter(makeAddr("eoa"), address(registry), ADMIN_DELAY, admin);
        vm.expectRevert(InvalidTokenDecimals.selector);
        new DonationRouter(address(registry), address(registry), ADMIN_DELAY, admin);
    }

    // ----------------------------------------------------------------------- AC-07: sukces

    function test_donate_Success_AC07_AC29() public {
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 foundationBefore = usdc.balanceOf(foundation);

        vm.expectEmit(true, true, true, true, address(router));
        emit DonationReceived(id, alice, foundation, 4 * USDC);
        _donate(alice, id, 4 * USDC);

        assertEq(usdc.balanceOf(foundation), foundationBefore + 4 * USDC, "beneficjent +kwota (INV-02, AC-29: 0 prowizji)");
        assertEq(usdc.balanceOf(alice), aliceBefore - 4 * USDC, "darczynca -kwota (INV-02)");
        assertEq(usdc.balanceOf(address(router)), 0, "router nie trzyma USDC (INV-01)");
        assertEq(router.raisedRaw(id), 4 * USDC);
        assertEq(router.totalDonatedRaw(alice), 4 * USDC);
        assertEq(router.totalDonatedRaw(bob), 0);
    }

    function test_donate_MultipleDonorsAccumulate() public {
        _donate(alice, id, 3 * USDC);
        _donate(bob, id, 2 * USDC);
        _donate(alice, id, 1 * USDC);
        assertEq(router.raisedRaw(id), 6 * USDC);
        assertEq(router.totalDonatedRaw(alice), 4 * USDC);
        assertEq(router.totalDonatedRaw(bob), 2 * USDC);
    }

    // ----------------------------------------------------------------------- AC-04: limit i końcówka

    function test_donate_Cap_AC04() public {
        _donate(alice, id, 2 * USDC); // zostaje 8
        vm.prank(alice);
        vm.expectRevert(CapExceeded.selector);
        router.donate(id, 9 * USDC);
        // revert: brak zmiany sald i liczników
        assertEq(router.raisedRaw(id), 2 * USDC);
        assertEq(router.totalDonatedRaw(alice), 2 * USDC);

        _donate(alice, id, 8 * USDC); // dokładnie domyka limit
        assertEq(router.raisedRaw(id), 10 * USDC);

        vm.prank(bob);
        vm.expectRevert(CapExceeded.selector); // limit osiągnięty
        router.donate(id, 1 * USDC);
    }

    function test_donate_RemainderBelowMinimum_AC04() public {
        uint64 small = _createCampaign(uint128(USDC + 500_000)); // 1,5 USDC
        _donate(alice, small, USDC); // zostaje 0,5 USDC
        vm.prank(alice);
        vm.expectRevert(BelowMinimumDonation.selector); // 0,4 nie domyka
        router.donate(small, 400_000);
        _donate(alice, small, 500_000); // 0,5 domyka
        assertEq(router.raisedRaw(small), USDC + 500_000);
    }

    function test_donate_BelowMinimumAndZero() public {
        vm.startPrank(alice);
        vm.expectRevert(BelowMinimumDonation.selector);
        router.donate(id, 0);
        vm.expectRevert(BelowMinimumDonation.selector);
        router.donate(id, 999_999);
        router.donate(id, 1_000_000); // dokładnie minimum
        vm.stopPrank();
        assertEq(router.raisedRaw(id), USDC);
    }

    function test_donate_DustAllowedOnlyWhenItClosesCap() public {
        uint64 dust = _createCampaign(1); // limit = 1 raw (< 1 USDC)
        vm.prank(alice);
        router.donate(dust, 1); // amount == remaining
        assertEq(router.raisedRaw(dust), 1);
    }

    // ----------------------------------------------------------------------- AC-05: okno czasu

    function test_donate_TimeWindow_AC05() public {
        uint64 future = _createCampaign(uint128(10 * USDC), T0 + 1 days, T0 + 2 days);
        vm.prank(alice);
        vm.expectRevert(CampaignNotStarted.selector);
        router.donate(future, USDC);

        vm.warp(T0 + 1 days); // startAt włącznie
        _donate(alice, future, USDC);

        vm.warp(T0 + 2 days - 1); // ostatnia sekunda okna
        _donate(alice, future, USDC);

        vm.warp(T0 + 2 days); // endAt wyłącznie: block.timestamp >= endAt
        uint256 raised = router.raisedRaw(future);
        vm.prank(alice);
        vm.expectRevert(CampaignExpired.selector);
        router.donate(future, USDC);
        assertEq(router.raisedRaw(future), raised, "brak zmiany po wygasnieciu");
    }

    // ----------------------------------------------------------------------- AC-06 / AC-15 / INV-08

    function test_donate_PausedAndClosedCampaigns_AC06() public {
        vm.prank(guardian);
        registry.pauseCampaign(id);
        vm.prank(alice);
        vm.expectRevert(CampaignNotActive.selector);
        router.donate(id, USDC);

        vm.prank(admin);
        registry.resumeCampaign(id);
        _donate(alice, id, USDC);

        vm.prank(admin);
        registry.closeCampaign(id);
        vm.prank(alice);
        vm.expectRevert(CampaignNotActive.selector);
        router.donate(id, USDC);
        vm.prank(admin);
        vm.expectRevert(); // CLOSED nie wraca do ACTIVE
        registry.resumeCampaign(id);
    }

    function test_donate_UnknownCampaign() public {
        vm.prank(alice);
        vm.expectRevert(CampaignNotFound.selector);
        router.donate(0, USDC);
        vm.prank(alice);
        vm.expectRevert(CampaignNotFound.selector);
        router.donate(42, USDC);
    }

    function test_pause_AC15_DoesNotTouchBalancesOrCounters_INV10() public {
        _donate(alice, id, 3 * USDC);
        uint256 foundationBalance = usdc.balanceOf(foundation);

        vm.prank(guardian);
        router.pause();
        assertTrue(router.paused());

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.donate(id, USDC);

        assertEq(usdc.balanceOf(foundation), foundationBalance);
        assertEq(router.raisedRaw(id), 3 * USDC);
        assertEq(router.totalDonatedRaw(alice), 3 * USDC);
    }

    function test_pause_GuardianCannotUnpause_OnlyAdmin() public {
        vm.prank(guardian);
        router.pause();

        bytes32 adminRole = router.DEFAULT_ADMIN_ROLE();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, adminRole));
        router.unpause();
        vm.prank(developerEoa);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, developerEoa, adminRole));
        router.unpause();

        vm.prank(admin);
        router.unpause();
        _donate(alice, id, USDC);
    }

    function test_pause_OnlyPauserOrAdmin() public {
        vm.prank(developerEoa);
        vm.expectRevert(Unauthorized.selector);
        router.pause();
        vm.prank(registrar);
        vm.expectRevert(Unauthorized.selector);
        router.pause();
        vm.prank(admin); // admin też może wstrzymać
        router.pause();
        vm.prank(guardian);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.pause();
    }

    // ----------------------------------------------------------------------- tokeny: brak zgody / salda / blacklista

    function test_donate_RevertsWithoutAllowanceOrBalance_NoStateChange() public {
        address carol = makeAddr("carol");
        usdc.mint(carol, 5 * USDC); // brak approve
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, 2 * USDC));
        router.donate(id, 2 * USDC);

        address dave = makeAddr("dave");
        _fund(dave, 1 * USDC);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, dave, 1 * USDC, 2 * USDC));
        router.donate(id, 2 * USDC);

        assertEq(router.raisedRaw(id), 0);
        assertEq(router.totalDonatedRaw(carol), 0);
        assertEq(router.totalDonatedRaw(dave), 0);
    }

    function test_donate_ApproveAloneDoesNotCount_AC08() public {
        address carol = makeAddr("carol");
        usdc.mint(carol, 5 * USDC);
        vm.prank(carol);
        usdc.approve(address(router), 5 * USDC);
        assertEq(router.raisedRaw(id), 0);
        assertEq(router.totalDonatedRaw(carol), 0);
    }

    function test_donate_BlacklistedDonorOrBeneficiary_RevertsWithoutPartialState() public {
        usdc.setBlacklisted(alice, true);
        vm.prank(alice);
        vm.expectRevert(bytes("Blacklisted"));
        router.donate(id, USDC);

        usdc.setBlacklisted(alice, false);
        usdc.setBlacklisted(foundation, true);
        vm.prank(alice);
        vm.expectRevert(bytes("Blacklisted"));
        router.donate(id, USDC);

        assertEq(router.raisedRaw(id), 0, "brak fikcyjnego sukcesu (docs/02 sec. 7)");
        assertEq(router.totalDonatedRaw(alice), 0);
    }

    // ----------------------------------------------------------------------- brak custody i ETH

    function test_Router_RejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 wei}("");
        assertFalse(ok);
        vm.prank(alice);
        (ok,) = address(router).call{value: 1 wei}(abi.encodeCall(DonationRouter.donate, (id, USDC)));
        assertFalse(ok);
        assertEq(address(router).balance, 0);
    }

    function test_TokensSentDirectlyAreNotDonations_NoRescue() public {
        vm.prank(alice);
        usdc.transfer(address(router), 5 * USDC);
        assertEq(router.raisedRaw(id), 0);
        assertEq(router.totalDonatedRaw(alice), 0);
        assertEq(usdc.balanceOf(address(router)), 5 * USDC); // niewypłacalne z założenia: brak funkcji rescue
    }

    // ----------------------------------------------------------------------- reentrancja

    function test_donate_ReentrancyIsBlocked() public {
        ReentrantUSDC token = new ReentrantUSDC();
        DonationRouter attackRouter = new DonationRouter(address(token), address(registry), ADMIN_DELAY, admin);
        token.mint(alice, 100 * USDC);
        vm.prank(alice);
        token.approve(address(attackRouter), type(uint256).max);
        // Podczas transferFrom token woła ponownie donate().
        token.arm(address(attackRouter), abi.encodeCall(DonationRouter.donate, (id, USDC)));

        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attackRouter.donate(id, 2 * USDC);
        assertEq(attackRouter.raisedRaw(id), 0);
    }

    // ----------------------------------------------------------------------- fuzz

    function testFuzz_donate_Valid_INV01_02_03_04(uint256 amountRaw, uint256 cap, address donor) public {
        cap = bound(cap, 1, type(uint128).max);
        vm.assume(donor != address(0) && donor != foundation && donor != address(router) && donor != address(usdc));
        uint64 cid = _createCampaign(uint128(cap));
        // Poprawne kwoty: >= 1 USDC i <= limit, albo dokładnie limit (dust).
        amountRaw = cap < USDC ? cap : bound(amountRaw, USDC, cap);
        _fund(donor, amountRaw);
        uint256 foundationBefore = usdc.balanceOf(foundation);

        _donate(donor, cid, amountRaw);

        assertEq(usdc.balanceOf(foundation), foundationBefore + amountRaw, "INV-02");
        assertEq(usdc.balanceOf(donor), 0, "INV-02");
        assertEq(usdc.balanceOf(address(router)), 0, "INV-01");
        assertEq(router.raisedRaw(cid), amountRaw);
        assertLe(router.raisedRaw(cid), cap, "INV-03");
        assertEq(router.totalDonatedRaw(donor), amountRaw, "INV-04");
    }

    function testFuzz_donate_Invalid_RevertsAndChangesNothing(uint256 amountRaw) public {
        // Limit 10 USDC. Niepoprawne: 0, (0,1 USDC) bez domknięcia, > 10 USDC.
        amountRaw = bound(amountRaw, 0, type(uint256).max);
        bool valid = amountRaw >= USDC && amountRaw <= 10 * USDC;
        vm.assume(!valid);
        _fund(alice, 20 * USDC);
        uint256 balance = usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        router.donate(id, amountRaw);
        assertEq(usdc.balanceOf(alice), balance);
        assertEq(router.raisedRaw(id), 0);
        assertEq(router.totalDonatedRaw(alice), 0);
    }

    function testFuzz_donate_SequenceNeverExceedsCap(uint256 a, uint256 b, uint256 c) public {
        _fund(alice, 1_000_000 * USDC);
        uint256[3] memory attempts = [a, b, c];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(alice);
            try router.donate(id, attempts[i]) {} catch {}
            assertLe(router.raisedRaw(id), 10 * USDC, "INV-03");
        }
    }
}
