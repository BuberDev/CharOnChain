# UX / UI i kryteria akceptacji — CharOnChain

## 1. Wymagania wizualne

**Normatywne rozszerzenie:** przed jakimkolwiek zadaniem frontendowym zastosuj `docs/08-DESIGN-SYSTEM-AND-SKILLS.md` (obowiązkowe Taste + Design) i `docs/09-VISUAL-QA-CHECKLIST.md` (real-browser visual inspection i AC-36..43). Wymienione tu kolory są punktem startowym do oceny, a nie zgodą na automatyczny generic template.

- Marka: **CharOnChain**; napis w całości, bez wymyślonej tokenomiki. Projekt UI ma być oryginalny, nie kopią strony innego dostawcy.
- Kierunek: profesjonalny fintech + filantropia. Hierarchia: zaufanie -> konkretny cel -> transparentne liczby -> darowizna -> historia wpływu.
- Paleta robocza: tło `#0C1527`, turkus `#53D5AE`, jasna powierzchnia `#F6F9FC`, tekst `#162033`; wymaga przetestowania kontrastu WCAG 2.2 AA. Logo, typografia i grafiki do ostatecznej akceptacji projektu.
- Responsywność od 360 px; nie zasłaniać przycisku donate przez sticky UI; minimum 44×44 px touch targets, pełna nawigacja klawiaturą.
- PL domyślnie i pełne EN; waluta wartości na MVP USDC, a nie mylący `$` bez wyjaśnienia.
- Zachować precyzję: kwota `5.123456 USDC`, cap i raised nie zaginają do 2 miejsc tam, gdzie utrata dokładności zmieniałaby znaczenie.
- Bez rankingów promujących zawstydzanie niższych wpłat; anonimowość onchain wytłumaczona.

## 2. Mapa ekranów

| ID | Ścieżka / ekran | Najważniejsze komponenty | Dostęp |
|---|---|---|---|
| UX-01 | `/` home | Hero, odkrywaj kampanie, proces 3 kroki, Trust center, CTA | public |
| UX-02 | `/campaigns` | wyszukiwarka, filtry, lista, paging | public |
| UX-03 | `/campaigns/[slug]` | opis, cover, beneficjent, cap, postęp, donor stats, raporty, donate | public |
| UX-04 | checkout modal/panel | kwota, sieć, connect, allowance, approve, donate, gas, status | public + wallet |
| UX-05 | `/donations/[txHash]` | status eventu, link explorer, kampania, kwota, następne kroki | public |
| UX-06 | `/organizations/[slug]` | legal entity, status KYB, portfel Safe, publiczne kampanie/raporty | public |
| UX-07 | `/impact` | wyszukiwarka publicznych raportów, statusy/tx | public |
| UX-08 | `/profile` | self profile, history, XP, tier, NFT mint, opt-in | SIWE |
| UX-09 | `/donors/[address]` | profil publiczny tylko po consent; dane chain z wyjaśnieniem | public |
| UX-10 | `/leaderboard` | opt-in wallet, liga, XP, zasady liczenia | public |
| UX-11 | `/apply` | wniosek organizacji, status weryfikacji | SIWE |
| UX-12 | `/dashboard/org` | kampanie, dokumenty, raporty, Safe, członkowie | org roles |
| UX-13 | `/dashboard/org/campaigns/new` | kreator draftu, upload, preview, submit | org manager |
| UX-14 | `/dashboard/org/reports/new` | wersjonowany raport, redakcja danych, submission | org reporter |
| UX-15 | `/admin` | kolejka review, 4-eyes, decyzje, audyt, abuse reports | admin |
| UX-16 | `/admin/chain` | indexer status, reorgy, reconcile, pause health | admin |
| UX-17 | `/trust` | dowód transakcji vs dowód wpływu, audyty, Safe, polityki | public |
| UX-18 | `/legal/*` | zasady darowizn, prywatność, ryzyka, polityka weryfikacji | public |

## 3. Dokładne flow checkoutu (state machine)

