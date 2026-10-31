# Security, QA, audyt i release gates — CharOnChain

## 1. Threat model (priorytetowe)

| Ryzyko | Skutek | Kontrola | Weryfikacja |
|---|---|---|---|
| Fałszywa fundacja / kradzież kluczy Safe | utrata środków | KYB/KYC reprezentantów, 2-of-3 Safe, weryfikacja adresu i sygnatariuszy, review 4-eyes | test procesu + ćwiczenie incydentu |
| Zmieniony beneficjent | przekazanie do złego adresu | immutable beneficiary onchain; preview i 2-person review | Foundry invariant INV-05 |
| Reentrancy / złośliwy token | utrata/wypaczenie sum | tylko natywny immutable USDC, SafeERC20, nonReentrant | Foundry fuzz + review |
| Nieuprawnione role | publikacja oszustwa / pause | AccessControl, Safe, oddzielny guardian, event monitoring | negatywne testy uprawnień |
| Reorg/duplikaty RPC | fałszywe statystyki | journaling eventów, idempotencja, replay, reconciling | test in-memory fake chain |
| Utrata pegu/freeze USDC | różnica wartości/risk | transparentny nominalny USDC, monitor stablecoin, emergency pause | scenariusze i runbook |
| Złośliwy upload/EXIF | wyciek prywatności lub malware | private bucket, skan, EXIF stripping, magic bytes | security upload tests |
| Fałszywy dokument wydatków | niewiarygodny Proof of Impact | niezależny reviewer, wersje, publiczny hash, procedura reklamacji | e2e reports |
| Replay SIWE / session theft | takeover konta | nonce one time, domain/chain, secure cookie, EIP-1271 | auth penetration tests |
| Broken object-level authorization | wyciek KYB lub cudzych draftów | backend RBAC + Supabase RLS + testy RLS | integration test matrix |
| NFT farming / collusion | wypaczona liga, utrata zaufania | niezależni odbiorcy, antyfraud signals, publiczne zasady, suspension + appeals | scenario tests + manual playbook |
| Prywatne dane na IPFS | nieodwracalne ujawnienie | tylko zredagowane publiczne raporty, content review gate | automatyczny scan + manual sign-off |
| Błędny token lub chain | strata środków | allowlisted native USDC, chain ID validation, verified address | browser & contract tests |
| Słaby monitoring | późne wykrycie incydentu | alerty RPC/indexer/role/pause/reconciliation | chaos test |

**Ryzyko rezydualne:** nawet sprawdzenie KYB i Safe nie gwarantuje, że organizacja użyje środków zgodnie z deklaracją. Smart kontrakt nie może kontrolować wydatków już wykonanych z Safe odbiorcy. Publiczne komunikaty nie mogą sugerować, że jest inaczej.

## 2. Testy Foundry — minimalna taksonomia

### Registry
- `test_createCampaign_OnlyRegistrar`, `test_createCampaign_RevertsZeroBeneficiary`, `test_createCampaign_InvalidStartEnd`, `test_createCampaign_InvalidCap`, `test_createCampaign_EmitsEvent`.
- `test_pause_OnlyGuardianOrAdmin`, `test_resume_OnlyAdmin`, `test_close_IsFinal`, `test_metadataUpdate_EmitsBothHashes`, `test_beneficiaryImmutable`.
- `testFuzz_createCampaign_Params` ograniczony do valid inputs.

### Router
- `test_donate_ExactTokenFlow`, `test_donate_IncrementsCounters`, `test_donate_OneEvent`, `test_donate_MinOneUSDC_ExceptExactFinalDust`, `test_donate_InsufficientAllowance`, `test_donate_InsufficientBalance`.
- `test_donate_CapBoundaryAndRace`, `test_donate_Expired`, `test_donate_Future`, `test_donate_RegistryPaused`, `test_donate_GlobalPaused`, `test_donate_Closed`, `test_donate_UnknownCampaign`.
- `test_donate_RevertNoPartialEffects`, `test_donate_DoesNotMintNftOrCallExternalReputation`, `test_donate_RejectsETH`, `test_donate_RejectsIncorrectToken`.
- `testFuzz_donate_AmountsAndCap`, multi-user multi-campaign handler, donation sequence at time boundaries.

