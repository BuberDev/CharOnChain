// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IImpactRegistry} from "../src/interfaces/ICharOnChain.sol";
import {ImpactRegistry} from "../src/ImpactRegistry.sol";
import {
    AlreadyReviewed,
    CampaignNotFound,
    InvalidHash,
    InvalidReportVersion,
    InvalidReviewDecision,
    ReasonRequired,
    ReportNotFound,
    RolesMustBeSeparate,
    Unauthorized,
    ZeroAddress
} from "../src/Errors.sol";
import {BaseTest} from "./utils/BaseTest.sol";

/// @notice COC-014: AC-22..24, INV-09, test oddzielnych ról i odwołania zatwierdzenia.
contract ImpactRegistryTest is BaseTest {
    event ReportPublished(uint64 indexed reportId, uint64 indexed campaignId, bytes32 contentSha256, string publicUri, uint32 version);
    event ReportReviewed(uint64 indexed reportId, uint8 decision, bytes32 reasonHash);

    bytes32 internal constant SHA1_ = keccak256("report-v1"); // dowolny niezerowy hash; keccak = opcode, nie wywolanie
    bytes32 internal constant SHA2_ = keccak256("report-v2");
    bytes32 internal constant REASON = keccak256("reason");
    string internal constant URI1 = "ipfs://bafy-report-v1";
    string internal constant URI2 = "ipfs://bafy-report-v2";

    uint64 internal campaignId;

    function setUp() public override {
        super.setUp();
        campaignId = _createCampaign(uint128(100 * USDC));
    }

    function _publish(uint32 version, bytes32 sha, string memory uri) internal returns (uint64 reportId) {
        vm.prank(publisher);
        reportId = impact.publishReport(campaignId, sha, uri, version);
    }

    // ----------------------------------------------------------------------- publikacja

    function test_publish_StoresAndEmits() public {
        vm.expectEmit(true, true, false, true, address(impact));
        emit ReportPublished(1, campaignId, SHA1_, URI1, 1);
        uint64 reportId = _publish(1, SHA1_, URI1);

        assertEq(reportId, 1);
        assertEq(impact.nextReportId(), 2);
        assertEq(impact.latestVersion(campaignId), 1);
        IImpactRegistry.Report memory r = impact.getReport(reportId);
        assertEq(r.campaignId, campaignId);
        assertEq(r.contentSha256, SHA1_);
        assertEq(r.publicUri, URI1);
        assertEq(r.version, 1);
        assertEq(r.decision, 0);
        assertEq(r.publisher, publisher);
    }

    function test_publish_OnlyPublisherRole() public {
        bytes32 role = impact.REPORT_PUBLISHER_ROLE();
        address[4] memory outsiders = [developerEoa, reviewer, admin, registrar];
        for (uint256 i = 0; i < outsiders.length; i++) {
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsiders[i], role));
            impact.publishReport(campaignId, SHA1_, URI1, 1);
        }
    }

    function test_publish_VersionMustBeSequentialPerCampaign_AC22() public {
        vm.startPrank(publisher);
        vm.expectRevert(InvalidReportVersion.selector); // zaczyna sie od 1
        impact.publishReport(campaignId, SHA1_, URI1, 0);
        vm.expectRevert(InvalidReportVersion.selector);
        impact.publishReport(campaignId, SHA1_, URI1, 2);
        impact.publishReport(campaignId, SHA1_, URI1, 1);
        vm.expectRevert(InvalidReportVersion.selector); // powtorka wersji
        impact.publishReport(campaignId, SHA2_, URI2, 1);
        vm.expectRevert(InvalidReportVersion.selector); // przeskok
        impact.publishReport(campaignId, SHA2_, URI2, 3);
        impact.publishReport(campaignId, SHA2_, URI2, 2);
        vm.stopPrank();
        assertEq(impact.latestVersion(campaignId), 2);
    }

    function test_publish_VersionsAreIndependentPerCampaign() public {
        uint64 other = _createCampaign(uint128(USDC));
        _publish(1, SHA1_, URI1);
        vm.prank(publisher);
        impact.publishReport(other, SHA2_, URI2, 1);
        assertEq(impact.latestVersion(campaignId), 1);
        assertEq(impact.latestVersion(other), 1);
    }

    function test_publish_Rejections() public {
        vm.startPrank(publisher);
        vm.expectRevert(CampaignNotFound.selector);
        impact.publishReport(99, SHA1_, URI1, 1);
        vm.expectRevert(InvalidHash.selector);
        impact.publishReport(campaignId, bytes32(0), URI1, 1);
        vm.expectRevert(InvalidHash.selector);
        impact.publishReport(campaignId, SHA1_, "", 1);
        vm.stopPrank();
        assertEq(impact.nextReportId(), 1, "nic nie zapisano");
    }

    function test_publish_AllowedAfterCampaignClosed() public {
        vm.prank(admin);
        registry.closeCampaign(campaignId);
        _publish(1, SHA1_, URI1); // raport koncowy po zamknieciu zbiorki
    }

    function test_getReport_UnknownReverts() public {
        vm.expectRevert(ReportNotFound.selector);
        impact.getReport(0);
        vm.expectRevert(ReportNotFound.selector);
        impact.getReport(1);
    }

    // ----------------------------------------------------------------------- recenzja

    function test_review_VerifyThenRevoke_FullHistoryInEvents() public {
        uint64 reportId = _publish(1, SHA1_, URI1);

        vm.expectEmit(true, false, false, true, address(impact));
        emit ReportReviewed(reportId, 1, bytes32(0));
        vm.prank(reviewer);
        impact.reviewReport(reportId, 1, bytes32(0));
        assertEq(impact.getReport(reportId).decision, 1);

        vm.expectEmit(true, false, false, true, address(impact));
        emit ReportReviewed(reportId, 3, REASON);
        vm.prank(reviewer);
        impact.reviewReport(reportId, 3, REASON);
        IImpactRegistry.Report memory r = impact.getReport(reportId);
        assertEq(r.decision, 3);
        // Hash, URI, wersja i autor niezmienne po zmianach statusu (INV-09, AC-22).
        assertEq(r.contentSha256, SHA1_);
        assertEq(r.publicUri, URI1);
        assertEq(r.version, 1);
        assertEq(r.publisher, publisher);
    }

    function test_review_Reject_RequiresReason() public {
        uint64 reportId = _publish(1, SHA1_, URI1);
        vm.startPrank(reviewer);
        vm.expectRevert(ReasonRequired.selector);
        impact.reviewReport(reportId, 2, bytes32(0));
        impact.reviewReport(reportId, 2, REASON);
        vm.stopPrank();
        assertEq(impact.getReport(reportId).decision, 2);
    }

    function test_review_InvalidDecisionsAndTransitions() public {
        uint64 reportId = _publish(1, SHA1_, URI1);
        vm.startPrank(reviewer);
        vm.expectRevert(InvalidReviewDecision.selector); // UNREVIEWED nie jest decyzja
        impact.reviewReport(reportId, 0, REASON);
        vm.expectRevert(InvalidReviewDecision.selector);
        impact.reviewReport(reportId, 4, REASON);
        vm.expectRevert(InvalidReviewDecision.selector); // nie ma czego odwolywac
        impact.reviewReport(reportId, 3, REASON);

        impact.reviewReport(reportId, 1, bytes32(0));
        vm.expectRevert(AlreadyReviewed.selector); // VERIFIED -> VERIFIED
        impact.reviewReport(reportId, 1, bytes32(0));
        vm.expectRevert(AlreadyReviewed.selector); // VERIFIED -> REJECTED (tylko revoke)
        impact.reviewReport(reportId, 2, REASON);
        impact.reviewReport(reportId, 3, REASON);
        vm.expectRevert(AlreadyReviewed.selector); // REVOKED jest ostateczny
        impact.reviewReport(reportId, 1, bytes32(0));
        vm.stopPrank();
    }

    function test_review_RejectedIsFinal_CorrectionIsNewVersion() public {
        uint64 first = _publish(1, SHA1_, URI1);
        vm.prank(reviewer);
        impact.reviewReport(first, 2, REASON);
        vm.prank(reviewer);
        vm.expectRevert(AlreadyReviewed.selector);
        impact.reviewReport(first, 1, bytes32(0));

        uint64 second = _publish(2, SHA2_, URI2); // korekta = nowa wersja, stary hash i URI zostaja
        assertEq(impact.getReport(first).contentSha256, SHA1_);
        assertEq(impact.getReport(second).decision, 0);
        vm.prank(reviewer);
        impact.reviewReport(second, 1, bytes32(0));
    }

    function test_review_OnlyReviewerRole() public {
        uint64 reportId = _publish(1, SHA1_, URI1);
        bytes32 role = impact.REVIEWER_ROLE();
        address[3] memory outsiders = [developerEoa, publisher, admin];
        for (uint256 i = 0; i < outsiders.length; i++) {
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsiders[i], role));
            impact.reviewReport(reportId, 1, bytes32(0));
        }
        vm.prank(reviewer);
        vm.expectRevert(ReportNotFound.selector);
        impact.reviewReport(55, 1, bytes32(0));
    }

    // ----------------------------------------------------------------------- AC-23: rozdzielone role

    function test_roles_PublisherAndReviewerCannotBeSameAddress_AC23() public {
        bytes32 publisherRole = impact.REPORT_PUBLISHER_ROLE();
        bytes32 reviewerRole = impact.REVIEWER_ROLE();
        vm.startPrank(admin);
        vm.expectRevert(RolesMustBeSeparate.selector);
        impact.grantRole(reviewerRole, publisher); // publisher nie moze byc recenzentem
        vm.expectRevert(RolesMustBeSeparate.selector);
        impact.grantRole(publisherRole, reviewer); // i odwrotnie
        // Po odebraniu jednej roli druga mozna nadac.
        impact.revokeRole(publisherRole, publisher);
        impact.grantRole(reviewerRole, publisher);
        vm.stopPrank();
        assertTrue(impact.hasRole(reviewerRole, publisher));
        assertFalse(impact.hasRole(publisherRole, publisher));
    }

    function test_review_PublisherCannotReviewOwnReport_EvenWithBothRolesImpossible() public {
        // Role nie moga sie pokrywac, ale kontrola `msg.sender == publisher` jest drugą warstwą:
        // symulujemy recenzenta, ktory byl wczesniej autorem raportu (publisher zmienil role).
        uint64 reportId = _publish(1, SHA1_, URI1);
        vm.startPrank(admin);
        impact.revokeRole(impact.REPORT_PUBLISHER_ROLE(), publisher);
        impact.grantRole(impact.REVIEWER_ROLE(), publisher);
        vm.stopPrank();
        vm.prank(publisher);
        vm.expectRevert(Unauthorized.selector);
        impact.reviewReport(reportId, 1, bytes32(0)); // autor nie zatwierdza wlasnego raportu
    }

    // ----------------------------------------------------------------------- AC-24: hash SHA-256

    function test_hash_StoredValueIsExactlySha256OfCanonicalBytes_AC24() public {
        // Fixture: kanoniczny JSON (RFC 8785: klucze posortowane, bez spacji). Oczekiwany hash policzony
        // NIEZALEZNIE (Python hashlib) i zapisany jako literal; TS (COC-034) musi dac ten sam wynik.
        bytes memory canonical = bytes('{"campaignId":1,"period":{"from":"2026-11-01","to":"2027-02-28"},"servedMeals":1200}');
        bytes32 expected = 0xaf0fb0d267400419fc5bfc340c1e6b9655f66e9361d46246e8a006f256e8fbd3;
        bytes32 computed = sha256(canonical);
        assertEq(computed, expected, "SHA-256 kanonicznych bajtow");

        uint64 reportId = _publish(1, computed, URI1);
        assertEq(impact.getReport(reportId).contentSha256, expected);

        // Zmiana jednego bajtu daje inny hash (niezgodnosc wykrywalna publicznie).
        bytes memory tampered = bytes('{"campaignId":1,"period":{"from":"2026-11-01","to":"2027-02-28"},"servedMeals":1201}');
        assertTrue(sha256(tampered) != expected);
    }

    // ----------------------------------------------------------------------- konstruktor, ETH

    function test_constructor_ZeroRegistryReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new ImpactRegistry(address(0), ADMIN_DELAY, admin);
    }

    function test_noEtherAccepted() public {
        vm.deal(developerEoa, 1 ether);
        vm.prank(developerEoa);
        (bool ok,) = address(impact).call{value: 1}("");
        assertFalse(ok);
    }

    // ----------------------------------------------------------------------- INV-09 fuzz

    function testFuzz_Inv09_ReportFieldsNeverChangeAfterReviews(uint8 decisions, bytes32 reason) public {
        vm.assume(reason != bytes32(0));
        uint64 reportId = _publish(1, SHA1_, URI1);
        IImpactRegistry.Report memory before_ = impact.getReport(reportId);
        for (uint256 i = 0; i < 6; i++) {
            uint8 d = uint8(bound((uint256(decisions) >> (i * 2)) & 3, 0, 3));
            vm.prank(reviewer);
            try impact.reviewReport(reportId, d, reason) {} catch {}
        }
        IImpactRegistry.Report memory after_ = impact.getReport(reportId);
        assertEq(after_.campaignId, before_.campaignId);
        assertEq(after_.contentSha256, before_.contentSha256);
        assertEq(after_.publicUri, before_.publicUri);
        assertEq(after_.version, before_.version);
        assertEq(after_.publisher, before_.publisher);
    }
}
