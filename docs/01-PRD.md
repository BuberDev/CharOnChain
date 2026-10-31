# PRD — CharOnChain (MVP v1.2 — Account Abstraction P0)

> **Zmiana v1.2 (2026-10-31, decyzja właściciela):** platforma ma być dostępna dla osób bez wiedzy o kryptowalutach. Account Abstraction, embedded wallets i sponsorowanie gasu są **P0**. Specyfikacja: `docs/11-ACCOUNT-ABSTRACTION.md`. Kontrakty (SC-1.0) bez zmian.

**Właściciel produktu:** do ustalenia  
**Status:** specyfikacja wdrożeniowa (nie wdrożenie)  
**Obszar prawny:** założony pilotaż Polska/UE, wymagający opinii prawnej przed mainnetem  
**Języki:** PL i EN

## 1. Wizja

CharOnChain umożliwia darczyńcy znalezienie wiarygodnej kampanii, przekazanie natywnego USDC na Arbitrum do portfela wielopodpisowego zweryfikowanej organizacji, publiczne sprawdzenie przepływu środków oraz uzyskanie niezbywalnej odznaki i punktów reputacji. Organizacja publikuje rozliczenia i dowody rezultatów, a platforma rozróżnia potwierdzenie płatności od potwierdzenia efektu pomocy.

**Obietnica produktu:** „Każda darowizna. Pełna przejrzystość.” — jako kierunek marketingowy, nie gwarancja nieomylnej weryfikacji wszystkich wydatków.

## 2. Problem i użytkownicy

- **Darczyńca:** nie wie, czy kampania jest prawdziwa ani co stało się ze środkami; chce prostego checkoutu, historii wsparcia i społecznego uznania.
- **Fundacja / organizacja non-profit:** chce przyjmować środki w krypto bez ich powierzenia operatorowi platformy, mieć panel kampanii i sposób raportowania.
- **Operator i niezależny recenzent:** muszą wykluczać fikcyjne kampanie, rozpatrywać nadużycia, pilnować weryfikacji dowodów.
- **Publiczny obserwator:** chce prześledzić historię wpłat i publicznych raportów bez konieczności logowania.

## 3. Cele i mierniki

### Cele pierwszego pilotażu (wartości docelowe, nie prognoza)

- 3–5 niezależnych, zweryfikowanych organizacji; minimum 5 aktywnych kampanii.
- >=95% pomyślnie zaindeksowanych finalizowanych eventów w <2 min od skonfigurowanej liczby potwierdzeń (SLO operacyjny).
- 100% publicznych kwot z endpointów potwierdzalnych na chainie.
- 100% fundacji w pilotażu z beneficjentem Safe o zweryfikowanych właścicielach i progu podpisów >=2.
- >=80% zamkniętych kampanii z opublikowanym raportem w 30 dni; brak raportu oznaczony publicznie.
- Mierzyć: wallet connect -> rozpoczęcie płatności -> podpis -> transakcja on-chain -> potwierdzenie; cohort repeat donor 30/90 dni; wskaźnik reklamacji; raportowanie.
- Lejek Beginner (v1.2): rejestracja -> utworzenie konta -> zasilenie USDC -> autoryzacja darowizny -> potwierdzenie; odsetek operacji odrzuconych przez politykę sponsorowania; koszt sponsorowanego gasu na darowiznę i na aktywnego użytkownika; odsetek udanych odzyskań konta. Wartości docelowe ustala właściciel po benchmarku (nie zgadujemy).

### Poza celami

Nie optymalizujemy pod wartość spekulacyjną NFT, nie oferujemy zwrotu z darowizn, yield, stakingu ani wymiany punktów na pieniądze.

## 4. Decyzje produktowe i zasady