### SBT
- `test_claim_EligibleOnly`, `test_claim_OnePerAddress`, `test_claim_TokenIdFromAddress`, `test_claim_OptIn`, `test_burn_OnlyOwner`, `test_burn_PreservesDonationStats`.
- `test_lockedERC5192_Interface`, `test_transferAndApprove_Revert`, `test_tierThresholds_AllBoundaries`, `test_tokenURI_DynamicTier`, `test_suspend_RequiresGovernor`, `test_suspend_ReasonsEvent`.
- Testy kompatybilności kont EOA oraz smart contract wallet z ograniczoną obsługą ERC721Receiver.

### Impact
- `test_publish_OnlyPublisher`, `test_publish_ValidCampaign`, `test_publish_ImmutableHash`, `test_publish_StrictVersionIncrease`, `test_review_OnlyReviewer`, `test_review_CannotSelfApprove`, `test_review_EmitsHistory`, `test_review_Revocation`.
- Porównanie hashów z fixture RFC 8785 generowanych na backendzie; brak treści prywatnych.

### Invariant/fuzz (Foundry StdInvariant / handler)

- suma skutecznych wpłat per kampania = `router.raisedRaw`, <= cap;
- suma donor successful event totals = `router.totalDonatedRaw`;
- beneficiary/dates/cap immutable mimo losowych admin i guardian calls;
- transfer z routera wyłącznie z `msg.sender` do przypisanego Safe;
- niezbywalność NFT dla każdej sekwencji calls;
- random pauses/reorg simulation w indexerze nie zmienia prawdy onchain;
- report IDs immutable, decyzje audytowalne, wersja rośnie.

### SAST / dependencies

- `forge fmt --check`, `forge build`, `forge test -vvv`, `forge coverage`, `forge test --match-contract Invariant` (w zależności od finalnej struktury), `slither .` po konfiguracji; npm/pnpm audit i skan secrets.
- Wykrywanie uprawnień i braku nieautoryzowanych transferów przez manual review niezależnie od automatycznych wyników.
- CI fail on broken tests, typecheck, lint, migration tests, metadata hash fixture.

## 3. Backend / indexer / RLS

**Unit:** parser/validator `amountRaw`, check risk, SIWE nonce, tier calculation (BigInt), URL sanitization, JSON canonicalization, API error mapping.

**Integration:** organizacja A nie odczyta pliku/draftu organizacji B; approved reviewers distinct; usunięcie prawa dostępu działa natychmiast; service role dostępne tylko workerowi; private bucket URL expires; RLS DENY by default.

**Indexer chaos:** replay 100× tego samego logu; reorg 1..N bloków; zmiana hash pod tym samym block height; RPC 429; RPC stale; restart w połowie batch; event unknown contract; donation event fake logs; backfill po deploy; rebuild projections od genesis deploy. Każdy test musi pokazać brak duplikacji oraz zgodność z chain gettters.

**E2E (Playwright):** anonymous browse -> wallet connect -> approve -> donate -> confirmed -> donor profile -> claim -> reports; mobile 360px; wrong chain; no ETH; user rejects; cap race; network outage; profile opt-in/out; private abuse report; log admin approval.

**Load:** katalog >1000 kampanii i eventów paginowanych, p95 <800ms przy zdefiniowanym obciążeniu; ochrony przed abuse dla auth i upload.

## 4. Testowe organizacje, środowiska, klucze

