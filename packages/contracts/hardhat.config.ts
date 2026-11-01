import { createRequire } from "node:module";

import { defineConfig } from "hardhat/config";

const require = createRequire(import.meta.url);

/**
 * Kompilator: `solc-js` 0.8.28 z pakietu npm `solc` (przypięty). Ten sam kompilator na każdej maszynie i w CI,
 * bez pobierania binariów w czasie budowania (`binaries.soliditylang.org` bywa niedostępne). Wynik bajtkodu
 * jest identyczny jak z natywnym solc 0.8.28 (ta sama wersja i ustawienia).
 * EVM: `cancun` — wymagany przez OpenZeppelin 5.6.1 (biblioteki używają `mcopy`; przy `paris`/`shanghai`
 * kompilacja się nie udaje). Kompilator sam emituje także MCOPY (kopiowanie pamięci, np. zwracane stringi) i
 * PUSH0. Wdrożony kod NIE zawiera TSTORE/TLOAD/BLOB*, DELEGATECALL, CALLCODE ani SELFDESTRUCT (sprawdza to
 * `test/BytecodeSafety.t.sol`). Obsługa opcodów Cancun (MCOPY) i PUSH0 na Arbitrum One/Sepolia jest
 * NIEZWERYFIKOWANA w tej sesji (brak dostępu do dokumentacji Arbitrum) i musi zostać potwierdzona pierwszym
 * wdrożeniem na Sepolia (COC-016), zanim cokolwiek innego zostanie uznane za gotowe.
 */
export default defineConfig({
  solidity: {
    version: "0.8.28",
    path: require.resolve("solc/soljson.js"),
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    tests: { solidity: "./test" },
  },
  test: {
    solidity: {
      // Odpowiada [fuzz]/[invariant] w foundry.toml. Wartości domyślne CI; lokalnie można podnieść.
      fuzz: { runs: 256 },
      invariant: { runs: 64, depth: 64 },
    },
  },
});