1. USDC Circle native na Arbitrum (production chain ID 42161); na testnecie mock ERC-20 o 6 miejscach lub oficjalny token testowy po potwierdzeniu adresu.
2. Darowizna nie jest depozytem platformy. `DonationRouter` bezpośrednio przenosi USDC z portfela darczyńcy do zatwierdzonego portfela Safe organizacji; brak admin withdrawals.
3. Jeden portfel Safe beneficjenta na kampanię, **niezmienialny po utworzeniu**. Zmiana odbiorcy wymaga zamknięcia i założenia nowej kampanii z jasnym komunikatem.
4. Zamknięty katalog kampanii: tworzy je wyłącznie operator po weryfikacji organizacji. Rejestr kampanii na chainie, drafty w bazie.
5. Kwota docelowa jest **twardym limitem** w USDC; brak nadpłat. Jeśli pozostało mniej niż kwota wpisana przez darczyńcę, transakcja ma zrevertować, a frontend proponuje dopuszczalną resztę.
6. Kampania ma przedział [startAt, endAt). Po zakończeniu nie można dokonać wpłaty, raporty nadal działają.
7. Brak automatycznych refundów; transakcja do fundacji jest nieodwracalna po finalizacji. Pomyłki oraz potencjalne nadużycia podlegają procedurze poza kontraktem i decyzji odbiorcy/prawników, a nie „przyciskowi Cofnij”.
8. Reputacja liczy **nominalne USDC wpłacone** przez router. USDC może utracić peg do USD; w razie silnego depegu operator ma możliwość awaryjnego pauzowania. UX nie przedstawia zawsze 1 USDC jako gwarantowanego 1 USD.
9. Publiczne rankingi wyłącznie opt-in. Historia transakcji portfela pozostaje publiczna niezależnie od ustawień profilu.
10. Dowód wpływu: on-chain potwierdza przesłanie środków i publikację hashy publicznych raportów, **nie** wykonanie celu w świecie rzeczywistym.
11. Punkty/nagrody nie są zbywalne ani wymienialne, brak cash reward. Brak antysybilowej gwarancji; operator oznacza anomalie i może zawiesić punkty w UI wg jawnej polityki. Zawieszenia on-chain tylko z audytowalnym powodem i uprawnieniami multisig.

## 5. Funkcje P0 — muszą działać w MVP

### A. Publiczny katalog i kampania
- Lista kampanii z wyszukiwaniem po tytule, filtrami: kategoria, status, organizacja; sortowanie najnowsze, progres, kwota.
- Karta: zdjęcie, tytuł, beneficjent, badge zweryfikowany, zebrano/limit, termin, lista dowodów, publiczny adres Safe.
- Publiczna strona kampanii ze zdarzeniami wpłat, historią raportów, informacją o ryzyku i linkami do Arbiscan.
- Żadnych sztucznych liczników, opinii, terminów ani predefiniowanych „darowizn od ostatniej minuty”.

### B. Crypto checkout
- Connect wallet / rozpoznanie chain, sprawdzenie native USDC balance, ETH gas, ERC-20 allowance.
- Presety 5, 10, 25, 100 USDC oraz dowolna kwota >= 1 USDC, <= pozostały limit. Wyjątek: końcowa wpłata może być mniejsza od 1 USDC, jeżeli dokładnie wyczerpuje resztę limitu (ochrona przed zablokowaniem celu przez „dust”).
- Tryb `approve` (wymagany, jeśli allowance niewystarczający) -> `donate` -> oczekiwanie na status -> sukces/niepowodzenie.
- Przed podpisaniem: kwota, sieć, odbiorca, 0% prowizji i orientacyjny gas. Informacja o braku automatycznych zwrotów.
- Przed eventem potwierdzonym nie wyświetlaj wpłaty jako zakończonej; obsłuż odrzucenie, zmianę chain, brak gazu, blokadę tokenu, expiry, cap race, RPC offline.