`IDLE -> CONNECTING -> WRONG_CHAIN? -> INSUFFICIENT_ETH? -> CHECKING_BALANCES -> APPROVAL_REQUIRED? -> APPROVING -> APPROVAL_CONFIRMING -> READY -> DONATING -> TX_SUBMITTED -> TX_OBSERVED -> TX_CONFIRMED -> SUCCESS`

Dodatkowe terminal states: `USER_REJECTED`, `APPROVAL_FAILED`, `DONATION_REVERTED`, `TRANSACTION_REPLACED`, `RPC_UNAVAILABLE`, `CAMPAIGN_CLOSED`, `CAP_REACHED`, `WALLET_DISCONNECTED`. Przy każdym stan zrozumiały, dostępny komunikat i bezpieczne ponowienie.

**Krytyczne:** `approve` nie jest darowizną. `TX_SUBMITTED` nie jest sukcesem. `TX_OBSERVED` oznacza wstępne wykrycie, zaś `TX_CONFIRMED` to określona polityka potwierdzeń L2. Nie nazywać `TX_CONFIRMED` finalnością Ethereum L1.

### Copy — elementy wymagane

- „Przekazujesz **{amount} USDC** do zweryfikowanego portfela organizacji **{name}**, adres **{shortAddress}**.”
- „CharOnChain nie pobiera obowiązkowej prowizji. Sieć Arbitrum pobiera opłatę w ETH.”
- „Darowizna jest nieodwracalna po potwierdzeniu. Platforma nie obsługuje automatycznych zwrotów.”
- „Wpłaty dokonane poza przyciskiem **Wesprzy** nie zostaną uwzględnione w odznakach.”
- „Weryfikacja organizacji nie gwarantuje rezultatu pomocy; zweryfikowane raporty opisują zakres przeprowadzonej kontroli.”

## 4. Specyfikacja najważniejszych ekranów

### UX-03: strona kampanii

1. Zdjęcie z prawami do publikacji; nazwisko małoletniego tylko po ocenie prawnej.
2. Tytuł, kategoria, organization badge wraz z metodologią weryfikacji, permalink do profilu.
3. Licznik `raisedRaw` po potwierdzonych eventach, `capRaw`, procent z cap, data start i koniec, status zapauzowania i przyczyna jeśli publiczna.
4. Panel donate: kwota + ETH gas + USDC balance, kontrola remaining cap, link Safe i weryfikowany chain token address.
5. Oś zdarzeń: darowizny (na blockchainie), raporty organizacji, status weryfikacji raportu. Filtr „tylko transakcje”/„tylko raporty”.
6. Disclosure: brak automatycznych zwrotów, USDC risk, co naprawdę weryfikuje blockchain; link do zgłoszenia nadużycia.
7. Puste/edge states: brak wpłat, brak raportów, weryfikacja w toku, osiągnięty cap, data minęła, guardian pause.

### UX-08: profil darczyńcy

- Connected wallet, kopia adresu, waluta sieci i status sesji.
- `totalDonated` w nominalnych USDC, `XP`, tier oraz nextTier threshold, bez gwarancji wartości fiat.
- Jedna ikona NFT dla aktualnej ligi, stan `not claimed` vs `claimed`; przycisk claim tylko gdy kwalifikuje się i nie ma tokenu.
- Historia donation eventów z filtrami i linkiem do raportów wpływu dla danego beneficjenta.
- Ustawienia `profilePublic` i `leaderboardOptIn` wyłączone domyślnie; ostrzeżenie o jawności blockchaina.
- Zawieszenie reputacji (w razie incydentu) wyraźnie oznaczone ze ścieżką odwołania, bez usuwania darowizn.

### UX-12/13: organizacje

- Kreator: tytuł, opis, cele, kategoria, cover, capRaw, start/end, docelowy Safe, potwierdzenie Safe ownership i podpisujących.
- Podsumowanie przed submit: publiczny adres zostanie na stałe zapisany na blockchainie; zmiana wymaga nowej kampanii.
- Panel raportów: wersje, hash, dokumenty public/private, status review, wyjaśnienie zakresu weryfikacji.
- Organizacja nie może opublikować własnej kampanii samodzielnie onchain bez weryfikacji admina.

