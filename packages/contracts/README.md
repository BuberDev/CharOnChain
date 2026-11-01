# @charonchain/contracts

Kontrakty SC-1.0: `CampaignRegistry`, `DonationRouter`, `ReputationSBT`, `ImpactRegistry` (COC-010..014). Solidity 0.8.28, OpenZeppelin 5.6.1, EVM `cancun`.

- **Specyfikacja (źródło prawdy):** `docs/02-SMART-CONTRACTS.md` i `contracts/src/interfaces/ICharOnChain.sol`. Kopia interfejsu w `src/interfaces/` jest pilnowana testem `tests/contracts-spec.test.ts` (musi być identyczna).
- Brak funkcji admin-withdraw/rescue, brak proxy/upgrade, niezmienny beneficjent, brak `payable` (`CLAUDE.md` pkt 5; pilnują tego statyczne straże i test kodu bajtowego).
- Kontrakty **nie zmieniają się** z powodu Account Abstraction (`docs/02` §9; testy atrybucji do konta w `AccountAbstraction.t.sol`).

## Uruchamianie

```bash
pnpm --filter @charonchain/contracts run test    # testy Solidity (Foundry-style) przez Hardhat 3 / EDR
pnpm --filter @charonchain/contracts run build   # kompilacja
pnpm check:contracts                             # typecheck + build + test
node packages/contracts/scripts/mutation-test.mjs [filtr]   # testy mutacyjne (wolne: ~30 s na mutanta)
```

Testy to zwykłe pliki `*.t.sol` z `forge-std` (v1.17.0, przypięty commit): unit, **fuzz** (256 przebiegów), **invariant** (`DonationRouter.invariant.t.sol`: INV-01..05, INV-08, INV-10; handler musi leżeć w tym samym pliku co test, inaczej runner EDR go nie rozpoznaje) i statyczna kontrola opcodów (`BytecodeSafety.t.sol`).

### Dlaczego Hardhat 3, a nie `forge`

W środowisku deweloperskim `foundry.paradigm.xyz` i `binaries.soliditylang.org` były zablokowane, więc `forge` nie dało się uruchomić. Te same pliki `*.t.sol` uruchamia Hardhat 3 (silnik EDR implementuje cheatcody Foundry) z kompilatorem `solc-js` 0.8.28 z npm (ten sam kompilator i ustawienia → ten sam bajtkod). `foundry.toml` jest utrzymywany dla `forge` w CI (`contracts-foundry`, na razie `continue-on-error`): **nie był uruchomiony lokalnie**. Różnice między runnerami (np. niedostępne cheatcody) wyjdą dopiero w CI.

## Wdrożenie (COC-016)

`deploy/deploy.ts` (biblioteka viem) wdraża cztery kontrakty, nadaje role operacyjne, a na końcu planuje `beginDefaultAdminTransfer(adminSafe)` w każdym kontrakcie; Safe musi osobno wywołać `acceptDefaultAdminTransfer()` po upływie opóźnienia (do tego czasu manifest ma status `ADMIN_TRANSFER_PENDING`). Wdrażający nie zachowuje żadnej roli; stan jest weryfikowany odczytem z łańcucha (`verifyDeployment`). Testy: `pnpm test:deploy` (łańcuch w procesie, wymaga `build`).

CLI Sepolia (`deploy/cli.ts`) obsługuje wyłącznie Arbitrum Sepolia, klucz tylko z `DEPLOYER_PRIVATE_KEY`, domyślnie drukuje plan bez transakcji (`--execute` wysyła). Nie był uruchomiony na żadnej sieci publicznej.

## Ryzyka i niezweryfikowane założenia

1. **EVM `cancun`** (wymagany przez OZ 5.6.1; kompilator emituje MCOPY i PUSH0). Obsługa na Arbitrum One/Sepolia **nie została zweryfikowana** (brak dostępu do dokumentacji Arbitrum). Pierwszy test wdrożenia na Sepolia (COC-016) musi to potwierdzić, zanim cokolwiek innego zostanie uznane za gotowe.
2. Beneficjent kampanii to „zaakceptowany Safe” sprawdzany **poza łańcuchem** (proces operacyjny). Opcjonalna kontrola on-chain (próg ≥ 2) to otwarta decyzja ADR-113 (DOC-05) — nie zaimplementowana.
3. USDC jest ufane jako natywny token Circle (ustawiany raz w konstruktorze; konstruktor odrzuca token inny niż 6-decimalny). Router nie sprawdza różnicy sald (brak tokenów z podatkiem od transferu w założeniach).
4. Audyt zewnętrzny, Slither i raport gazu **nie zostały wykonane** (COC-015 niedokończone, COC-060 bramka).

## Decyzje projektowe wynikające ze spec (do potwierdzenia właściciela)

- `updateMetadataHash` odrzuca kampanię `CLOSED` (stan ostateczny = zamrożone metadane).
- `ImpactRegistry` wymaga istnienia kampanii (`CampaignNotFound`), wersje raportu rosną o 1 od 1, a decyzje: `UNREVIEWED→VERIFIED|REJECTED`, `VERIFIED→REVOKED`; `REJECTED/REVOKED` ostateczne; `REJECTED/REVOKED` wymagają niepustego hasha powodu; autor raportu nie recenzuje własnego raportu, a role publisher/reviewer nie mogą należeć do jednego adresu.
- `ReputationSBT.claim` pozostaje dozwolone dla zawieszonego portfela (tier i tak = 0), żeby zawieszenie nie dawało efektu ubocznego w `claim/burn`.
