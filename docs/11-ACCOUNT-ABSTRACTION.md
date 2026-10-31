# Account Abstraction, embedded wallets i sponsorowanie gasu — CharOnChain (P0)

**Status:** specyfikacja `PROPOSED` (v0.1, 2026-10-31). Elementy dotykające przepływu pieniędzy i budżetu platformy (§5, §6) wymagają akceptacji właściciela i review bezpieczeństwa przed implementacją (`CLAUDE.md` pkt 1, 15).
**Podstawa:** decyzja właściciela z 2026-10-31 — AA, embedded wallets i sponsorowanie gasu są **P0**; zastępuje wykluczenie „smart accounts/gas sponsoring” z README/PRD v1.1.
**Cel produktowy:** CharOnChain ma działać na blockchainie, ale być tak łatwe w obsłudze jak nowoczesna aplikacja internetowa — bez wiedzy o kryptowalutach, gasie, sieciach, `approve` i seed phrase.

## 1. Zakres i zasada nadrzędna

- **Bez zmian w kontraktach** (SC-1.0, `ICharOnChain.sol`): analiza w `docs/02` §9 i `docs/10` §6.1. Cała funkcjonalność AA mieści się w warstwie konta, bundlera, paymastera, aplikacji i indexera.
- **Nie budujemy:** własnego bundlera, własnej infrastruktury przechowywania kluczy, własnych kontraktów kont, własnego tokena. Używamy sprawdzonych, audytowanych rozwiązań (ADR-007).
- **Darowizny nadal trafiają bezpośrednio do zatwierdzonego Safe organizacji** (INV-02). Konto użytkownika jest wyłącznie `msg.sender`.
- **Poza zakresem (wymaga osobnej zgody):** on-ramp fiat (`docs/12`, tylko propozycja), łączenie portfeli/migracja reputacji (ADR, `CLAUDE.md` pkt 8), płatność gasu w USDC, klucze sesyjne, płatności cykliczne, EIP-7702 jako domyślna ścieżka (ADR-010).

## 2. Dwa tryby

| | **Beginner (domyślny)** | **Advanced** |
|---|---|---|
| Wejście | Google, Apple, e-mail, passkey (bez SMS jako jedynego czynnika) | MetaMask, Rabby, WalletConnect, inne portfele (wagmi) |
| Portfel | tworzony automatycznie; smart account ERC-4337 sterowany kluczem embedded | portfel użytkownika (EOA lub smart wallet) |
| Gas | **sponsorowany** przez paymaster CharOnChain wg polityki §6 | standardowo ETH użytkownika; sponsoring tylko jeśli portfel wspiera ERC-5792 `paymasterService` i polityka §6 |
| `approve` + `donate` | jedna autoryzacja (batch w koncie) | batch, gdy portfel zgłasza `atomic` (ERC-5792); w przeciwnym razie dwa kroki jak w `docs/04` §3 |
| Wiedza wymagana | brak; żargon ukryty w „Szczegółach” | pełna kontrola; komunikaty techniczne dozwolone |
| Tożsamość on-chain | adres smart accounta | adres portfela |

**Reguły wspólne:** tryby tworzą **oddzielne tożsamości** (AC-28, `CLAUDE.md` pkt 8) — interfejs mówi to wprost przy przełączaniu (AC-62). Konto Beginner można wyeksportować/wykorzystać w Advanced tylko w zakresie, który zapewnia dostawca (§4, M4). Tryb Advanced nigdy nie jest wymagany.

## 3. Architektura

```
Przeglądarka (Next.js, wagmi/viem)
  ├─ WalletProvider (interfejs wewnętrzny): login, signer, smart account client, capabilities
  ├─ Builder operacji: callData z DANYCH ZWERYFIKOWANYCH (Registry.getCampaign, Router.usdc) — nie z UI
  ├─ Guard „what you see is what you sign”: dekoduje callData i porównuje z ekranem przed podpisem
  └─ UserOperation ─► Paymaster Policy Service (PDP) ─► [podpis paymastera dostawcy / verifying paymaster]
                       │ ERC-7677: pm_getPaymasterStubData / pm_getPaymasterData
                       ▼
                    bundler ─► EntryPoint ─► konto ─► USDC.approve(Router, X) ─► Router.donate(id, X) ─► Safe
Indexer: DonationReceived (chain_events) + UserOperationEvent/UserOperationRevertReason (user_operations)
```

