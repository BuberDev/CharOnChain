// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {ReputationSBT} from "../src/ReputationSBT.sol";
import {
    AlreadyClaimed,
    InvalidHash,
    NotEligible,
    ReputationAlreadySuspended,
    ReputationNotSuspended,
    Soulbound,
    ZeroAddress
} from "../src/Errors.sol";
import {BaseTest} from "./utils/BaseTest.sol";
import {ContractWallet} from "./utils/ContractWallet.sol";

/// @notice COC-013: AC-16..21, AC-28, INV-04 (tier), INV-06 + testy negatywne zgód.
contract ReputationSBTTest is BaseTest {
    event ReputationClaimed(address indexed wallet, uint256 indexed tokenId);
    event ReputationSuspended(address indexed wallet, bytes32 reasonHash);
    event ReputationRestored(address indexed wallet, bytes32 reasonHash);
    event Locked(uint256 tokenId);

    uint64 internal id;
    bytes32 internal constant REASON = keccak256("abuse-case-17");

    function setUp() public override {
        super.setUp();
        id = _createCampaign(type(uint128).max);
    }

    function _donateAmount(address donor, uint256 amountRaw) internal {
        _fund(donor, amountRaw);
        _donate(donor, id, amountRaw);
    }

    function _tokenId(address wallet) internal pure returns (uint256) {
        return uint256(uint160(wallet));
    }

    // ----------------------------------------------------------------------- AC-16: progi lig

    function test_tierOf_Thresholds_AC16() public {
        uint256[12] memory totalsUsdc = [uint256(0), 1, 99, 100, 999, 1000, 9999, 10000, 24999, 25000, 99999, 100000];
        uint8[12] memory expected = [uint8(0), 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
        for (uint256 i = 0; i < totalsUsdc.length; i++) {
            address donor = makeAddr(string.concat("donor", vm.toString(i)));
            if (totalsUsdc[i] > 0) _donateAmount(donor, totalsUsdc[i] * USDC);
            assertEq(sbt.tierOf(donor), expected[i], string.concat("tier @ ", vm.toString(totalsUsdc[i]), " USDC"));
        }
    }

    function test_tierOf_BelowOneUsdcIsZero() public {
        uint64 dust = _createCampaign(500_000);
        _fund(alice, USDC);
        _donate(alice, dust, 500_000); // 0,5 USDC domyka limit
        assertEq(router.totalDonatedRaw(alice), 500_000);
        assertEq(sbt.tierOf(alice), 0);
    }

    function testFuzz_tierOf_MonotonicAndMatchesThresholds(uint256 totalRaw) public {
        totalRaw = bound(totalRaw, 0, 200_000 * USDC);
        address donor = makeAddr("fuzzDonor");
        if (totalRaw >= USDC) _donateAmount(donor, totalRaw); // dust < 1 USDC nie przechodzi przez router
        uint8 tier = sbt.tierOf(donor);
        uint8 expected;
        if (totalRaw >= 100_000 * USDC) expected = 6;
        else if (totalRaw >= 25_000 * USDC) expected = 5;
        else if (totalRaw >= 10_000 * USDC) expected = 4;
        else if (totalRaw >= 1_000 * USDC) expected = 3;
        else if (totalRaw >= 100 * USDC) expected = 2;
        else if (totalRaw >= USDC) expected = 1;
        assertEq(tier, expected);
    }

    // ----------------------------------------------------------------------- AC-17: claim

    function test_claim_Success_AC17() public {
        _donateAmount(alice, 1 * USDC);

        vm.expectEmit(true, true, false, true, address(sbt));
        emit ReputationClaimed(alice, _tokenId(alice));
        vm.expectEmit(false, false, false, true, address(sbt));
        emit Locked(_tokenId(alice));
        vm.prank(alice);
        sbt.claim();

        assertEq(sbt.ownerOf(_tokenId(alice)), alice);
        assertEq(sbt.balanceOf(alice), 1);
        assertTrue(sbt.locked(_tokenId(alice)));
        assertEq(_tokenId(alice), uint256(uint160(alice)), "tokenId = adres portfela");
    }

    function test_claim_RequiresOneUsdc_AndIsOptIn() public {
        vm.prank(alice);
        vm.expectRevert(NotEligible.selector); // brak darowizn
        sbt.claim();

        uint64 dust = _createCampaign(500_000);
        _fund(alice, USDC);
        _donate(alice, dust, 500_000);
        vm.prank(alice);
        vm.expectRevert(NotEligible.selector); // 0,5 USDC < 1 USDC
        sbt.claim();

        _donateAmount(bob, 5 * USDC);
        // Nikt poza portfelem nie może odebrać za niego (claim używa msg.sender).
        vm.prank(alice);
        vm.expectRevert(NotEligible.selector);
        sbt.claim();
        assertEq(sbt.balanceOf(bob), 0, "bez opt-in nic nie jest mintowane");
    }

    function test_claim_OnlyOnePerWallet_INV06() public {
        _donateAmount(alice, 10 * USDC);
        vm.startPrank(alice);
        sbt.claim();
        vm.expectRevert(AlreadyClaimed.selector);
        sbt.claim();
        vm.stopPrank();
        assertEq(sbt.balanceOf(alice), 1);
    }

    function test_claim_DoesNotBlockDonation_BadgeIsIndependent() public {
        // Brak SBT nie wpływa na donate; mint nie jest wywoływany przez router (docs/02 §2).
        _donateAmount(alice, 5 * USDC);
        assertEq(sbt.balanceOf(alice), 0);
        assertEq(router.totalDonatedRaw(alice), 5 * USDC);
    }

    // ----------------------------------------------------------------------- AC-18: transfery i zgody zablokowane

    function test_transfersAndApprovalsRevert_AC18_INV06() public {
        _donateAmount(alice, 10 * USDC);
        vm.prank(alice);
        sbt.claim();
        uint256 tokenId = _tokenId(alice);

        vm.startPrank(alice);
        vm.expectRevert(Soulbound.selector);
        sbt.transferFrom(alice, bob, tokenId);
        vm.expectRevert(Soulbound.selector);
        sbt.safeTransferFrom(alice, bob, tokenId);
        vm.expectRevert(Soulbound.selector);
        sbt.safeTransferFrom(alice, bob, tokenId, "data");
        vm.expectRevert(Soulbound.selector);
        sbt.approve(bob, tokenId);
        vm.expectRevert(Soulbound.selector);
        sbt.setApprovalForAll(bob, true);
        vm.stopPrank();

        // Inny adres też nie może niczego przenieść (ani za cudze, ani za nieistniejące tokeny).
        vm.startPrank(bob);
        vm.expectRevert(Soulbound.selector);
        sbt.transferFrom(alice, bob, tokenId);
        vm.expectRevert(Soulbound.selector);
        sbt.transferFrom(bob, alice, _tokenId(bob));
        vm.stopPrank();

        assertEq(sbt.ownerOf(tokenId), alice);
        assertEq(sbt.getApproved(tokenId), address(0));
        assertFalse(sbt.isApprovedForAll(alice, bob));
    }

    // ----------------------------------------------------------------------- AC-19: dynamiczna liga + tokenURI

    function test_dynamicTier_TokenUriFollowsTierWithoutNewToken_AC19() public {
        _donateAmount(alice, 1 * USDC);
        vm.prank(alice);
        sbt.claim();
        uint256 tokenId = _tokenId(alice);
        assertEq(sbt.tierOf(alice), 1);
        assertEq(sbt.tokenURI(tokenId), "ipfs://tier1-supporter");

        _fund(alice, 99 * USDC);
        _donate(alice, id, 99 * USDC); // 100
        assertEq(sbt.tierOf(alice), 2);
        assertEq(sbt.tokenURI(tokenId), "ipfs://tier2-bronze");

        _fund(alice, 900 * USDC);
        _donate(alice, id, 900 * USDC); // 1000
        assertEq(sbt.tierOf(alice), 3);
        assertEq(sbt.tokenURI(tokenId), "ipfs://tier3-silver");

        _fund(alice, 9_000 * USDC);
        _donate(alice, id, 9_000 * USDC); // 10000
        assertEq(sbt.tokenURI(tokenId), "ipfs://tier4-gold");
        _fund(alice, 15_000 * USDC);
        _donate(alice, id, 15_000 * USDC); // 25000
        assertEq(sbt.tokenURI(tokenId), "ipfs://tier5-platinum");
        _fund(alice, 75_000 * USDC);
        _donate(alice, id, 75_000 * USDC); // 100000
        assertEq(sbt.tokenURI(tokenId), "ipfs://tier6-diamond");

        assertEq(sbt.balanceOf(alice), 1, "ten sam token, bez nowego mintu");
    }

    // ----------------------------------------------------------------------- AC-20: burn

    function test_burn_KeepsHistoryAndAllowsReclaim_AC20() public {
        _donateAmount(alice, 10 * USDC);
        vm.startPrank(alice);
        sbt.claim();
        sbt.burn();
        vm.stopPrank();

        assertEq(sbt.balanceOf(alice), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, _tokenId(alice)));
        sbt.ownerOf(_tokenId(alice));
        assertEq(router.totalDonatedRaw(alice), 10 * USDC, "historia i XP bez zmian");
        assertEq(sbt.tierOf(alice), 1);

        vm.prank(alice);
        sbt.claim(); // ponowny claim możliwy
        assertEq(sbt.balanceOf(alice), 1);
    }

    function test_burn_OnlyOwner_NothingToBurnForOthers() public {
        _donateAmount(alice, 10 * USDC);
        vm.prank(alice);
        sbt.claim();

        vm.prank(bob); // bob nie ma tokenu (id = adres bob), cudzego nie spali
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, _tokenId(bob)));
        sbt.burn();
        assertEq(sbt.balanceOf(alice), 1);

        vm.prank(alice);
        sbt.burn();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, _tokenId(alice)));
        sbt.burn(); // podwójny burn
    }

    // ----------------------------------------------------------------------- AC-21: zawieszenie

    function test_suspend_TierZero_EventWithReason_FundsUnchanged_AC21() public {
        _donateAmount(alice, 150 * USDC);
        vm.prank(alice);
        sbt.claim();
        assertEq(sbt.tierOf(alice), 2);
        uint256 donated = router.totalDonatedRaw(alice);
        uint256 balance = usdc.balanceOf(foundation);

        vm.expectEmit(true, false, false, true, address(sbt));
        emit ReputationSuspended(alice, REASON);
        vm.prank(governor);
        sbt.suspendReputation(alice, REASON);

        assertEq(sbt.tierOf(alice), 0);
        assertTrue(sbt.isSuspended(alice));
        assertEq(sbt.tokenURI(_tokenId(alice)), "ipfs://suspended");
        assertEq(router.totalDonatedRaw(alice), donated, "wplaty bez zmian");
        assertEq(usdc.balanceOf(foundation), balance, "USDC bez zmian");
        assertEq(sbt.ownerOf(_tokenId(alice)), alice, "NFT nie jest kasowany");

        vm.expectEmit(true, false, false, true, address(sbt));
        emit ReputationRestored(alice, REASON);
        vm.prank(governor);
        sbt.restoreReputation(alice, REASON);
        assertEq(sbt.tierOf(alice), 2);
        assertEq(sbt.tokenURI(_tokenId(alice)), "ipfs://tier2-bronze");
    }

    function test_suspend_OnlyGovernor_AC30() public {
        bytes32 role = sbt.REPUTATION_GOVERNOR_ROLE();
        vm.prank(developerEoa);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, developerEoa, role));
        sbt.suspendReputation(alice, REASON);
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, role));
        sbt.suspendReputation(alice, REASON);
        vm.prank(developerEoa);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, developerEoa, role));
        sbt.restoreReputation(alice, REASON);
    }

    function test_suspend_Rejections() public {
        vm.startPrank(governor);
        vm.expectRevert(ZeroAddress.selector);
        sbt.suspendReputation(address(0), REASON);
        vm.expectRevert(InvalidHash.selector);
        sbt.suspendReputation(alice, bytes32(0));
        sbt.suspendReputation(alice, REASON);
        vm.expectRevert(ReputationAlreadySuspended.selector);
        sbt.suspendReputation(alice, REASON);
        vm.expectRevert(ReputationNotSuspended.selector);
        sbt.restoreReputation(bob, REASON);
        vm.expectRevert(InvalidHash.selector);
        sbt.restoreReputation(alice, bytes32(0));
        vm.stopPrank();
    }

    function test_suspend_SurvivesBurnAndReclaim_NoEvasion() public {
        _donateAmount(alice, 150 * USDC);
        vm.prank(governor);
        sbt.suspendReputation(alice, REASON);
        vm.startPrank(alice);
        sbt.claim(); // claim nadal możliwy (opt-in), ale tier zostaje 0
        sbt.burn();
        sbt.claim();
        vm.stopPrank();
        assertEq(sbt.tierOf(alice), 0);
    }

    // ----------------------------------------------------------------------- ERC-5192 / ERC-165 / metadane

    function test_interfaces_ERC5192_ERC721_ERC165() public view {
        assertTrue(sbt.supportsInterface(0xb45a3c0e), "ERC-5192");
        assertTrue(sbt.supportsInterface(type(IERC721).interfaceId));
        assertTrue(sbt.supportsInterface(type(IERC721Metadata).interfaceId));
        assertTrue(sbt.supportsInterface(type(IERC165).interfaceId));
        assertTrue(sbt.supportsInterface(type(IAccessControl).interfaceId));
        assertFalse(sbt.supportsInterface(0xffffffff));
        assertEq(bytes4(keccak256("locked(uint256)")), bytes4(0xb45a3c0e));
    }

    function test_locked_AndTokenUri_RevertForNonexistentToken() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 123));
        sbt.locked(123);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 123));
        sbt.tokenURI(123);
    }

    function test_constructor_Validation() public {
        string[6] memory uris = ["a", "b", "c", "d", "e", "f"];
        string[6] memory empty = ["a", "b", "", "d", "e", "f"];
        vm.expectRevert(ZeroAddress.selector);
        new ReputationSBT(address(0), ADMIN_DELAY, admin, uris, "s");
        vm.expectRevert(InvalidHash.selector);
        new ReputationSBT(address(router), ADMIN_DELAY, admin, empty, "s");
        vm.expectRevert(InvalidHash.selector);
        new ReputationSBT(address(router), ADMIN_DELAY, admin, uris, "");
        assertEq(address(sbt.ROUTER()), address(router));
        assertEq(sbt.name(), "CharOnChain Reputation");
    }

    // ----------------------------------------------------------------------- AC-28: tożsamość = portfel

    function test_twoWalletsOfSamePerson_DoNotAggregate_AC28() public {
        address wallet2 = makeAddr("alice-second-wallet");
        _donateAmount(alice, 60 * USDC);
        _donateAmount(wallet2, 60 * USDC);
        assertEq(sbt.tierOf(alice), 1, "60 USDC");
        assertEq(sbt.tierOf(wallet2), 1, "60 USDC; suma 120 nie awansuje do Bronze");
        vm.prank(alice);
        sbt.claim();
        vm.prank(wallet2);
        sbt.claim();
        assertEq(sbt.balanceOf(alice), 1);
        assertEq(sbt.balanceOf(wallet2), 1);
    }

    // ----------------------------------------------------------------------- konta kontraktowe (docs/02 §9)

    function test_claim_FromContractWallet_NoReceiverRequired() public {
        ContractWallet wallet = new ContractWallet(alice);
        _fund(address(wallet), 5 * USDC);
        // approve + donate + claim wykonane przez konto kontraktowe (nie implementuje ERC721Receiver).
        vm.startPrank(alice);
        wallet.execute(address(usdc), abi.encodeWithSignature("approve(address,uint256)", address(router), 5 * USDC));
        wallet.execute(address(router), abi.encodeWithSignature("donate(uint64,uint256)", id, 5 * USDC));
        wallet.execute(address(sbt), abi.encodeWithSignature("claim()"));
        vm.stopPrank();

        assertEq(sbt.ownerOf(_tokenId(address(wallet))), address(wallet));
        assertEq(sbt.balanceOf(alice), 0, "odznaka nalezy do konta, nie do podpisujacego wlasciciela");
        assertEq(sbt.tierOf(address(wallet)), 1);
    }

    function testFuzz_tokenIdRoundTripsToWallet(address wallet) public pure {
        uint256 tokenId = uint256(uint160(wallet));
        assertEq(address(uint160(tokenId)), wallet);
    }
}