- **Dwa tryby** (szczegóły: `docs/11` §2). Opisany wyżej przepływ `connect → allowance → approve → donate` dotyczy trybu **Advanced**. W trybie **Beginner** darczyńca wybiera kwotę i autoryzuje jedną operację (batch `approve`+`donate` w koncie), bez widoku gasu, sieci i `approve`. Wymagania ujawnienia (AC-35) pozostają, wyrażone prostym językiem.

### C. Tożsamość darczyńcy i nagrody
- SIWE bez konieczności podawania e-maila; tworzenie profilu po pierwszym podpisie.
- Historia darowizn (z chaina), suma nominalnego USDC, XP, obecna liga, postęp do kolejnej.
- Po >=1 USDC użytkownik może `claim()` darmowego w znaczeniu braku opłaty platformy SBT. W trybie **Beginner** opłatę sieciową pokrywa platforma (sponsorowana, osobna operacja, z limitami — `docs/11` §6); w trybie **Advanced** gas płaci użytkownik, chyba że jego portfel korzysta ze sponsorowania.
- SBT nigdy nie jest zbywalny; jeden token na portfel. Widok w aplikacji korzysta z chaina, niezależnie od cache NFT marketplace.
- Opcja spalenia własnego SBT (bez zmiany zdarzeń darowizny), ponowne odebranie po decyzji użytkownika.
- Ustawienie publiczny/niepubliczny profil; wyłączenie uczestnictwa w leaderboardzie.

### C2. Dostępność dla osób bez wiedzy o krypto (P0, v1.2)
- **Beginner (domyślny):** rejestracja przez Google, Apple, e-mail lub passkey; automatyczne utworzenie bezpiecznego portfela embedded i smart accounta; sponsorowanie opłat przez Paymaster **wyłącznie** dla operacji CharOnChain, z limitami, budżetem i ochroną przed nadużyciami; `approve`+`donate` jako jedna autoryzacja; odznaka SBT bez osobnej opłaty dla darczyńcy; odzyskiwanie konta, przejrzysta kontrola nad kluczami i eksport portfela (w zakresie, który zapewnia wybrany dostawca).
- **Advanced:** MetaMask, Rabby, WalletConnect i inne portfele; standardowy przepływ lub AA tam, gdzie portfel to wspiera; pełna kontrola użytkownika.
- **Niezmienne zasady:** darowizny nadal trafiają bezpośrednio do zatwierdzonego Safe; każda darowizna wymaga świadomej autoryzacji użytkownika; atrybucja darowizn, XP i NFT do adresu smart accounta; brak automatycznego przekazywania środków; brak własnego tokena.
- **Zasilenie konta USDC:** w MVP ręcznie (adres/QR, wyłącznie natywne USDC w Arbitrum One). Regulowany on-ramp fiat: **tylko propozycja** (`docs/12`), bez implementacji.

### D. Organizacje i raporty
- Organizacja składa wniosek z danymi identyfikacyjnymi i Safe; operator sprawdza je przed aktywacją.
- Użytkownik roli `org_manager` tworzy draft i propozycję raportu; panel weryfikacji pokazuje historię akceptacji.
- Raport publiczny: zakres czasu, cele, kwoty w USDC, opisy zakupów/rezultatów, zredagowane dowody; hash canonical JSON kotwiczony on-chain przez multisig operatora; oddzielne zatwierdzenie przez reviewer multisig.
- Publiczny status każdej wersji `submitted`, `published`, `verified` lub `rejected` z datami oraz wyjaśnieniem zakresu weryfikacji.

### E. Moderacja i operacje
- Zatwierdzenie organizacji + kampanii z zasadą 4 oczu, pełny log decyzji.
- Zgłoszenie kampanii/nadużycia z kategorią i załącznikiem (prywatnym).
- Emergency pause routera/kampanii bez możliwości przejmowania pieniędzy.
- Panel zdrowia indeksatora, zakresów bloków, backfill, rozbieżności sum.
- Wersjonowany regulamin/polityka prywatności / polityka weryfikacji i raportowania (prawne treści do dostarczenia).