- **PDP (Paymaster Policy Service)** to kod CharOnChain. Każda operacja do sponsorowania musi przejść PDP **zanim** paymaster podpisze. Jeśli dostawca oferuje własny silnik reguł, jest on warstwą dodatkową, nie zamiennikiem (M3).
- Klucz podpisujący paymastera: wyłącznie w KMS/HSM dostawcy lub zarządzany przez sprawdzone rozwiązanie; **nie** w zmiennych środowiskowych serwera aplikacji. Depozyt w EntryPoint zasilany wyłącznie z Safe (multisig).
- Wersja EntryPoint i adresy fabryk/implementacji kont trafiają do **manifestu środowiska** (COC-002) po weryfikacji on-chain na 42161 i 421614.

## 4. Wymagania wobec dostawcy (kryteria ADR-007)

**Bramki (MUST):**

| ID | Wymaganie |
|---|---|
| M1 | Arbitrum One (42161) i Arbitrum Sepolia (421614) dla portfeli, bundlera i paymastera |
| M2 | ERC-4337 (EntryPoint v0.7+), standardowe, audytowane konto; podpisy ERC-1271 i kompatybilność z ERC-6492 |
| M3 | Kontrola polityki sponsorowania po stronie CharOnChain (PDP widzi pełną UserOperation; domyślne odrzucenie; brak „sponsoruj wszystko”) |
| M4 | Model **non-custodial**: dostawca sam nie może podpisać za użytkownika; odzyskiwanie konta **bez zmiany adresu**; eksport klucza/signera i opis tego, co on daje |
| M5 | Integracja z Next.js App Router, wagmi i viem przez standardowy provider/konto (bez zamkniętego formatu transakcji) |
| M6 | Możliwość wyłączenia kluczy sesyjnych i automatycznego podpisywania |
| M7 | Logowanie: Google, Apple, e-mail, passkey |
| M8 | Dowody bezpieczeństwa: audyty/pentesty, SOC 2 lub równoważne, historia incydentów; DPA/RODO, rezydencja danych |
| M9 | Środowisko testowe zachowujące się jak produkcyjne |

**Pożądane (SHOULD):** łączenie metod logowania bez zmiany adresu; wsparcie EIP-7702; webhooki/obserwowalność; własna marka ekranu logowania; przenośność (wyjście do innego dostawcy bez utraty konta); koszt przy 1 tys./10 tys./100 tys. MAU; SLA i limity.

## 5. Niezmienniki AA (INV-AA)

| ID | Niezmiennik |
|---|---|
| INV-AA-01 | **Atrybucja:** darowizna, XP i SBT należą do `msg.sender` routera = adres konta. Adres paymastera, bundlera, signera EOA lub platformy nigdy nie otrzymuje kredytu |
| INV-AA-02 | **Autoryzacja:** każda darowizna wymaga świeżego podpisu użytkownika pod operacją, której zdekodowana treść = dokładnie `[USDC.approve(Router, X), Router.donate(id, X)]` (lub samo `donate`, gdy allowance wystarcza) z wartościami pokazanymi na ekranie. **Zakaz** kluczy sesyjnych, stałych zgód (ERC-7715), płatności cyklicznych i operacji bez gestu użytkownika |
| INV-AA-03 | **Cel środków:** `approve.spender == Router`; `approve.amount == donate.amount`; po operacji `allowance(konto, Router) == 0`; `donate.amount ≤ pozostały cap`; beneficjent pochodzi z `CampaignRegistry`, nie z UI |
| INV-AA-04 | **Zakres sponsorowania:** paymaster podpisuje wyłącznie operacje spełniające §6.1; wszystko inne → odrzucenie (fail-closed) |
| INV-AA-05 | **Fail-closed:** awaria bundlera/paymastera/dostawcy, brak budżetu lub kill switch ⇒ operacja nie jest wysyłana, żadne USDC nie opuszcza konta, UI pokazuje stan i bezpieczne ponowienie. Brak cichego przełączenia na płatność gasu ze środków użytkownika |
| INV-AA-06 | **Idempotencja:** `userOpHash` unikalny w `user_operations` i ledgerze sponsorowania; klucz dedupe darowizny `(chain_id, tx_hash, log_index)` bez zmian; XP wyłącznie z `totalDonatedRaw` routera; replay chroni nonce konta (EntryPoint) |
| INV-AA-07 | **Ryzyko platformy:** jedyne środki platformy narażone przez AA to depozyt paymastera; ograniczone budżetem (§6.3); zasilanie tylko z Safe |
| INV-AA-08 | **Brak custody:** CharOnChain nie przechowuje kluczy użytkowników ani nie podpisuje w ich imieniu |
| INV-AA-09 | **Sesja:** SIWE potwierdza kontrolę nad adresem konta (ERC-1271/6492); sesja nie jest zgodą na transfer ani na sponsorowanie (`docs/03` §5 pkt 5) |
| INV-AA-10 | **Stabilność adresu:** odzyskanie dostępu, zmiana urządzenia i rotacja klucza nie zmieniają adresu konta; jeśli model odzyskiwania dostawcy wymaga nowego adresu, jest odrzucany (migracja reputacji jest poza MVP) |

