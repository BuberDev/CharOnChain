# Specyfikacja smart kontraktów — CharOnChain MVP

**Wersja semantyki:** SC-1.0. Dokument jest kontraktem projektowym dla implementacji i audytu, nie oznacza istnienia zweryfikowanego wdrożenia.

## 1. Założenia i wdrożenie

- Solidity `^0.8.24` lub nowsza wersja zgodna z OpenZeppelin 5.x — wersja musi zostać przypięta w repo i zatwierdzona po testach.
- Foundry; biblioteki OpenZeppelin `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `ERC721`, `ERC165`.
- Produkcja: Arbitrum One, `chainId=42161`. Testy: Arbitrum Sepolia, `chainId=421614`.
- Produkcyjny natywny USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, 6 decimali. Nie akceptować `USDC.e`.
- Adres USDC przekazywany **raz** w konstruktorze `DonationRouter`, immutable; adresy środowiska `registry`, `router` i `reputation` zatwierdzone w jawnej manifestacji deploy.
- Trzy podstawowe kontrakty `CampaignRegistry`, `DonationRouter`, `ReputationSBT`, czwarty `ImpactRegistry`.
- Brak proxy/upgrade. Przy migracji wersji deploy nowych kontraktów i jawna procedura migracji; **nie kopiować** statystyk do nowego kontraktu jako rzekomo udokumentowanych bez planu i audytu.
- Operacje admin wykonywane przez multisig Safe >=2 z 3 sygnatariuszy; `PAUSER_ROLE` osobny adres do szybkiego wstrzymania, bez możliwości odblokowania.

## 2. Mapy stanów

### CampaignRegistry

Na chainie istnieją jedynie kampanie zaakceptowane. Statusy `ACTIVE=1`, `PAUSED=2`, `CLOSED=3`. Status `DRAFT` i `REJECTED` należą wyłącznie do backendu.

- `ACTIVE` może nie przyjmować wpłat przed `startAt`, po `endAt` lub po osiągnięciu cap.
- `ACTIVE -> PAUSED` przez guardian / admin; `PAUSED -> ACTIVE` **tylko** przez admin.
- `ACTIVE|PAUSED -> CLOSED` tylko admin; `CLOSED` to stan ostateczny.
- Termin `[startAt, endAt)` ustalany przy utworzeniu, niezmienny.
- Beneficjent `Safe`, cap i `orgHash` są niezmienne.
- `metadataHash` można zmieniać tylko adminem, z eventem zawierającym stary i nowy hash; każda wersja opisów zachowana offchain.

### DonationRouter

- Nie ma portfela escrow. `donate` atomowo wykonuje `safeTransferFrom(msg.sender, beneficiary, amountRaw)` i zapisuje `raisedRaw[campaignId]`, `totalDonatedRaw[donor]`.
- Minimalna darowizna: 1 000 000 raw = 1 USDC. **Wyjątek:** dozwolone `0 < amountRaw < 1 000 000` tylko jeśli `amountRaw == capRaw - raisedRaw[id]` (domknięcie resztki celu). Maksimum: pozostałe miejsce do `capRaw` (włącznie). To zapobiega permanentnemu zablokowaniu reszty <1 USDC.
- `raisedRaw + amountRaw <= capRaw` bez wyjątku. Podczas równoczesnych wpłat decyduje kolejność w łańcuchu: późniejsza nadmiarowa wpłata rewertuje.
- Donor/recipient mogą być kontraktami, ale `beneficiary` musi być zaakceptowanym wallet Safe, sprawdzonym przed publikacją w procesie operacyjnym.
- Adres routera może zostać globalnie zapauzowany; guardian nie może wznowić.
- Wszelkie transfery USDC **poza routerem** nie liczą się jako darowizny ani XP i muszą zostać pokazane wyraźnie w FAQ.
- Native ETH przesłany na router jest odrzucany; tokeny ERC-20 wysłane omyłkowo bezpośrednio do kontraktu nie są oficjalną darowizną. Nie projektować „rescue” bez dodatkowej analizy audytowej; przed publikacją kodu należy upewnić się, że UI nigdy nie inicjuje takich transferów.
- Wydanie NFT/wyświetlenie XP nie jest wywoływane przez `donate`, więc problem odznaki nie może blokować płatności.

### ReputationSBT

- ERC-721 + ERC-5192, maksymalnie jeden token na portfel. `tokenId = uint256(uint160(wallet))`.
- `claim()` tylko przez docelowy portfel (opt-in), po skumulowaniu >=1 USDC. `_mint` (świadomy wybór, aby możliwe były smart contract wallets bez ERC721Receiver), z jasnym ostrzeżeniem dla portfeli kontraktowych; testy muszą potwierdzić zachowanie.
- Transfery `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll` niedozwolone; `locked(tokenId)` zwraca true dla istniejącego tokenu; `supportsInterface(0xb45a3c0e)` true.
- `burn()` dozwolony jedynie dla ownera; nie usuwa historii darowizn ani XP; po burn można później ponownie `claim()`.
- `tierOf(wallet)` wyznacza poziom dynamicznie z `DonationRouter.totalDonatedRaw(wallet)` (zero dla `suspended[wallet]==true`); metadane `tokenURI` zależą od poziomu, bez obowiązkowego mintowania nowego tokenu.
- `suspendReputation(wallet, reasonHash)` / `restoreReputation(wallet, reasonHash)` tylko przez multisig `REPUTATION_GOVERNOR_ROLE`; event i hash publicznego powodu, polityka odwołań poza chainem. Nie kasuje statystyk ani NFT. Odrębnie zawieszać rankingi offchain z logiem.
- `tokenURI` zestaw statycznych publicznych CID IPFS per poziom plus neutralny URI dla zawieszonego tokenu, przypięty podczas deploy; w UI źródłem aktualnej ligi jest `tierOf`, gdyż portfele zewnętrzne mogą cache'ować URI.
- Brak automatycznych osiągnięć dodatkowych w MVP (infrastruktura/UX przewiduje future achievements).

### ImpactRegistry

- Po zakończeniu przeglądu w backendzie uprawniony `REPORT_PUBLISHER_ROLE` publikuje **wyłącznie publiczny** kanoniczny JSON raportu (np. na IPFS) i zapisuje `contentSha256`, publiczny CID/URI, `campaignId` i numer wersji raportu.
- `REVIEWER_ROLE` (niebędący tym samym Safe/właścicielem co publisher, odrębni operatorzy) może zatwierdzić lub odrzucić wersję.
- Raport jest append-only: korekta to kolejna wersja; bez edycji historycznego hash, bez usuwania zdarzeń.
- Można odwołać wcześniejsze zatwierdzenie kolejnym eventem z powodem, ale nie wymazać historii. Ekran pokazuje aktualny status i pełną oś zmian.
- `contentSha256 = SHA-256(bajty JSON kanonizowanego wg RFC 8785)`; fixture testuje identyczne hashe w JS i Solidity/offchain. Solidity **nie** parsuje dokumentu.
- Prywatne materiały KYC, medyczne lub dokumenty małoletnich NIGDY nie trafiają na publiczny URI/chain. Redakcja danych + review przed publikacją.
- On-chain weryfikacja raportu oznacza jedynie decyzję wyznaczonego weryfikatora, nie dowód prawdziwości wykonania każdej usługi.

## 3. Model pamięci on-chain (logiczny)

```
CampaignRegistry:
  uint64 nextCampaignId
  mapping(uint64 => Campaign) campaigns
  Campaign = {beneficiary:address, capRaw:uint128, startAt:uint64,
              endAt:uint64, orgHash:bytes32, metadataHash:bytes32, status:uint8}

