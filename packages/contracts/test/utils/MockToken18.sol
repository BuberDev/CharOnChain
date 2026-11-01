// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token 18-decimalny: router musi go odrzucić już w konstruktorze (InvalidTokenDecimals).
contract MockToken18 is ERC20 {
    constructor() ERC20("Mock 18", "M18") {}
}