## 6. Polityka sponsorowania (Paymaster Policy)

### 6.1 Allowlista — operacja jest sponsorowana tylko, gdy **wszystkie** warunki są spełnione

1. `chainId` ∈ skonfigurowane środowisko; EntryPoint = zatwierdzona wersja z manifestu.
2. `sender` to konto wdrożone lub tworzone przez **zatwierdzoną fabrykę** z **zatwierdzoną implementacją** (`initCode` inaczej → odrzucenie). Sponsorowane jest wyłącznie wdrożenie *własnego* konta użytkownika.
3. `callData` zdekodowany w całości (także batch i zagnieżdżone wywołania); każde wywołanie ∈ tabeli poniżej; `value == 0`; brak `delegatecall`; brak dodatkowych wywołań w batchu.
4. Limity gazu (`callGasLimit`, `verificationGasLimit`, `preVerificationGas`, ceny) ≤ progi konfiguracyjne.
5. Symulacja operacji przed podpisem paymastera: brak revertu, wynik zgodny ze stanem rejestru (kampania ACTIVE, w oknie czasu, miejsce w cap).
6. Budżety i limity z §6.3 niewyczerpane; kill switch wyłączony.
7. Podpis paymastera obejmuje hash konkretnej operacji i krótkie okno ważności (`validUntil` rzędu minut) — nie może być użyty do innej operacji.

| Cel | Funkcja | Warunki |
|---|---|---|
| USDC (natywny, z manifestu) | `approve(spender, amount)` | `spender == Router`; `amount == donate.amount` w tej samej operacji; `amount > 0` |
| `DonationRouter` | `donate(campaignId, amountRaw)` | kampania istnieje i jest ACTIVE; `amountRaw` zgodna z regułami routera |
| `ReputationSBT` | `claim()` | osobna operacja (nie w batchu z `donate`); konto spełnia `NotEligible`-check w symulacji |
| `ReputationSBT` | `burn()` | decyzja do zatwierdzenia (domyślnie **tak**, z limitem z §6.3) |

**Jawnie zabronione:** `transfer`/`transferFrom` USDC, `approve` do innego spendera, nieskończone `approve`, wywołania innych kontraktów, ETH, `delegatecall`, wdrażanie kontraktów poza kontem, operacje na EntryPoint inne niż standardowe.

**Dlaczego `claim` nie jest w batchu z `donate`:** `docs/02` §2 — „problem odznaki nie może blokować płatności”. Wspólny batch jest atomowy: revert `claim` cofnąłby darowiznę.

### 6.2 Wartości początkowe (propozycje do zatwierdzenia, konfigurowalne, nie stałe w kodzie)

- Operacje sponsorowane na konto: ≤ 10 / 24 h; `claim`+`burn` ≤ 3 / 30 dni (blokuje pętlę `claim→burn→claim`, która drenowałaby budżet).
- Limit gazu na operację: ustalany z benchmarku COC-015 (nie zgadujemy liczb).
- Limity per IP/urządzenie i ochrona anty-botowa przy rejestracji (z minimalizacją danych, `docs/03` §8).
- Pierwsza operacja (wdrożenie konta) liczona do limitów.

### 6.3 Budżet, monitoring, awaryjne wyłączenie

