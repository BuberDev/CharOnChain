// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./utils/BaseTest.sol";

/// @notice Statyczna kontrola wdrozonego kodu bajtowego: w zadnym z czterech kontraktow nie ma opcodow, ktore
///         lamalyby zalozenia SC-1.0 (brak proxy/upgrade, brak samounicestwienia, brak delegatecall) ani
///         opcodow Cancun poza MCOPY (TSTORE, TLOAD, BLOBHASH, BLOBBASEFEE). MCOPY emituje sam kompilator przy
///         kopiowaniu pamieci (cel `cancun`), a PUSH0 jest dopuszczony; oba wymagaja potwierdzenia na Arbitrum
///         Sepolia (COC-016) - niezweryfikowane w tej sesji.
contract BytecodeSafetyTest is BaseTest {
    function _scan(address target) internal view returns (bool delegatecall, bool callcode, bool selfdestruct_, bool tx5, bool blob, uint256 calls) {
        bytes memory code = target.code;
        // Odcinamy metadane CBOR (ostatnie 2 bajty = dlugosc metadanych), zeby nie interpretowac ich jako kod.
        uint256 end = code.length;
        if (end > 2) {
            uint256 metaLen = (uint256(uint8(code[end - 2])) << 8) | uint256(uint8(code[end - 1]));
            if (metaLen + 2 < end) end -= metaLen + 2;
        }
        uint256 i = 0;
        while (i < end) {
            uint8 op = uint8(code[i]);
            // Pierwszy INVALID (0xfe) konczy kod wykonywalny; to, co po nim (np. stale dane), nie jest kodem.
            if (op == 0xfe) break;
            if (op >= 0x60 && op <= 0x7f) {
                i += 1 + (op - 0x5f); // PUSH1..PUSH32: pomijamy dane
                continue;
            }
            if (op == 0xf4) delegatecall = true;
            else if (op == 0xf2) callcode = true;
            else if (op == 0xff) selfdestruct_ = true;
            else if (op == 0x5c || op == 0x5d) tx5 = true; // TLOAD, TSTORE (MCOPY 0x5e dopuszczony)
            else if (op == 0x49 || op == 0x4a) blob = true; // BLOBHASH, BLOBBASEFEE
            else if (op == 0xf1) calls++;
            i++;
        }
    }

    function _assertSafe(address target, string memory name) internal view {
        (bool dc, bool cc, bool sd, bool cancunOnly, bool blob,) = _scan(target);
        assertFalse(dc, string.concat(name, ": DELEGATECALL"));
        assertFalse(cc, string.concat(name, ": CALLCODE"));
        assertFalse(sd, string.concat(name, ": SELFDESTRUCT"));
        assertFalse(cancunOnly, string.concat(name, ": TSTORE/TLOAD"));
        assertFalse(blob, string.concat(name, ": BLOBHASH/BLOBBASEFEE"));
    }

    function test_noDangerousOpcodes_inAnyContract() public view {
        _assertSafe(address(registry), "CampaignRegistry");
        _assertSafe(address(router), "DonationRouter");
        _assertSafe(address(sbt), "ReputationSBT");
        _assertSafe(address(impact), "ImpactRegistry");
    }

    function test_registryAndImpact_haveNoExternalCalls() public view {
        // Rejestry nie wywoluja zewnetrznych kontraktow w zmieniajacych stan sciezkach poza odczytem rejestru
        // (STATICCALL, 0xfa); zwykly CALL (0xf1) nie wystepuje. Router i SBT ma CALL/STATICCALL do tokena/routera.
        (,,,,, uint256 registryCalls) = _scan(address(registry));
        (,,,,, uint256 impactCalls) = _scan(address(impact));
        assertEq(registryCalls, 0, "CampaignRegistry: CALL");
        assertEq(impactCalls, 0, "ImpactRegistry: CALL");
    }
}
