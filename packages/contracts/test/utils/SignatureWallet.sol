// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimalne konto z ERC-1271 (podpis właściciela ECDSA) — WYŁĄCZNIE do testów weryfikatora logowania SIWE
///         (COC-073). Nie jest wzorcem produkcyjnym konta; konta AA są kontraktami dostawcy (ADR-007).
contract SignatureWallet {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    address public immutable OWNER;

    constructor(address owner_) {
        OWNER = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        address signer = ecrecover(hash, v, r, s);
        return (signer != address(0) && signer == OWNER) ? MAGIC : bytes4(0xffffffff);
    }
}

/// @notice Fabryka CREATE2 kont `SignatureWallet` (scenariusz ERC-6492: konto jeszcze niewdrożone).
contract SignatureWalletFactory {
    event Created(address indexed account, address indexed owner);

    function create(address owner_, bytes32 salt) external returns (address account) {
        account = address(new SignatureWallet{salt: salt}(owner_));
        emit Created(account, owner_);
    }

    function predict(address owner_, bytes32 salt) external view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(abi.encodePacked(type(SignatureWallet).creationCode, abi.encode(owner_)))
            )
        );
        return address(uint160(uint256(hash)));
    }
}