DonationRouter:
  immutable IERC20 usdc
  immutable ICampaignRegistry registry
  mapping(uint64 => uint256) raisedRaw
  mapping(address => uint256) totalDonatedRaw
  bool paused

ReputationSBT:
  immutable IDonationRouter router
  mapping(address => bool) suspended
  string[7] tierUris  // 0=NONE (nie ma tokenURI), 1..6 poziomy
  ERC721 owner registry

ImpactRegistry:
  mapping(uint64 => Report) reports
  uint64 nextReportId
  Report = {campaignId:uint64, contentSha256:bytes32,
            publicUri:string, version:uint32, decision:uint8, publisher:address}
```

**Ważne:** nie tworzyć `address -> campaign donation amount` na chainie bez rzeczywistej potrzeby; eventy wystarczą do historii per kampania, statystyka zagregowana `totalDonatedRaw` pozostaje on-chain do NFT.

## 4. Główne interfejsy / sygnatury

Normatywny szkic ABI znajduje się w `contracts/src/interfaces/ICharOnChain.sol`. Zestaw wymaganych metod:

| Kontrakt | Funkcja | Kto | Warunek / rezultat |
|---|---|---|---|
| Registry | `createCampaign(beneficiary,capRaw,startAt,endAt,orgHash,metadataHash)` | REGISTRAR | walidacja, nowy ID, event |
| Registry | `pauseCampaign(id)` | PAUSER / ADMIN | active -> paused |
| Registry | `resumeCampaign(id)` | ADMIN | paused -> active |
| Registry | `closeCampaign(id)` | ADMIN | finalne zamknięcie |
| Registry | `updateMetadataHash(id,newHash)` | ADMIN | event historyczny, brak zmiany środków |
| Registry | `getCampaign(id)` | everyone | struktura lub revert gdy brak |
| Router | `donate(id,amountRaw)` | everyone | transfer do beneficjenta, liczniki, event |
| Router | `pause()` | PAUSER / ADMIN | wyłączenie `donate` |
| Router | `unpause()` | ADMIN | wznowienie po przeglądzie |
| Router | `raisedRaw(id)` | everyone | suma USDC kampanii |
| Router | `totalDonatedRaw(wallet)` | everyone | suma USDC dawcy |
| SBT | `claim()` | wallet owner | mint po >=1 USDC |
| SBT | `burn()` | NFT owner | spalenie bez zmiany licznika |
| SBT | `tierOf(address)` | everyone | 0..6, 0 przy zawieszeniu |
| SBT | `locked(tokenId)` | everyone | EIP-5192 |
| SBT | `suspendReputation(wallet,reasonHash)` | governor multisig | tymczasowo 0 tier, event |
| SBT | `restoreReputation(wallet,reasonHash)` | governor multisig | przywrócenie, event |
| Impact | `publishReport(id,hash,uri,version)` | publisher multisig | append-only report |
| Impact | `reviewReport(reportId,decision,reasonHash)` | reviewer multisig | approve/reject/revoke, event |
| Impact | `getReport(reportId)` | everyone | publiczne metadane |

### Wymagane zdarzenia

```
CampaignCreated(uint64 indexed campaignId, address indexed beneficiary, bytes32 indexed orgHash, uint128 capRaw)
CampaignStatusChanged(uint64 indexed campaignId, uint8 oldStatus, uint8 newStatus)
CampaignMetadataChanged(uint64 indexed campaignId, bytes32 oldHash, bytes32 newHash)
DonationReceived(uint64 indexed campaignId, address indexed donor, address indexed beneficiary, uint256 amountRaw)
ReputationClaimed(address indexed wallet, uint256 indexed tokenId)
ReputationSuspended(address indexed wallet, bytes32 reasonHash)
ReputationRestored(address indexed wallet, bytes32 reasonHash)
ReportPublished(uint64 indexed reportId, uint64 indexed campaignId, bytes32 contentSha256, string publicUri, uint32 version)
ReportReviewed(uint64 indexed reportId, uint8 decision, bytes32 reasonHash)
```

### Custom errors (minimalny zestaw)

`Unauthorized`, `ZeroAddress`, `InvalidTimeRange`, `InvalidCap`, `CampaignNotFound`, `CampaignNotActive`, `CampaignNotStarted`, `CampaignExpired`, `CapExceeded`, `BelowMinimumDonation`, `InvalidTokenDecimals`, `AlreadyClosed`, `AlreadyClaimed`, `NotEligible`, `Soulbound`, `InvalidReportVersion`, `AlreadyReviewed`, `InvalidReviewDecision`, `ReputationAlreadySuspended`.

## 5. Macierz uprawnień

| Działanie | Publiczny | Fundacja / org manager | Registrar Safe | Guardian | Admin Safe | Reviewer Safe |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| donate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| claim NFT / burn własnego | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| złożyć projekt kampanii (API) | — | ✅ | — | — | ✅ | — |
| utworzyć kampanię on-chain | — | — | ✅ | — | ✅* | — |
| pause campaign / router | — | — | — | ✅ | ✅ | — |
| resume / close | — | — | — | — | ✅ | — |
| zmiana metadataHash | — | — | — | — | ✅ | — |
| publikacja raportu on-chain | — | — | opcjonalny odrębny Safe | — | — | — |
| zatwierdzenie raportu on-chain | — | — | — | — | — | ✅ |
| suspend/restore reputation | — | — | — | — | ✅ | — |
| transfer środków fundacji | — | beneficjent Safe wg jego podpisów | — | — | — | — |

`*` Admin Safe może delegować/odzyskać `REGISTRAR_ROLE`, ale emitowany jest event `RoleGranted`/`RoleRevoked`. Wdrożeniowo `REPORT_PUBLISHER_ROLE` powinien być osobnym Safe od `REVIEWER_ROLE`. Nie przyznawać tych ról jednemu adresowi.

**Rola DEFAULT_ADMIN_ROLE:** tylko Safe; nigdy EOA dewelopera. Użyć `AccessControlDefaultAdminRules` tam, gdzie to sensowne, z opóźnieniem zmian admina. Każdą zmianę ról monitorować.

## 6. Niepodważalne niezmienniki

**INV-01:** `USDC.balanceOf(Router)` nie zwiększa się w wyniku skutecznej darowizny (przy przyjętych założeniach natywnego USDC; brak custody).

**INV-02:** dla skutecznej darowizny saldo beneficjenta zwiększa się o dokładnie `amountRaw`, a donor traci tę kwotę (bez uwzględniania gas w ETH). Dla revertu żaden z tych stanów się nie zmienia.

**INV-03:** `raisedRaw[id] <= capRaw[id]` i `raisedRaw[id]` jest niemalejące.

**INV-04:** `totalDonatedRaw[wallet]` jest sumą jego skutecznych `DonationReceived`, niemalejącą; `0 XP` tylko przy braku darowizn / zawieszeniu tier, a nie usunięciu historii.

**INV-05:** po utworzeniu `beneficiary`, `capRaw`, `startAt`, `endAt`, `orgHash` niezmienne.

**INV-06:** użytkownik nie może obrócić SBT na rynek, delegować transferu, mintować drugiego NFT na ten sam portfel.

**INV-07:** żaden admin nie może zmienić beneficjenta, wykonać transferu darowizny do siebie ani wymusić NFT jako warunku darowizny.

**INV-08:** nie można wpłacać w stanie paused/closed, poza oknem czasu, ponad limit lub do nieistniejącej kampanii.

**INV-09:** każdy report ma niezmienny hash, ID, URI i autora; korekty są dopisywane, status zmienia się wyłącznie z czytelnym eventem.

**INV-10:** pause nie modyfikuje sald fundacji ani już zakończonych darowizn.

## 7. Warunki błędu i ataki

- Reentrancy: `nonReentrant` na `donate`; checks-effects-interactions z uwzględnieniem revertu; `SafeERC20`.
- Token allowance: `approve` jest odrębną transakcją; nie implementować niestandardowego `permit` dla native USDC bez kompatybilności i audytu.
- Race na cap: druga transakcja revertuje, żadne częściowe wpłaty.
- Blokada USDC / freeze: rewert transakcji i odpowiedni UX, bez fikcyjnego success.
- Reorg: wpływa na indeksator, nie na kontrakt; UI nie pokazuje finalizacji przed buforem potwierdzeń.
- Role takeover: regularny monitoring Safe, ról i alerty zmian.
- Sybil / circular donations: niemal niemożliwe do definitywnego wykluczenia on-chain; wymagana KYB fundacji, osobne review, detekcja na backendzie, transparentna polityka reputacji.
- Niewypłacalność/wstrzymanie/utrata pegu USDC: komunikat o ryzyku oraz emergency pause.

## 8. Deployment i weryfikacja

1. Deploy local z mock 6-decimal USDC; wszystkie unit/invariant tests.
2. Deploy Sepolia z rzeczywistym test Safe i skonfigurowanym test tokenem; 2-of-3 signatures.
3. Audyt ABI, adresów, ról, eventów, gas, zero funkcji withdraw; weryfikacja kodu w explorerze.
4. Manifest deploy: git commit SHA, chain ID, registry/router/SBT/impact, natywny token, administrator Safe, guardian, wersja kompilatora, hash źródeł.
5. Po przeglądzie prawnym i zewnętrznym audycie: osobna zgoda na mainnet. Uruchomienie na testnecie NIE jest dowodem bezpieczeństwa.
