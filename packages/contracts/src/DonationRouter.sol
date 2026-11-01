// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICampaignRegistry, IDonationRouter} from "./interfaces/ICharOnChain.sol";
import {
    BelowMinimumDonation,
    CampaignExpired,
    CampaignNotActive,
    CampaignNotStarted,
    CapExceeded,
    InvalidTokenDecimals,
    Unauthorized,
    ZeroAddress
} from "./Errors.sol";

/// @title DonationRouter
/// @notice Przekazuje USDC bezpośrednio od darczyńcy do beneficjenta kampanii i liczy sumy. Nie ma
///         portfela escrow, nie trzyma tokenów, nie pobiera prowizji i nie ma funkcji wypłaty/ratunku
///         (docs/02 §2, §7; CLAUDE.md pkt 5). Adres USDC jest ustawiany raz, w konstruktorze.
/// @dev `donate` używa `msg.sender`, więc konto kontraktowe (ERC-4337) jest darczyńcą (docs/02 §9);
///      paymaster i bundler nigdy nie są kredytowani. Router nie ma `receive`/`fallback`: ETH jest odrzucany.
contract DonationRouter is IDonationRouter, AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Minimalna darowizna: 1 USDC (6 miejsc). Wyjątek: dokładne domknięcie reszty limitu.
    uint256 public constant MIN_DONATION_RAW = 1_000_000;
    uint8 public constant USDC_DECIMALS = 6;

    IERC20 private immutable _USDC;
    ICampaignRegistry public immutable REGISTRY;

    /// @inheritdoc IDonationRouter
    mapping(uint64 => uint256) public raisedRaw;
    /// @inheritdoc IDonationRouter
    mapping(address => uint256) public totalDonatedRaw;

    constructor(address usdc_, address registry_, uint48 adminTransferDelay, address initialAdmin)
        AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin)
    {
        if (usdc_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        // Tylko token 6-decimalny (natywny USDC); każdy inny (np. 18-decimalny) jest odrzucany przy wdrożeniu.
        // Adres bez kodu sprawdzamy jawnie: wywołanie `decimals()` na nim rewertuje poza try/catch.
        if (usdc_.code.length == 0) revert InvalidTokenDecimals();
        try IERC20Metadata(usdc_).decimals() returns (uint8 tokenDecimals) {
            if (tokenDecimals != USDC_DECIMALS) revert InvalidTokenDecimals();
        } catch {
            revert InvalidTokenDecimals();
        }
        _USDC = IERC20(usdc_);
        REGISTRY = ICampaignRegistry(registry_);
    }

    /// @inheritdoc IDonationRouter
    function usdc() external view returns (address) {
        return address(_USDC);
    }

    /// @inheritdoc IDonationRouter
    /// @dev Kolejność: sprawdzenia -> zapis stanu -> transfer (checks-effects-interactions) + `nonReentrant`.
    ///      Każdy revert cofa cały stan; nie ma częściowych wpłat.
    function donate(uint64 campaignId, uint256 amountRaw) external nonReentrant whenNotPaused {
        ICampaignRegistry.Campaign memory campaign = REGISTRY.getCampaign(campaignId); // reverts: CampaignNotFound
        if (campaign.status != 1) revert CampaignNotActive(); // PAUSED albo CLOSED
        if (block.timestamp < campaign.startAt) revert CampaignNotStarted();
        if (block.timestamp >= campaign.endAt) revert CampaignExpired();

        uint256 raised = raisedRaw[campaignId];
        // raised <= capRaw jest niezmiennikiem (INV-03), więc odejmowanie nie może się przepełnić.
        uint256 remaining = uint256(campaign.capRaw) - raised;

        if (amountRaw == 0) revert BelowMinimumDonation();
        if (amountRaw > remaining) revert CapExceeded();
        // 0 < kwota < 1 USDC dozwolona wyłącznie jako dokładne domknięcie limitu (zapobiega zablokowaniu reszty).
        if (amountRaw < MIN_DONATION_RAW && amountRaw != remaining) revert BelowMinimumDonation();

        raisedRaw[campaignId] = raised + amountRaw;
        totalDonatedRaw[msg.sender] += amountRaw;

        _USDC.safeTransferFrom(msg.sender, campaign.beneficiary, amountRaw);

        emit DonationReceived(campaignId, msg.sender, campaign.beneficiary, amountRaw);
    }

    /// @inheritdoc IDonationRouter
    /// @dev PAUSER_ROLE albo admin. Pauza nie zmienia sald ani zakończonych darowizn (INV-10).
    function pause() external {
        if (!hasRole(PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        _pause();
    }

    /// @inheritdoc IDonationRouter
    /// @dev Tylko admin; guardian (PAUSER_ROLE) nigdy nie może odblokować.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
