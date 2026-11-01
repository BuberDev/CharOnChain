// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {ICampaignRegistry} from "../src/interfaces/ICharOnChain.sol";
import {
    AlreadyClosed,
    CampaignNotFound,
    InvalidCap,
    InvalidHash,
    InvalidStatusTransition,
    InvalidTimeRange,
    Unauthorized,
    ZeroAddress
} from "../src/Errors.sol";
import {BaseTest} from "./utils/BaseTest.sol";

/// @notice COC-011: AC-01..06 (część rejestru), AC-30, INV-05/08 (źródło statusu).
contract CampaignRegistryTest is BaseTest {
    event CampaignCreated(uint64 indexed campaignId, address indexed beneficiary, bytes32 indexed orgHash, uint128 capRaw);
    event CampaignStatusChanged(uint64 indexed campaignId, uint8 oldStatus, uint8 newStatus);
    event CampaignMetadataChanged(uint64 indexed campaignId, bytes32 oldHash, bytes32 newHash);

    // ----------------------------------------------------------------------- createCampaign

    function test_create_StoresTermsAndEmits() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit CampaignCreated(1, foundation, ORG_HASH, 1_000 * uint128(USDC));
        uint64 id = _createCampaign(uint128(1_000 * USDC));

        assertEq(id, 1);
        assertEq(registry.nextCampaignId(), 2);
        ICampaignRegistry.Campaign memory c = registry.getCampaign(id);
        assertEq(c.beneficiary, foundation);
        assertEq(c.capRaw, 1_000 * USDC);
        assertEq(c.startAt, T0 - 1);
        assertEq(c.endAt, T0 + 30 days);
        assertEq(c.orgHash, ORG_HASH);
        assertEq(c.metadataHash, META_HASH);
        assertEq(c.status, 1);
    }

    function test_create_IdsAreSequentialFromOne() public {
        assertEq(_createCampaign(uint128(USDC)), 1);
        assertEq(_createCampaign(uint128(USDC)), 2);
        assertEq(_createCampaign(uint128(USDC)), 3);
    }

    function test_create_RevertsForZeroBeneficiary() public {
        vm.prank(registrar);
        vm.expectRevert(ZeroAddress.selector);
        registry.createCampaign(address(0), 1, T0, T0 + 1 days, ORG_HASH, META_HASH);
    }

    function test_create_RevertsForZeroCap() public {
        vm.prank(registrar);
        vm.expectRevert(InvalidCap.selector);
        registry.createCampaign(foundation, 0, T0, T0 + 1 days, ORG_HASH, META_HASH);
    }

    function test_create_RevertsForInvalidTimeRange() public {
        vm.startPrank(registrar);
        vm.expectRevert(InvalidTimeRange.selector); // start == end
        registry.createCampaign(foundation, 1, T0 + 5, T0 + 5, ORG_HASH, META_HASH);
        vm.expectRevert(InvalidTimeRange.selector); // start > end
        registry.createCampaign(foundation, 1, T0 + 6, T0 + 5, ORG_HASH, META_HASH);
        vm.expectRevert(InvalidTimeRange.selector); // już zakończona
        registry.createCampaign(foundation, 1, T0 - 10, T0, ORG_HASH, META_HASH);
        vm.stopPrank();
    }

    function test_create_RevertsForZeroHashes() public {
        vm.startPrank(registrar);
        vm.expectRevert(InvalidHash.selector);
        registry.createCampaign(foundation, 1, T0, T0 + 1 days, bytes32(0), META_HASH);
        vm.expectRevert(InvalidHash.selector);
        registry.createCampaign(foundation, 1, T0, T0 + 1 days, ORG_HASH, bytes32(0));
        vm.stopPrank();
    }

    function test_create_OnlyRegistrar_AC30() public {
        bytes32 role = registry.REGISTRAR_ROLE();
        // EOA dewelopera: brak uprawnień (AC-30).
        vm.prank(developerEoa);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, developerEoa, role));
        registry.createCampaign(foundation, 1, T0, T0 + 1 days, ORG_HASH, META_HASH);
        // Admin też nie tworzy kampanii bez nadania sobie roli (z jawnym eventem RoleGranted, docs/02 §5 „*”).
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, role));
        registry.createCampaign(foundation, 1, T0, T0 + 1 days, ORG_HASH, META_HASH);
        // Guardian również nie.
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, role));
        registry.createCampaign(foundation, 1, T0, T0 + 1 days, ORG_HASH, META_HASH);
    }

    function testFuzz_create_ValidInputsRoundTrip(uint128 cap, uint32 startDelta, uint32 duration, bytes32 org, bytes32 meta, address ben) public {
        vm.assume(cap > 0 && duration > 0 && ben != address(0) && org != bytes32(0) && meta != bytes32(0));
        uint64 start = T0 + startDelta;
        uint64 end = start + duration;
        vm.prank(registrar);
        uint64 id = registry.createCampaign(ben, cap, start, end, org, meta);
        ICampaignRegistry.Campaign memory c = registry.getCampaign(id);
        assertEq(c.beneficiary, ben);
        assertEq(c.capRaw, cap);
        assertEq(c.startAt, start);
        assertEq(c.endAt, end);
        assertEq(c.orgHash, org);
        assertEq(c.metadataHash, meta);
        assertEq(c.status, 1);
    }

    // ----------------------------------------------------------------------- getCampaign

    function test_get_RevertsForUnknownIds() public {
        vm.expectRevert(CampaignNotFound.selector);
        registry.getCampaign(0);
        vm.expectRevert(CampaignNotFound.selector);
        registry.getCampaign(1);
        _createCampaign(1);
        registry.getCampaign(1);
        vm.expectRevert(CampaignNotFound.selector);
        registry.getCampaign(2);
        vm.expectRevert(CampaignNotFound.selector);
        registry.getCampaign(type(uint64).max);
    }

    // ----------------------------------------------------------------------- status

    function test_pause_ByGuardianAndByAdmin() public {
        uint64 a = _createCampaign(uint128(USDC));
        uint64 b = _createCampaign(uint128(USDC));

        vm.expectEmit(true, false, false, true, address(registry));
        emit CampaignStatusChanged(a, 1, 2);
        vm.prank(guardian);
        registry.pauseCampaign(a);
        assertEq(registry.getCampaign(a).status, 2);

        vm.prank(admin);
        registry.pauseCampaign(b);
        assertEq(registry.getCampaign(b).status, 2);
    }

    function test_pause_RejectedForOutsiders() public {
        uint64 id = _createCampaign(uint128(USDC));
        vm.prank(developerEoa);
        vm.expectRevert(Unauthorized.selector);
        registry.pauseCampaign(id);
        vm.prank(registrar); // registrar nie jest pauserem
        vm.expectRevert(Unauthorized.selector);
        registry.pauseCampaign(id);
    }

    function test_pause_InvalidStates() public {
        uint64 id = _createCampaign(uint128(USDC));
        vm.startPrank(guardian);
        registry.pauseCampaign(id);
        vm.expectRevert(InvalidStatusTransition.selector); // już PAUSED
        registry.pauseCampaign(id);
        vm.stopPrank();

        vm.prank(admin);
        registry.closeCampaign(id);
        vm.prank(guardian);
        vm.expectRevert(AlreadyClosed.selector);
        registry.pauseCampaign(id);

        vm.prank(guardian);
        vm.expectRevert(CampaignNotFound.selector);
        registry.pauseCampaign(99);
    }

    function test_resume_OnlyAdmin_GuardianCannot() public {
        uint64 id = _createCampaign(uint128(USDC));
        vm.prank(guardian);
        registry.pauseCampaign(id);

        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, adminRole));
        registry.resumeCampaign(id);

        vm.expectEmit(true, false, false, true, address(registry));
        emit CampaignStatusChanged(id, 2, 1);
        vm.prank(admin);
        registry.resumeCampaign(id);
        assertEq(registry.getCampaign(id).status, 1);
    }

    function test_resume_InvalidStates() public {
        uint64 id = _createCampaign(uint128(USDC));
        vm.startPrank(admin);
        vm.expectRevert(InvalidStatusTransition.selector); // ACTIVE nie jest wstrzymana
        registry.resumeCampaign(id);
        registry.closeCampaign(id);
        vm.expectRevert(AlreadyClosed.selector); // CLOSED nie wraca do ACTIVE (AC-06)
        registry.resumeCampaign(id);
        vm.stopPrank();
    }

    function test_close_FromActiveAndPaused_OnlyAdmin() public {
        uint64 a = _createCampaign(uint128(USDC));
        uint64 b = _createCampaign(uint128(USDC));
        vm.prank(guardian);
        registry.pauseCampaign(b);

        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, adminRole));
        registry.closeCampaign(a);
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, adminRole));
        registry.closeCampaign(a);

        vm.startPrank(admin);
        vm.expectEmit(true, false, false, true, address(registry));
        emit CampaignStatusChanged(a, 1, 3);
        registry.closeCampaign(a);
        registry.closeCampaign(b);
        vm.expectRevert(AlreadyClosed.selector); // stan ostateczny
        registry.closeCampaign(a);
        vm.stopPrank();
        assertEq(registry.getCampaign(a).status, 3);
        assertEq(registry.getCampaign(b).status, 3);
    }

    // ----------------------------------------------------------------------- metadataHash

    function test_updateMetadata_EmitsOldAndNew_OnlyAdmin() public {
        uint64 id = _createCampaign(uint128(USDC));
        bytes32 newHash = keccak256("meta:v2");

        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, adminRole));
        registry.updateMetadataHash(id, newHash);

        vm.expectEmit(true, false, false, true, address(registry));
        emit CampaignMetadataChanged(id, META_HASH, newHash);
        vm.prank(admin);
        registry.updateMetadataHash(id, newHash);
        assertEq(registry.getCampaign(id).metadataHash, newHash);
    }

    function test_updateMetadata_Rejections() public {
        uint64 id = _createCampaign(uint128(USDC));
        vm.startPrank(admin);
        vm.expectRevert(InvalidHash.selector);
        registry.updateMetadataHash(id, bytes32(0));
        vm.expectRevert(CampaignNotFound.selector);
        registry.updateMetadataHash(77, keccak256("x"));
        registry.closeCampaign(id);
        vm.expectRevert(AlreadyClosed.selector); // zamknięta: metadane zamrożone (decyzja projektowa)
        registry.updateMetadataHash(id, keccak256("x"));
        vm.stopPrank();
    }

    // ----------------------------------------------------------------------- INV-05: niezmienność warunków

    function testFuzz_Inv05_ImmutableTermsSurviveAllAdminActions(uint8 ops) public {
        uint64 id = _createCampaign(uint128(500 * USDC));
        ICampaignRegistry.Campaign memory before_ = registry.getCampaign(id);

        for (uint256 i = 0; i < 8; i++) {
            uint256 op = (uint256(ops) >> i) & 1;
            // Każda dozwolona operacja admina/guardiana; błędy przejść są pomijane (try/catch).
            if (op == 0) {
                vm.prank(guardian);
                try registry.pauseCampaign(id) {} catch {}
            } else {
                vm.prank(admin);
                try registry.resumeCampaign(id) {} catch {}
            }
            vm.prank(admin);
            try registry.updateMetadataHash(id, keccak256(abi.encode(i, ops))) {} catch {}
        }
        vm.prank(admin);
        registry.closeCampaign(id);

        ICampaignRegistry.Campaign memory after_ = registry.getCampaign(id);
        assertEq(after_.beneficiary, before_.beneficiary);
        assertEq(after_.capRaw, before_.capRaw);
        assertEq(after_.startAt, before_.startAt);
        assertEq(after_.endAt, before_.endAt);
        assertEq(after_.orgHash, before_.orgHash);
        assertEq(after_.status, 3);
    }

    // ----------------------------------------------------------------------- admin: zmiana z opóźnieniem

    function test_adminTransfer_RequiresDelay_NoInstantTakeover() public {
        vm.prank(admin);
        registry.beginDefaultAdminTransfer(developerEoa);

        vm.prank(developerEoa);
        vm.expectRevert(); // za wcześnie: opóźnienie nie minęło
        registry.acceptDefaultAdminTransfer();
        assertEq(registry.defaultAdmin(), admin);

        skip(ADMIN_DELAY + 1);
        vm.prank(developerEoa);
        registry.acceptDefaultAdminTransfer();
        assertEq(registry.defaultAdmin(), developerEoa);
    }

    function test_noEtherAccepted() public {
        vm.deal(developerEoa, 1 ether);
        vm.prank(developerEoa);
        (bool ok,) = address(registry).call{value: 1}("");
        assertFalse(ok);
    }
}
