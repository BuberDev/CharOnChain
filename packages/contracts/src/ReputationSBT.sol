// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import {IDonationRouter, IReputationSBT} from "./interfaces/ICharOnChain.sol";
import {
    AlreadyClaimed,
    InvalidHash,
    NotEligible,
    ReputationAlreadySuspended,
    ReputationNotSuspended,
    Soulbound,
    ZeroAddress
} from "./Errors.sol";

/// @title ReputationSBT
/// @notice Niezbywalna odznaka (ERC-721 + ERC-5192), jedna na portfel; `tokenId = uint256(uint160(wallet))`.
///         Poziom (liga) jest liczony dynamicznie z `DonationRouter.totalDonatedRaw` — nie ma mintowania
///         nowych tokenów przy awansie. Mint jest dobrowolny (`claim`) i nigdy nie blokuje płatności.
/// @dev `claim` używa `_mint` (nie `_safeMint`), aby konta kontraktowe (ERC-4337) bez ERC721Receiver mogły
///      odebrać odznakę (docs/02 §2, §9). Transfery i zgody są zablokowane (INV-06).
contract ReputationSBT is IReputationSBT, ERC721, AccessControlDefaultAdminRules {
    bytes32 public constant REPUTATION_GOVERNOR_ROLE = keccak256("REPUTATION_GOVERNOR_ROLE");

    /// @dev ERC-5192: `bytes4(keccak256("locked(uint256)"))`.
    bytes4 public constant ERC5192_INTERFACE_ID = 0xb45a3c0e;

    /// @notice EIP-5192: emitowane przy mincie (token jest od razu zablokowany).
    event Locked(uint256 tokenId);

    uint256 private constant USDC_UNIT = 1_000_000;

    IDonationRouter public immutable ROUTER;

    mapping(address => bool) private _suspended;

    // URI-e są ustawiane wyłącznie w konstruktorze (przypięte podczas deploy), bez settera.
    string[6] private _tierUris;
    string private _suspendedUri;

    constructor(
        address router_,
        uint48 adminTransferDelay,
        address initialAdmin,
        string[6] memory tierUris_,
        string memory suspendedUri_
    ) ERC721("CharOnChain Reputation", "COCREP") AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin) {
        if (router_ == address(0)) revert ZeroAddress();
        if (bytes(suspendedUri_).length == 0) revert InvalidHash();
        for (uint256 i = 0; i < 6; i++) {
            if (bytes(tierUris_[i]).length == 0) revert InvalidHash();
            _tierUris[i] = tierUris_[i];
        }
        _suspendedUri = suspendedUri_;
        ROUTER = IDonationRouter(router_);
    }

    // ------------------------------------------------------------------ claim / burn

    /// @inheritdoc IReputationSBT
    function claim() external {
        uint256 tokenId = _tokenIdOf(msg.sender);
        if (_ownerOf(tokenId) != address(0)) revert AlreadyClaimed();
        if (ROUTER.totalDonatedRaw(msg.sender) < USDC_UNIT) revert NotEligible();
        _mint(msg.sender, tokenId);
        emit ReputationClaimed(msg.sender, tokenId);
        emit Locked(tokenId);
    }

    /// @inheritdoc IReputationSBT
    /// @dev Tylko właściciel (token ma ID = jego adres, więc inny adres nie ma co spalić). Nie rusza historii
    ///      darowizn ani XP; po spaleniu można ponownie `claim`.
    function burn() external {
        _burn(_tokenIdOf(msg.sender));
    }

    // ------------------------------------------------------------------ reputacja

    /// @inheritdoc IReputationSBT
    function tierOf(address wallet) public view returns (uint8) {
        if (_suspended[wallet]) return 0;
        return _tierFor(ROUTER.totalDonatedRaw(wallet));
    }

    /// @notice Czy reputacja portfela jest zawieszona.
    function isSuspended(address wallet) external view returns (bool) {
        return _suspended[wallet];
    }

    /// @inheritdoc IReputationSBT
    function suspendReputation(address wallet, bytes32 reasonHash) external onlyRole(REPUTATION_GOVERNOR_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        if (reasonHash == bytes32(0)) revert InvalidHash();
        if (_suspended[wallet]) revert ReputationAlreadySuspended();
        _suspended[wallet] = true;
        emit ReputationSuspended(wallet, reasonHash);
    }

    /// @inheritdoc IReputationSBT
    function restoreReputation(address wallet, bytes32 reasonHash) external onlyRole(REPUTATION_GOVERNOR_ROLE) {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        if (!_suspended[wallet]) revert ReputationNotSuspended();
        _suspended[wallet] = false;
        emit ReputationRestored(wallet, reasonHash);
    }

    // ------------------------------------------------------------------ ERC-5192 / metadane

    /// @inheritdoc IReputationSBT
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    /// @notice Statyczny, publiczny URI zależny od aktualnego poziomu; neutralny URI dla zawieszonego portfela.
    /// @dev Źródłem aktualnej ligi w UI jest `tierOf` (portfele zewnętrzne mogą cache'ować URI).
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint8 tier = tierOf(address(uint160(tokenId)));
        if (tier == 0) return _suspendedUri;
        return _tierUris[tier - 1];
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControlDefaultAdminRules)
        returns (bool)
    {
        return interfaceId == ERC5192_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------ blokada transferów i zgód (INV-06)

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert Soulbound();
    }

    /// @dev Obrona w głąb: nawet gdyby jakaś ścieżka pominęła powyższe, przenoszenie własności jest niemożliwe.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    // ------------------------------------------------------------------ pomocnicze

    function _tokenIdOf(address wallet) private pure returns (uint256) {
        return uint256(uint160(wallet));
    }

    /// @dev Progi lig (USDC): 1 / 100 / 1 000 / 10 000 / 25 000 / 100 000 (AC-16); lustro `packages/shared`.
    function _tierFor(uint256 totalRaw) private pure returns (uint8) {
        if (totalRaw >= 100_000 * USDC_UNIT) return 6;
        if (totalRaw >= 25_000 * USDC_UNIT) return 5;
        if (totalRaw >= 10_000 * USDC_UNIT) return 4;
        if (totalRaw >= 1_000 * USDC_UNIT) return 3;
        if (totalRaw >= 100 * USDC_UNIT) return 2;
        if (totalRaw >= USDC_UNIT) return 1;
        return 0;
    }
}
