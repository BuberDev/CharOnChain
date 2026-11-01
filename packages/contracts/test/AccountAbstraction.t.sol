// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ContractWallet} from "./utils/ContractWallet.sol";
import {BaseTest} from "./utils/BaseTest.sol";

/// @notice docs/02 sec. 9: kontrakty NIE zmieniaja sie z powodu Account Abstraction. Konto ERC-4337 jest
///         `msg.sender`, wiec darczyncą, XP i odznaka naleza do ADRESU KONTA, nigdy do paymastera/bundlera/EntryPoint.
contract AccountAbstractionTest is BaseTest {
    event DonationReceived(uint64 indexed campaignId, address indexed donor, address indexed beneficiary, uint256 amountRaw);

    address internal entryPoint = makeAddr("entryPoint");
    address internal bundler = makeAddr("bundler");
    address internal paymaster = makeAddr("paymaster");
    ContractWallet internal account;
    uint64 internal id;

    function setUp() public override {
        super.setUp();
        id = _createCampaign(uint128(1_000 * USDC));
        account = new ContractWallet(entryPoint); // w ERC-4337 wykonuje EntryPoint
        usdc.mint(address(account), 100 * USDC);
    }

    function _batchApproveDonate(uint256 amountRaw) internal {
        ContractWallet.Call[] memory calls = new ContractWallet.Call[](2);
        calls[0] = ContractWallet.Call(address(usdc), abi.encodeWithSignature("approve(address,uint256)", address(router), amountRaw));
        calls[1] = ContractWallet.Call(address(router), abi.encodeWithSignature("donate(uint64,uint256)", id, amountRaw));
        vm.prank(entryPoint);
        account.executeBatch(calls);
    }

    function test_donate_FromERC4337Account_AttributesToAccount() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit DonationReceived(id, address(account), foundation, 10 * USDC);
        _batchApproveDonate(10 * USDC);

        assertEq(router.totalDonatedRaw(address(account)), 10 * USDC, "konto = darczynca");
        assertEq(router.raisedRaw(id), 10 * USDC);
        assertEq(usdc.balanceOf(foundation), 10 * USDC, "calosc do beneficjenta (AC-47 w warstwie kontraktu)");
        assertEq(usdc.balanceOf(address(account)), 90 * USDC);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_batchApproveDonate_LeavesZeroAllowance() public {
        _batchApproveDonate(25 * USDC);
        assertEq(usdc.allowance(address(account), address(router)), 0, "approve+donate nie zostawia zgody");
    }

    function test_donate_NeverCreditsPaymasterOrBundler() public {
        _batchApproveDonate(10 * USDC);
        assertEq(router.totalDonatedRaw(bundler), 0);
        assertEq(router.totalDonatedRaw(paymaster), 0);
        assertEq(router.totalDonatedRaw(entryPoint), 0);
        assertEq(sbt.tierOf(bundler), 0);
        assertEq(sbt.tierOf(paymaster), 0);
        assertEq(sbt.tierOf(entryPoint), 0);
        assertEq(sbt.tierOf(address(account)), 1);
    }

    function test_donate_ReputationAccruesToAccountNotToOwnerEoa() public {
        address owner = makeAddr("passkeyOwner");
        ContractWallet ownedAccount = new ContractWallet(owner);
        usdc.mint(address(ownedAccount), 5 * USDC);
        ContractWallet.Call[] memory calls = new ContractWallet.Call[](2);
        calls[0] = ContractWallet.Call(address(usdc), abi.encodeWithSignature("approve(address,uint256)", address(router), 5 * USDC));
        calls[1] = ContractWallet.Call(address(router), abi.encodeWithSignature("donate(uint64,uint256)", id, 5 * USDC));
        vm.prank(owner);
        ownedAccount.executeBatch(calls);

        assertEq(router.totalDonatedRaw(address(ownedAccount)), 5 * USDC);
        assertEq(router.totalDonatedRaw(owner), 0, "podpisujacy wlasciciel nie dostaje XP (jedna tozsamosc = jeden portfel)");
    }

    function testFuzz_donate_FromContractAccount_PreservesInvariants(uint256 amountRaw) public {
        amountRaw = bound(amountRaw, USDC, 100 * USDC);
        uint256 beneficiaryBefore = usdc.balanceOf(foundation);
        uint256 accountBefore = usdc.balanceOf(address(account));

        _batchApproveDonate(amountRaw);

        assertEq(usdc.balanceOf(foundation), beneficiaryBefore + amountRaw, "INV-02");
        assertEq(usdc.balanceOf(address(account)), accountBefore - amountRaw, "INV-02");
        assertEq(usdc.balanceOf(address(router)), 0, "INV-01");
        assertEq(router.totalDonatedRaw(address(account)), amountRaw, "INV-04");
        assertEq(usdc.allowance(address(account), address(router)), 0);
    }

    function test_donate_FailedBatchLeavesNoState() public {
        // approve OK, donate wykracza poza limit => caly batch rewertuje (atomowo), zgoda tez znika.
        ContractWallet.Call[] memory calls = new ContractWallet.Call[](2);
        calls[0] = ContractWallet.Call(address(usdc), abi.encodeWithSignature("approve(address,uint256)", address(router), 5_000 * USDC));
        calls[1] = ContractWallet.Call(address(router), abi.encodeWithSignature("donate(uint64,uint256)", id, 5_000 * USDC));
        vm.prank(entryPoint);
        vm.expectRevert();
        account.executeBatch(calls);
        assertEq(usdc.allowance(address(account), address(router)), 0);
        assertEq(router.raisedRaw(id), 0);
    }
}
