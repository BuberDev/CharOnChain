# Notatki przedaudytowe — kontrakty SC-1.0 (COC-015, wewnętrzne)

**To nie jest audyt.** Niezależny audyt zewnętrzny (COC-060) jest bramką przed mainnet. Poniżej to, co wykonano wewnętrznie, z uczciwymi ograniczeniami. Stan: 2026-11-01, commit zob. `git log`.

## 1. Co zostało wykonane

| Kontrola | Wynik | Odtworzenie |
|---|---|---|
| Testy Solidity (unit + fuzz 256 + invariant 64×64) | **98 zielonych** | `pnpm --filter @charonchain/contracts run test` |
| Invarianty INV-01..05, 08, 10 z handlerem (losowe wpłaty, pauzy, statusy, czas) | zielone | `test/DonationRouter.invariant.t.sol` |
| Testy mutacyjne (33 wstrzyknięte błędy w 4 kontraktach) | **32/33 zabitych**; ocalały **S7** = martwa obrona w głąb (`_update` w SBT jest nieosiągalny, bo wszystkie publiczne ścieżki transferu reweruje wcześniej) | `node scripts/mutation-test.mjs` |
| Skan opcodów wdrożonego kodu | brak DELEGATECALL, CALLCODE, SELFDESTRUCT, TSTORE/TLOAD, BLOB*; Registry i Impact bez CALL | `test/BytecodeSafety.t.sol` |
| Statyczne straże źródeł | brak payable/assembly/withdraw/upgrade/proxy; interfejs == spec; wersja kompilatora przypięta | `tests/contracts-spec.test.ts` |
| Slither 0.11.6 (102 detektory) na 4 kontraktach | tylko 7 ustaleń informacyjnych/niskich, wszystkie wyjaśnione (sekcja 2) | sekcja 4 |
| Zużycie gazu (testy) | sekcja 3 | `hardhat test solidity --gas-stats` |

## 2. Slither — ustalenia i triage

| Detektor | Gdzie | Ocena |
|---|---|---|
| `timestamp` | `DonationRouter.donate`, `CampaignRegistry.createCampaign` | **Zamierzone.** Okno kampanii `[startAt, endAt)` jest z definicji czasowe (AC-05). Manipulacja znacznikiem czasu na L2 o sekundy nie zmienia semantyki. |
| `naming-convention` | immutable `_USDC`, `REGISTRY`, `ROUTER` | Informacyjne; immutables wielkimi literami zgodnie z przewodnikiem stylu Solidity. |
| `unused-return` | `ImpactRegistry.publishReport` → `REGISTRY.getCampaign` | **Zamierzone.** Wywołanie służy wyłącznie sprawdzeniu istnienia kampanii (rewert `CampaignNotFound`). |

Brak ustaleń o reentrancji, kontroli dostępu, niezainicjalizowanych zmiennych, `tx.origin`, nieograniczonych pętlach ani nadpisywaniu storage.

## 3. Gaz (średnio, `hardhat test --gas-stats`, EVM cancun, optimizer 200)

| Kontrakt | Wdrożenie (gaz) | Rozmiar runtime (B) | Funkcje (mediana) |
|---|---|---|---|
| CampaignRegistry | 1 370 318 | 5 627 | `createCampaign` 145 033 · `pauseCampaign` 33 334 · `resumeCampaign` 33 397 · `closeCampaign` 33 307 · `updateMetadataHash` 35 710 |
| DonationRouter | 1 326 514 | 5 379 | `donate` 133 555 (82 254 przy końcówce celu bez zmiany slotu licznika) · `pause` 46 982 · `unpause` 29 899 |
| ReputationSBT | 1 992 750 | 7 550 | `claim` 76 571 · `burn` 36 641 · `suspendReputation` 48 689 · `restoreReputation` 31 525 |
| ImpactRegistry | 1 610 656 | 6 714 | `publishReport` 163 664 · `reviewReport` 34 176 |

Wszystkie kontrakty mieszczą się z dużym zapasem w limicie rozmiaru (24 576 B). Gaz L2 Arbitrum zależy od kosztu danych L1; wartości to koszt wykonania w EDR, nie opłata użytkownika.

## 4. Jak uruchomić Slithera offline

Slither wykrywa `foundry.toml` i wymaga `forge`; używa też natywnego `solc`. Gdy ani jedno, ani drugie nie jest dostępne:

```bash
python3 -m venv /tmp/slither && /tmp/slither/bin/pip install slither-analyzer==0.11.6
mkdir /tmp/slither-proj && cp -r packages/contracts/src /tmp/slither-proj/src
ln -s "$PWD/packages/contracts/node_modules" /tmp/slither-proj/node_modules
cd /tmp/slither-proj && /tmp/slither/bin/slither src/DonationRouter.sol \
  --solc "$OLDPWD/packages/contracts/scripts/solc-cli-shim.mjs" \
  --solc-remaps "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/" --filter-paths node_modules
```

W CI z siecią użyj `slither-action` z natywnym solc (zalecane).

## 5. Znane ryzyka i otwarte pytania dla audytora

1. **EVM cancun / PUSH0 / MCOPY na Arbitrum** — niezweryfikowane (README pakietu, ryzyko nr 1). Test wdrożenia na Sepolia musi to potwierdzić.
2. **Beneficjent = „zaakceptowany Safe”** sprawdzany poza łańcuchem; kontrakt nie wie, czy adres jest Safe (ADR-113, DOC-05).
3. **USDC ufany** (immutable); blacklista Circle powoduje rewert wpłaty (testowane); zmiana implementacji USDC przez Circle jest poza naszą kontrolą.
4. **Brak różnicy sald** po transferze: token z podatkiem od transferu zepsułby księgowanie (natywne USDC go nie ma; konstruktor odrzuca tylko token inny niż 6-decimalny).
5. **Role**: `DEFAULT_ADMIN_ROLE` może nadać sobie dowolną rolę (jawnie, event `RoleGranted`; docs/02 §5 „*”). Bezpieczeństwo zależy od tego, że admin to Safe ≥ 2 z 3 oraz od opóźnienia zmiany admina (`AccessControlDefaultAdminRules`, parametr konstruktora — wartość produkcyjna do ustalenia, testy używają 3 dni).
6. **`claim` dla zawieszonego portfela** dozwolone (tier = 0). Decyzja do potwierdzenia.
7. **`updateMetadataHash` odrzuca `CLOSED`** — decyzja do potwierdzenia.
8. Testy fuzz i invariant mają ustawione `runs`/`depth` na wartości CI (256 / 64×64); przed audytem warto uruchomić długi przebieg (np. 100 000 / 1 000×100).
9. Brak testów na prawdziwych kontach ERC-4337 (EntryPoint, paymaster): tylko mock konta kontraktowego (E6, COC-078).