- Budżet globalny (dobowy/miesięczny) i per konto — wartości wyznacza właściciel. Przekroczenie ⇒ odmowa (AC-52), alert, komunikat użytkownikowi.
- Kill switch `system_flags.sponsorship_enabled` + automatyczne wyłączenie przy anomalii (skok kosztu, wskaźnik revertów, dren depozytu).
- Alerty: saldo depozytu < próg, niezgodność ledger ↔ `UserOperationEvent`, wzrost odrzuceń, nietypowe wzorce (krąg dawca↔Safe, duża liczba nowych kont z jednego źródła).
- **Ryzyko rezydualne:** sponsorowanie gasu obniża koszt farmienia XP. Mitygacje: limity, monitoring grafu przepływów, KYB organizacji, polityka zawieszeń (`docs/01` pkt 11).

## 7. Przepływy użytkownika (Beginner)

| | Przepływ | Zachowanie |
|---|---|---|
| F1 | **Rejestracja/logowanie** | wybór metody → dostawca tworzy sesję i signer → obliczenie adresu konta (kontrfaktyczny) → SIWE (§8) → sesja HttpOnly. Brak e-maila w naszej bazie |
| F2 | **Utworzenie portfela** | automatyczne; ekran „Twoje konto” bez słów seed/gas/chain; adres w „Szczegółach”; zachęta (nie blokada) do skonfigurowania odzyskiwania |
| F3 | **Zasilenie USDC** | ekran UX-21: adres + QR, **tylko natywne USDC w sieci Arbitrum One**, ostrzeżenie o USDC.e/innych sieciach, wykrycie wpłaty po polityce potwierdzeń, na testnecie faucet tylko na Sepolia. Przycisk „Kup USDC” = **nie zaimplementowany** (`docs/12`) |
| F4 | **Darowizna** | kwota (presety 5/10/25/100 lub własna) → ekran przeglądu → „Autoryzuj” (passkey/biometria/potwierdzenie dostawcy) → postęp → potwierdzenie |
| F5 | **Potwierdzenie** | strona `/donations/[id]` po `userOpHash` **lub** `txHash`; pokazuje stan z indexera, nie z optymizmu UI |
| F6 | **Punkty i odznaki** | po `TX_CONFIRMED` XP/liga z projekcji (z fallbackiem na odczyt z kontraktu). Odznakę odbiera osobnym, sponsorowanym gestem „Odbierz odznakę” (opt-in, ADR-004) |
| F7 | **Odzyskiwanie** | UX-23: opis czynników odzyskiwania, urządzenia, eksport portfela z ostrzeżeniem; adres po odzyskaniu niezmieniony (INV-AA-10) |
| F8 | **Advanced** | UX-24: wybór portfela; wykrycie capabilities (`wallet_getCapabilities`); fallback do dwóch kroków |
| F9 | **Awarie** | dostawca niedostępny, brak budżetu, operacja odrzucona, revert wewnętrzny, wygasła kampania, cap race — komunikat „co zrobić teraz”, bez fałszywego sukcesu |

### Maszyna stanów checkoutu — rozszerzenie `docs/04` §3 (ścieżka AA)

`IDLE → PREPARING_OP → SPONSORSHIP_CHECK → REVIEW → AWAITING_AUTHORIZATION → OP_SUBMITTED → OP_INCLUDED → TX_CONFIRMED → SUCCESS`

Stany końcowe dodatkowe: `SPONSORSHIP_DENIED`, `SPONSORSHIP_UNAVAILABLE`, `AUTH_REJECTED`, `OP_DROPPED`, `OP_REVERTED` (operacja dołączona, ale wywołanie wewnętrzne zrewertowane — sprawdzane przez `UserOperationEvent.success == false`), `PROVIDER_UNAVAILABLE`, `CAMPAIGN_CLOSED`, `CAP_REACHED`. **`OP_INCLUDED` ≠ sukces.** Sukces tylko po zdarzeniu `DonationReceived` potwierdzonym wg polityki indexera.

## 8. Uwierzytelnianie: SIWE + EIP-1271 + ERC-6492