### UX-15/16: admin

- Kolejka wniosków, weryfikacja KYB, niezależny reviewer, stan przed/po, dowód decyzji.
- Generowanie calldata do Safe (bez custodial podpisywania na serwerze), śledzenie statusu Safe Tx i onchain event.
- Zgłoszenia, zawieszenie kampanii, analiza nadużyć, kontrakt pause, reconcile stats, monitoring błędów i ich rozliczanie.
- Wszystkie działania zapisane w `audit_logs` i przypisane do osoby/portfela.

## 5. Acceptance criteria — Gherkin / test IDs

### Kampanie

**AC-01 — publikacja:** GIVEN organizacja `APPROVED` i kampania przeszła 4-eyes review, WHEN admin Safe wywołuje `createCampaign`, THEN `CampaignCreated` istnieje i kampania jest widoczna publicznie dopiero po potwierdzonym evencie.

**AC-02 — niezweryfikowana organizacja:** GIVEN `PENDING`, WHEN żąda publikacji, THEN API 403/409, bez zdarzenia onchain i bez publicznej karty aktywnej.

**AC-03 — niezmienny beneficjent:** GIVEN opublikowana kampania, WHEN admin/organizacja próbuje podmienić Safe, THEN brak takiej operacji onchain; UX podpowiada zamknij i utwórz nową.

**AC-04 — cap:** GIVEN 8 USDC wolnego limitu, WHEN wpłata 9, THEN revert, brak transferu, brak XP; gdy kwota 8, THEN success i reached cap. GIVEN reszta celu = 0.5 USDC, THEN dokładna końcowa wpłata 0.5 przechodzi, lecz 0.4 rewertuje.

**AC-05 — expiry:** GIVEN block.timestamp >= endAt, WHEN `donate`, THEN revert, brak zmiany balansu/statystyk.

**AC-06 — pause/close:** GIVEN kampania PAUSED lub CLOSED, WHEN `donate`, THEN revert; CLOSED nie wraca do ACTIVE.

### Darowizny

**AC-07 — success:** GIVEN 20 USDC balance, zgoda allowance, ACTIVE, cap, WHEN `donate(10 USDC)`, THEN recipient +10 USDC, donor -10 USDC, raised +10, total donor +10 i dokładnie 1 `DonationReceived`.

**AC-08 — approve:** GIVEN allowance=0, WHEN user klika wesprzy, THEN UI prowadzi przez approve i dopiero donate; approve nie zwiększa raised, XP ani historii.

**AC-09 — wrong chain:** GIVEN wallet na Ethereum Mainnet, WHEN user próbuje wpłacić, THEN aplikacja prosi o Arbitrum, bez próby transferu na niewłaściwy chain.

**AC-10 — wrong token:** GIVEN użytkownik ma USDC.e, ale brak native USDC, THEN UI wyjaśnia różnicę, nie przyjmuje USDC.e jako natywnego USDC.

**AC-11 — no gas:** GIVEN brak ETH na Arbitrum, WHEN wallet chce wysłać, THEN czytelny komunikat; brak fałszywego success.

**AC-12 — user reject:** GIVEN podpis odrzucony, THEN checkout wraca do bezpiecznego stanu, nie zapisuje donation.

**AC-13 — duplicate events:** GIVEN indexer ponownie przetwarza ten sam `(chain,tx,logIndex)`, THEN tylko 1 donation i 1 increment do widoku statystyk.

**AC-14 — reorg:** GIVEN potwierdzony lokalnie event zostaje orphaned, THEN status donation zmienia się zgodnie z polityką finalizacji, sumy są przeliczone; raport z niezgodności dostępny adminowi.

**AC-15 — router pause:** GIVEN router paused, THEN `donate` rewertuje; funds of existing beneficiaries remain unchanged.

### Reputacja i NFT

