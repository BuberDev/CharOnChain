// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 6-decimalny token wywołujący zwrotnie `target` z `payload` podczas `transferFrom` (atak reentrancji,
///         np. ERC-777-podobny hook). Router musi to odrzucić (`nonReentrant`).
contract ReentrantUSDC is ERC20 {
    address public target;
    bytes public payload;
    bool private _entered;

    constructor() ERC20("Reentrant USDC", "rUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (target != address(0) && !_entered) {
            _entered = true;
            (bool ok, bytes memory result) = target.call(payload);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 0x20), mload(result))
                }
            }
        }
        return super.transferFrom(from, to, value);
    }
}