1. `POST /auth/nonce` jak dotąd (`address` = adres konta, także niewdrożonego).
2. Podpisuje signer konta; podpis może mieć postać: EOA, ERC-1271 (konto wdrożone) lub **ERC-6492** (konto jeszcze niewdrożone — typowy przypadek przy pierwszym logowaniu).
3. `POST /auth/verify`: serwer weryfikuje domenę/URI/chain/nonce/czas oraz podpis przez wywołanie na właściwej sieci; dla 6492 wyłącznie z **zatwierdzonymi fabrykami** (symulacja `eth_call` wykonuje kod fabryki — nieznane fabryki mogą wywołać kosztowne lub złośliwe ścieżki). Zbyt długi/kosztowny `eth_call` ⇒ 401.
4. Wynik ważności 1271 zależy od stanu konta (rotacja właściciela) — sesje są krótkie i odnawiane, uprawnienia wrażliwe sprawdzane ponownie.
5. Implementacja oparta na bibliotece (viem `verifyMessage`/`verifySiweMessage` — **obsługa 6492 do potwierdzenia w COC-073**), bez własnego parsera podpisów.
6. AC-26 obowiązuje bez zmian (replay, domena, chain → 401).

## 9. Dane, API, indexer (propozycja rozszerzenia `docs/03`)

**Tabele (wszystkie zapisy tylko przez zaufany backend/indexer; RLS deny-by-default):**

| Tabela | Cel |
|---|---|
| `wallet_accounts` | `(chain_id, account_lower)` PK, `kind` (`EOA`/`SMART_4337`/`EOA_7702`), `factory_lower`, `implementation_lower`, `created_at`. **Bez** e-maila i identyfikatorów społecznościowych |
| `user_operations` | `user_op_hash` PK, `chain_id`, `sender_lower`, `nonce`, `status` (`PREPARED/SUBMITTED/INCLUDED/REVERTED/DROPPED/CONFIRMED/ORPHANED`), `tx_hash`, `log_index_range`, `success`, `revert_reason`, `sponsored bool`, timestamps |
| `sponsorship_decisions` | append-only: `user_op_hash`, `sender_lower`, `decision` (`ALLOW/DENY`), `reason_code`, `policy_version`, `decoded_calls jsonb`, `est_cost_wei numeric(78,0)`, `created_at` |
| `sponsorship_budgets` | okres, limit, wydano (`numeric(78,0)`), wskaźniki per konto |

`donations` rozszerzyć o `user_op_hash` (nullable, wyznaczany przez dopasowanie logów w tej samej transakcji do najbliższego następnego `UserOperationEvent` z tym samym `sender` — **reguła do sprecyzowania i przetestowania w COC-074**).

**API (nowe):** `POST /api/v1/aa/paymaster` (JSON-RPC wg ERC-7677; sesja lub token rejestracji; rate-limit; wynik zawsze logowany w `sponsorship_decisions`), `GET /api/v1/aa/user-operations/:userOpHash` (status), `GET /api/v1/health/sponsorship` (admin: budżet, depozyt, odrzucenia). **`POST /api/v1/donations` nadal nie istnieje.** Endpoint paymastera **nie tworzy wpłat** i nie zleca przelewów.

**Indexer:** oprócz `DonationReceived` śledzi `UserOperationEvent`/`UserOperationRevertReason` dla `sender ∈ wallet_accounts` lub naszego paymastera; rekoncyliacja kosztu rzeczywistego z ledgerem i salda depozytu EntryPoint; ta sama obsługa reorgów (`ORPHANED`).

## 10. Ekrany i komponenty (nowe względem `docs/04` §2)

| ID | Ekran | Dostęp |
|---|---|---|
| UX-19 | Logowanie / rejestracja (Google, Apple, e-mail, passkey; link „Mam już portfel”) | public |
| UX-20 | „Twoje konto” — wyjaśnienie bez żargonu, stan odzyskiwania | SIWE |
| UX-21 | Zasil konto USDC (adres, QR, ostrzeżenia, stan wpłaty; „Kup USDC” zablokowane flagą) | SIWE |
| UX-22 | Przegląd i autoryzacja darowizny (kwota, odbiorca, opłata, brak zwrotów) | SIWE |
| UX-23 | Bezpieczeństwo i odzyskiwanie (urządzenia, czynniki, eksport) | SIWE |
| UX-24 | Tryb zaawansowany / wybór portfela | public |

Zmieniane: UX-04 (dwa tryby), UX-05 (po `userOpHash`), UX-08 (claim sponsorowany). Nowe komponenty `packages/ui`: `OnboardingFlow`, `FundAccountPanel`, `AuthorizeDonationSheet`, `RecoveryStatus`, `SponsoredFeeNotice`, `ModeSwitcher`, `OperationStatus`.