- Local: anvil/foundry mock USDC 6 decimals; test Safe mock do unit oraz rzeczywisty Safe na środowisku testowym do E2E.
- Sepolia: realny Safe 2-of-3 testowych kluczy, oddzielny guardian, publisher i reviewer. Nigdy seed fraz w repo.
- Mainnet: osobne Safe, sprzętowe klucze podpisujących, rotacja operatorów, backup kluczy i instrukcje odcięcia dostępu.
- `NEXT_PUBLIC_*` nie zawiera prywatnych kluczy, Supabase service role, admin private RPC token ani dokumentów KYB.
- Rozdzielne projekty Supabase/Vercel/RPC dla local/staging/production.

## 5. Runbook incydentów

1. Alert: podejrzenie fałszywej kampanii, nieprawidłowego odbiorcy, kompromitacji roli, rozbieżności indeksacji lub depegu.
2. Guardian pauzuje `DonationRouter` lub wskazaną kampanię. Nie podejmuje prób „cofnięcia” wcześniejszych transakcji.
3. Operator zapisuje `incident_id`, timestamp UTC, tx hashes, status potwierdzeń, osoby odpowiedzialne, zawiadamia administrację.
4. Wstrzymać promocję kampanii i oznaczyć stan w UI; wyjaśnić, że środki wcześniej przekazane organizacji nie są już w kontroli platformy.
5. Root-cause + naprawa + niezależny review; do wznowienia wymagana zgoda admin Safe.
6. Postmortem i komunikat dla użytkowników w granicach prawa i ochrony prywatności.

## 6. Production release gates — wszystkie obowiązkowe

- [ ] Opinia prawna UE/Polska potwierdza dozwolony model usług, compliance/MiCA, polityki AML/sankcji oraz prawidłowe zasady darowizn.
- [ ] Podpisane warunki udziału z fundacjami, w tym dowody i terminy raportowania, zgody na dane publiczne.
- [ ] Zewnętrzny audyt smart kontraktów z 0 unresolved Critical/High oraz formalnym potwierdzeniem wersji commit/deploy.
- [ ] Threat model i dokumentacja uprawnień podpisane przez niezależnego reviewera; Safe >=2-of-3; EOA dewelopera nie ma ról admin.
- [ ] Wszystkie AC-01..AC-35 pokryte testami lub ręcznie udokumentowaną procedurą, wszystkie P0 pass.
- [ ] Invariant tests, Fuzz, SAST, migration tests, RLS regression, mobile E2E pass.
- [ ] Zweryfikowany na block explorerze source code oraz kontrakty i adres **native USDC**; manifest release sprawdzony 2-person review.
- [ ] Test awaryjnego pause i restart, role changes, indexer reorg/replay, monitoring i alerty.
- [ ] Backup + restore test, prywatność uploadów, redakcja EXIF i dokumentów, podpisane polityki retencji.
- [ ] Disclosure na checkout dla bezpośrednich, nieodwracalnych transferów, opłat ETH, gas, ryzyka USDC.
- [ ] Publiczne dane: korelacja gettters kontraktów, events, stats API i explorer (reconciliation test).
- [ ] Pierwsza produkcyjna kampania uruchomiona dopiero po ponownym sprawdzeniu beneficjenta Safe i właścicieli.

## 7. Definition of Done dla każdego PR

- Spec i zadanie backlogu powiązane; kod TypeScript strict / Solidity clean, brak nowych `any` bez justification.
- Jednostkowe/kontraktowe/integracyjne testy aktualizowane; wynik w opisie PR.
- Odpowiedni model uprawnień i test negatywny.
- Aktualne migracje i odtwarzalny dev setup; brak hard-coded sekretnych adresów/kluczy.
- Komunikaty UX dostępne PL/EN; brak mylących wartości pieniężnych.
- Dla każdej zmiany we flow pieniędzy: osobny review bezpieczeństwa + aktualizacja modelu zagrożeń.

## 8. Budżet i realność

10–14 tygodni to *orientacyjny czas programowania* dla ograniczonego MVP, nie gwarancja audytu, oceny prawnej, procesów KYB czy publicznego launchu. Bez tych elementów program działa jako demonstrator na testnecie, a nie gotowa usługa obsługująca realne darowizny.
