// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mock natywnego USDC (6 miejsc) wyłącznie do testów i wdrożeń lokalnych/testnetowych. Odtwarza
///         zachowanie istotne dla routera: blacklista Circle (transfer od/do zablokowanego adresu rewertuje).
///         NIGDY nie wdrażać na mainnet (manifest COC-002 wymaga natywnego USDC na produkcji).
contract MockUSDC is ERC20 {
    mapping(address => bool) public blacklisted;

    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlacklisted(address account, bool value) external {
        blacklisted[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blacklisted[from] && !blacklisted[to], "Blacklisted");
        super._update(from, to, value);
    }
}