**Copy (zależne od trybu; dopuszczalne po akceptacji przez UX/legal):**
- Beginner: „Opłatę sieciową pokrywa CharOnChain. Nie pobieramy obowiązkowej prowizji. Jeśli pokrywanie opłat zostanie wstrzymane, darowizna nie zostanie wysłana, a Twoje środki pozostaną na koncie.”
- Advanced: „Opłatę sieciową w ETH płacisz Ty (chyba że Twój portfel korzysta ze sponsorowania).”
- Zawsze: odbiorca (organizacja + skrócony Safe), kwota w USDC, brak automatycznych zwrotów, ryzyko USDC (AC-35). Zakaz „za darmo na zawsze”, fałszywej pilności i zawstydzania małych wpłat.

## 11. Testy

- **Foundry:** donor = konto ERC-4337 (fixture EntryPoint), donor = EOA z delegacją 7702 (jeśli ADR-010 włączy), `claim` z konta kontraktowego, brak stałego allowance po batchu, brak kredytowania adresu paymastera/bundlera; fuzz kwot z kontami kontraktowymi.
- **Polityka (jednostkowe + fuzz dekodera):** korpus „złotych” operacji — dozwolone / odrzucone / zniekształcone: `transfer`, `approve` do obcego spendera, nieskończone `approve`, `amount` rozbieżne, `value>0`, `delegatecall`, batch z dodatkową operacją, zagnieżdżony batch, nieznana fabryka/implementacja, wygórowane limity gazu, kampania nieaktywna, replay, wygasłe okno.
- **Integracyjne:** lokalny EntryPoint + bundler (narzędzie do wyboru w COC-070/078) + paymaster; indexer z `UserOperationEvent`; duplikaty, reorgi, odrzucone operacje.
- **E2E (Playwright, Sepolia + środowisko testowe dostawcy):** AC-44..63. **Chaos:** niedostępny dostawca/bundler/RPC, wyczerpany budżet, porzucona operacja, revert wewnętrzny, podwójne zgłoszenie, restart indexera w trakcie.
- **Test użyteczności (AC-63):** ≥5 osób bez doświadczenia z krypto — wyniki realne, udokumentowane.

## 12. Kryteria akceptacji AC-44..AC-63