## 6. System lig (jedyna wersja prawdy)

| Liga | Łączne nominalne USDC | XP minimum | Symbol |
|---|---:|---:|---|
| Supporter | >= 1 | 10 | S |
| Bronze | >= 100 | 1 000 | B |
| Silver | >= 1 000 | 10 000 | S |
| Gold | >= 10 000 | 100 000 | G |
| Platinum | >= 25 000 | 250 000 | P |
| Diamond | >= 100 000 | 1 000 000 | D |

- `xp = floor(totalDonatedRaw / 100000)` przy USDC o 6 miejscach; 1 USDC (1 000 000 raw) = 10 XP.
- `tier = highest threshold <= totalDonatedRaw`; zero wpłat = NONE.
- Progi liczone osobno dla **adresu na Arbitrum**; agregacja różnych portfeli dopiero w przyszłym ADR.
- Punkty nie są ERC-20, nie istnieje handel, ceny, wypłaty ani związane z nimi świadczenia majątkowe.
- W MVP ranga na podstawie historycznych wpłat; przy nadużyciu możliwe jest oznaczenie w UI `under review`; kontrakt SBT może zawiesić wyświetlaną rangę wyłącznie według procedury (patrz specyfikacja kontraktów). Historia wpłat pozostaje nienaruszalna.

## 7. User journeys

**Darczyńca pierwszy raz:** katalog -> kampania -> wybór kwoty -> connect -> switch Arbitrum -> allowance -> `donate` -> status chain -> podsumowanie -> opcjonalne SIWE / `claim` NFT.

**Darczyńca Beginner (bez wiedzy o krypto):** katalog -> kampania -> wybór kwoty -> rejestracja (Google/Apple/e-mail/passkey) -> „Twoje konto” utworzone automatycznie -> zasilenie USDC -> przegląd (kwota, odbiorca, opłata pokryta przez platformę) -> autoryzacja -> potwierdzenie -> XP/liga -> opcjonalne „Odbierz odznakę” (sponsorowane).

**Powracający darczyńca:** profil -> sprawdzenie raportów poprzednich kampanii -> kolejna darowizna -> nowy XP/ranga bez potrzeby mintowania drugiego NFT.

**Organizacja:** wniosek -> KYC/KYB partnera -> Safe i potwierdzenie kontroli -> panel -> draft -> zatwierdzenie operatora -> kampania na chainie -> raport -> weryfikacja.

**Weryfikator:** lista wniosków -> niezależny przegląd -> potwierdzenie i log -> dopuszczenie publikacji (inny reviewer niż twórca) -> on-chain anchoring.

## 8. Ograniczenia i otwarte decyzje przed produkcją

- Model prawny: podmiot prowadzący platformę, kraje obsługiwane, polityka AML i sankcji, odpowiedzialność za treści, status krypto usług.
- Procedura weryfikacji fundacji, kryteria odrzucenia, odwołania, retencja dokumentów.
- Portfele organizacji: Safe 2-of-3 lub wyższy, z wymogiem rozdziału podpisujących; świadoma zgoda na publikację adresu.
- Formalna dostępność nazwy i domeny `charonchain.com`.
- SLA raportowania i zobowiązania umowne fundacji; bez podpisanych zobowiązań brak obietnicy „pełna ścieżka wydatków”.
- Stopień publiczności opisów beneficjentów, przypadki małoletnich, zgody na publikowanie zdjęć i przetwarzanie danych.

## 9. Plan wydań

- **Faza A:** lokalne prototypy + mock USDC + makiety + testy jednostkowe.
- **Faza B:** Arbitrum Sepolia, 2 organizacje testowe i testy E2E.
- **Faza C:** audyt kodu, opinia prawna, pre-launch, pilotaż.
- **Faza D:** Arbitrum One, mała lista organizacji, monitoring i incident response.

**Nie przypisuj daty mainnetu** przed zakończeniem zewnętrznych bramek.