**AC-16 — progi:** GIVEN totalRaw = (0,1,99,100,999,1000,9999,10000,24999,25000,99999,100000)*1e6, THEN tier odpowiednio (0,1,1,2,2,3,3,4,4,5,5,6), XP=raw/100000.

**AC-17 — claim:** GIVEN 1 USDC historycznej wpłaty i brak SBT, WHEN donor `claim`, THEN 1 ERC-721 NFT z `locked=true`, ID zgodnym z adresem.

**AC-18 — transfer zakazany:** GIVEN SBT istnieje, WHEN owner próbuje `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll`, THEN revert.

**AC-19 — dynamiczna liga:** GIVEN minted Supporter i suma przekracza Gold, THEN `tierOf` i tokenURI odzwierciedla Gold, bez nowego NFT.

**AC-20 — burn:** GIVEN owner spala NFT, THEN token przestaje istnieć, XP i historia bez zmian, `claim` ponownie możliwy.

**AC-21 — suspend:** GIVEN procedura nadużycia i autoryzowana multisig, WHEN reputacja zawieszona, THEN `tierOf=0`, event z powodem, wpłaty/USDC niezmienione.

### Raportowanie, prywatność i uprawnienia

**AC-22 — immutable report:** GIVEN wersja raportu PUBLISHED, WHEN organizacja dokonuje korekty, THEN powstaje następna wersja, stary hash i link są nadal dostępne.

**AC-23 — niezależny review:** GIVEN publisher Safe = reviewer Safe, THEN deploy konfiguracji/review nie może otrzymać akceptacji; oddzielne role i log decyzji.

**AC-24 — hash:** GIVEN publiczny raport JSON, THEN SHA-256 kanonicznej treści zgadza się z `contentSha256` onchain; modyfikacja 1 bajtu powoduje mismatch.

**AC-25 — prywatny dokument:** GIVEN użytkownik innej organizacji albo gość, WHEN chce pobrać KYB, THEN 403 oraz brak publicznego URL.

**AC-26 — SIWE replay:** GIVEN podpis z nonce już zużytym lub błędną domeną/chain, WHEN logowanie, THEN 401 i brak sesji.

**AC-27 — public profile:** GIVEN `profile_public=false` i `leaderboard_opt_in=false`, THEN publiczny profil nie pokazuje danych opisowych profilu ani członkostwa w leaderboardzie; UI informuje o publiczności transakcji onchain.

**AC-28 — wallet identity:** GIVEN dwa niezależne portfele tej samej osoby, THEN XP i SBT nie sumują się automatycznie.

**AC-29 — zero fees:** GIVEN skuteczny transfer 10 USDC, THEN beneficjent otrzymuje 10 USDC, a platforma 0 USDC, z wyjątkiem opłaty sieciowej w ETH płaconej przez darczyńcę.

**AC-30 — role change:** GIVEN EOA dewelopera, WHEN próbuje admin action, THEN revert; zmiana uprawnień wymaga multisig Safe i ma log onchain.

### Niefunkcjonalne

**AC-31 — mobile accessibility:** wszystkie kluczowe ekrany działają na 360px i z klawiatury, czytelny focus, alt image i kontrast WCAG AA w audycie UI.

**AC-32 — lokalizacja:** krytyczne ścieżki i komunikaty błędów w PL i EN, bez twardo zakodowanych walut fiat.

**AC-33 — monitoring:** indexer lag lub reconcile mismatch wywołują alarm i nie wyświetlają niezweryfikowanych sum jako finalnych.

**AC-34 — disaster recovery:** udany restore backup na staging, weryfikacja tabel prywatnych i odtworzenie finansowych projekcji ze zdarzeń.

**AC-35 — checkout disclosure:** przed podpisem użytkownik widzi odbiorcę Safe, amount native USDC, fee 0%, gas ETH, brak automatycznych zwrotów, sieć Arbitrum.

## 6. Dodatkowe kryteria wizualne

**AC-36..43** są zdefiniowane w `docs/09-VISUAL-QA-CHECKLIST.md` i są wymagane przy zamykaniu zadań UI. Link do dokumentu jest częścią definicji zakończenia COC-003/003A/040–047.