| ID | Kryterium |
|---|---|
| **AC-44** | GIVEN użytkownik bez rozszerzenia portfela, WHEN rejestruje się (e-mail/Google/Apple/passkey), THEN powstaje smart account powiązany z sesją; brak ekranów seed/gas/sieć; `wallet_accounts.kind = SMART_4337` |
| **AC-45** | GIVEN konto z USDC i 0 ETH, WHEN autoryzuje darowiznę, THEN darowizna kończy się sukcesem; saldo ETH konta = 0 przed i po; depozyt paymastera maleje o koszt rzeczywisty |
| **AC-46** | THEN saldo Safe beneficjenta rośnie dokładnie o `amountRaw`; żaden adres pośredni nie zmienia salda poza dawcą; platforma 0 USDC |
| **AC-47** | THEN `DonationReceived.donor == adres konta`; `totalDonatedRaw`, XP i `tierOf` liczone dla konta; `tokenId = uint160(konto)`; brak kredytu dla signera/paymastera/bundlera |
| **AC-48** | GIVEN Advanced z MetaMask (ETH + USDC), WHEN darowizna standardowym `approve → donate`, THEN sukces; tożsamość = EOA, niezależna od ewentualnego smart accounta (AC-28) |
| **AC-49** | GIVEN operacja zawierająca jakiekolwiek wywołanie spoza allowlisty §6.1 (inny cel/spender, nieskończone `approve`, `value>0`, `delegatecall`, dodatkowe wywołanie w batchu, nieznana fabryka, zawyżony gaz), THEN paymaster nie podpisuje, brak zużycia gazu, decyzja `DENY` z `reason_code` w `sponsorship_decisions` |
| **AC-50** | GIVEN ta sama operacja zgłoszona dwukrotnie, powtórne przetwarzanie logów lub reorg, THEN 1 wiersz `donations`, XP raz (z routera), 1 wpis ledgera na `userOpHash` |
| **AC-51** | GIVEN awaria bundlera/paymastera/dostawcy auth, THEN UI w stanie nie-sukces z krokiem naprawczym; brak wysłanej operacji bez ważnych danych paymastera; USDC nie opuszcza konta; ponowienie bezpieczne (idempotentne) |
| **AC-52** | GIVEN wyczerpany budżet (globalny/konto) lub kill switch, THEN darowizna nie jest wysyłana, użytkownik poinformowany, środki nietknięte, alert operatora; ścieżka Advanced pozostaje dostępna |
| **AC-53** | THEN każda darowizna wymaga świeżej autoryzacji pod widoczną kwotą i odbiorcą; po operacji `allowance(konto, Router) == 0`; brak kluczy sesyjnych/stałych zgód |
| **AC-54** | GIVEN zmanipulowany stan UI/odpowiedź API, WHEN builder składa operację, THEN guard wykrywa niezgodność dekodowanego `callData` z pokazaną kwotą/kampanią/beneficjentem (z rejestru on-chain) i przerywa **przed** prośbą o podpis |
| **AC-55** | THEN logowanie SIWE działa dla konta niewdrożonego (ERC-6492) i wdrożonego (ERC-1271); zły podpis, zużyty nonce, zła domena/chain, nieznana fabryka → 401 |
| **AC-56** | GIVEN operacja dołączona, ale `donate` zrewertowało (cap race, pauza, wygaśnięcie), THEN UI pokazuje porażkę; brak XP i wiersza darowizny; koszt zapisany w ledgerze; użytkownik nie jest obciążony |
| **AC-57** | THEN ekran zasilenia pokazuje wyłącznie Arbitrum One + natywne USDC; wpłata USDC.e/inna jest wykryta i wyjaśniona jako niewspierana; faucet tylko na Sepolia |
| **AC-58** | GIVEN utrata urządzenia, WHEN użytkownik odzyskuje dostęp skonfigurowanymi czynnikami, THEN adres konta, XP i SBT bez zmian; próba odzyskania bez czynnika kończy się porażką; eksport z ostrzeżeniem (zależne od dostawcy, test na środowisku testowym) |
| **AC-59** | THEN `claim` jest osobną, sponsorowaną operacją; porażka `claim` nie wpływa na darowiznę; pętla `claim/burn` jest limitowana |
| **AC-60** | THEN komunikaty o opłatach odpowiadają trybowi (§10) i nie obiecują bezterminowego sponsorowania |
| **AC-61** | THEN żadna ścieżka kodu nie tworzy UserOperation bez gestu użytkownika; konfiguracja dostawcy ma wyłączone klucze sesyjne/auto-podpis (test konfiguracji) |
| **AC-62** | THEN przełączenie Beginner↔Advanced pokazuje, że to oddzielne profile; brak automatycznego łączenia XP/SBT |
| **AC-63** | THEN ≥5 osób bez wiedzy o krypto kończy ścieżkę rejestracja → zasilenie → darowizna bez pomocy; wynik zapisany (rozszerza AC-43) |

## 13. Backlog

Epik **E6 (COC-070..079, COC-063)** oraz zmiany w istniejących zadaniach: `docs/06`. Kolejność: 070 (ADR-007 + spike) → 071 → 072/073/074 → 075/076/077 → 078 → 063.

## 14. Referencje i otwarte decyzje

**Referencje — NIEZWERYFIKOWANE w tej sesji (hosty zablokowane); sprawdzić przed implementacją:** ERC-4337 (EntryPoint v0.7/v0.8, oficjalne adresy i ich wdrożenie na 42161/421614), ERC-1271, ERC-6492, ERC-7677, ERC-5792, ERC-7821, EIP-7702 (aktywacja na Arbitrum One/Sepolia), dokumentacja viem (`verifyMessage`, `verifySiweMessage`, moduł `account-abstraction`), dokumentacje dostawców z ADR-007. Częściowo potwierdzone z GitHub: natywne USDC Circle (`FiatTokenV2_2`) ma `permit` (ERC-2612) i `transferWithAuthorization` (ERC-3009) z podpisami ERC-1271 — nieużywane w MVP (`docs/02` §7); wersja wdrożona na Arbitrum **niezweryfikowana**.

**Otwarte decyzje (właściciel):** ADR-007 dostawca; ADR-008 wartości budżetów/limitów i `burn` w allowliście; ADR-009 tożsamość przy wielu metodach logowania; ADR-010 EIP-7702; ADR-110 status prawny embedded wallets (custody/CASP, RODO — dostawca jako procesor); fallback płatności gasu w USDC (poza MVP); finansowanie paymastera na mainnet (bramka).
