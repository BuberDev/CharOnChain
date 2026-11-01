// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimalne konto kontraktowe (jak smart account ERC-4337): wykonuje wywołania w imieniu właściciela,
///         NIE implementuje ERC721Receiver. Służy do testów atrybucji (docs/02 §9): `msg.sender` routera
///         i SBT to adres konta, a nie właściciela, bundlera ani paymastera.
contract ContractWallet {
    address public immutable OWNER;

    struct Call {
        address target;
        bytes data;
    }

    constructor(address owner_) {
        OWNER = owner_;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == OWNER, "owner only");
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    /// @notice Batch jak `approve + donate` w jednej operacji.
    function executeBatch(Call[] calldata calls) external {
        require(msg.sender == OWNER, "owner only");
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory result) = calls[i].target.call(calls[i].data);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 0x20), mload(result))
                }
            }
        }
    }
}
