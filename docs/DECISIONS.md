# Decisions / ADR backlog — CharOnChain

## Przyjęte dla MVP

- ADR-001: Arbitrum + Solidity / OpenZeppelin + Foundry.
- ADR-002: Wyłącznie natywne USDC, direct-to-Safe, zero obowiązkowej prowizji.
- ADR-003: Hard cap, beneficjent immutable; brak escrow/refund.
- ADR-004: XP z historycznych wpłat native USDC, SBT claimable (nie automint), dynamiczny tier.
- ADR-005: Dane prywatne i media w Supabase, metadane SBT i zredagowane raporty publiczne mogą używać IPFS.
- ADR-006: Backend projekcją eventów, obsługa reorgów i reconciliation.

## Decyzje wymagające świadomej akceptacji przed mainnetem

- ADR-101: Kto prawnie jest operatorem platformy i jaka jurysdykcja?
- ADR-102: Czy licencja/rejestracja lub inne obowiązki w ramach MiCA/AML dotyczą wybranego modelu? Analiza specjalistyczna wymagana.
- ADR-103: Jak długo przechowywane są dokumenty KYB i zgłoszenia nadużyć? Weryfikacja prawna.
- ADR-104: Dokumenty/formularze organizacji: obowiązek publikacji raportu w 30 dni, sankcje za opóźnienia i odwołania.
- ADR-105: Kto podpisuje admin Safe 2-of-3, guardian, Safe publisher i Safe reviewer? Oddzielne osoby/organizacje.
- ADR-106: Jak reagować na fałszywą kampanię już opłaconą i jak komunikować brak kontroli nad funduszem?
- ADR-107: Czy znaki towarowe CharOnChain i domena są dostępne?
- ADR-108: Polityka rankingu i odwołań — publiczne warunki zawieszeń SBT.
- ADR-109: Dokładny SLO potwierdzeń Arbitrum oraz odpowiednia semantyka w UI (uwaga: bufor „12 bloków” ≈ sekundy — `docs/10` DOC-04).
- ADR-110: Status prawny embedded wallets (custody/CASP, dostawca jako przetwarzający dane wg RODO) i sponsorowania gasu jako elementu oferty.
- ADR-111: Regulowany on-ramp fiat → krypto (`docs/12`): dostawca, zakres krajów, model prawny. Bez zatwierdzenia — brak implementacji.

## Decyzja właściciela v1.2 (2026-10-31)

**Account Abstraction, embedded wallets i sponsorowanie gasu = P0** (wcześniej „P1”). Tryby Beginner (domyślny) i Advanced. Specyfikacja: `docs/11`. Kontrakty SC-1.0 bez zmian. Poniższe pozycje są **propozycjami do akceptacji**, nie wdrożonym faktem (`CLAUDE.md` pkt 15):

- **ADR-007 (PROPOSED):** dostawca embedded wallets/AA — `docs/adr/ADR-007-embedded-wallet-and-aa-provider.md`; wymaga weryfikacji źródeł pierwotnych i spike'u.
- **ADR-008 (PROPOSED):** polityka sponsorowania — allowlista, limity, budżety, `burn` w allowliście (`docs/11` §6); wartości liczbowe ustala właściciel.
- **ADR-009 (PROPOSED):** tożsamość przy dwóch trybach i wielu metodach logowania — brak łączenia i migracji reputacji (`CLAUDE.md` pkt 8); wymaganie wobec dostawcy: łączenie metod logowania bez zmiany adresu.
- **ADR-010 (PROPOSED):** EIP-7702 — poza MVP jako ścieżka domyślna; włączenie za flagą po potwierdzeniu aktywacji na Arbitrum One/Sepolia ze źródeł pierwotnych.
- **ADR-112 (ACCEPTED 2026-10-31 przez właściciela, DOC-01):** `donations.amount_raw > 0` zamiast `>= 1000000`, bo poprzednie odrzucałoby legalną końcówkę celu (`docs/10` §5). Minimum 1 USDC (z wyjątkiem końcówki) egzekwuje kontrakt.
- **ADR-113 (PROPOSED, DOC-05):** opcjonalna kontrola on-chain beneficjenta (Safe, próg ≥2) w `createCampaign` — zmiana dotyka przepływu pieniędzy.

## Propozycje z UI (COC-003/003A) — PROPOSED, czekają na decyzję właściciela

- **ADR-114 (PROPOSED) — słownictwo Beginner w EN.** `docs/04` (zasada językowa) zakazuje „gas/approve/seed/sieć” na ścieżce głównej. Polski interfejs jest zgodny i ma test jednostkowy; angielski używa jeszcze „network fee”, „approve”, „network”. Propozycja: „transfer fee”, „confirm”, „transfer” na ścieżce głównej, „network” tylko w szczegółach technicznych. Do akceptacji razem z kopią PL (tłumaczenia są wersją roboczą do przeglądu UX/prawnego).
- **ADR-115 (PROPOSED) — obrazy autentyczne.** Strona nie ma zdjęć ani wideo, bo CharOnChain nie ma zatwierdzonych materiałów beneficjentów (AC-41, `CLAUDE.md` pkt 20). Skutek: ostrzeżenia Taste `no-real-pictures`/`no-footage` i limit oceny „design ≤ 6,5”. Propozycja: zdjęcia wyłącznie od organizacji, z pisemną zgodą na publikację wizerunku (RODO) i metadanymi pochodzenia; do tego czasu fragmenty interfejsu i oznaczone DEMO placeholdery.
- **ADR-116 (PROPOSED) — wyjątek od „kształt zamiast ramek”.** Pole kwoty ma funkcjonalne obramowanie 2 px (`ink-soft`, 8,3:1), bo bez niego granica pola ma 1,14:1 (WCAG 1.4.11). Pozostałe powierzchnie nadal używają masek.

- **ADR-117 (PROPOSED) — doprecyzowania SC-1.0 z implementacji (COC-011..014).** (1) `updateMetadataHash` odrzuca kampanię `CLOSED` (stan ostateczny = zamrożone metadane); (2) `ImpactRegistry.publishReport` wymaga istnienia kampanii w `CampaignRegistry` (dodatkowy parametr konstruktora), może dotyczyć kampanii zamkniętej; (3) wersje raportu rosną o 1 od 1 per kampania, decyzje `UNREVIEWED→VERIFIED|REJECTED`, `VERIFIED→REVOKED`, `REJECTED/REVOKED` ostateczne, `REJECTED/REVOKED` wymagają niepustego hasha powodu; (4) autor raportu nie recenzuje własnego raportu, a role publisher/reviewer nie mogą należeć do jednego adresu; (5) `ReputationSBT.claim` dozwolone dla zawieszonego portfela (tier 0); (6) opóźnienie zmiany admina (`AccessControlDefaultAdminRules`) jest parametrem konstruktora — wartość produkcyjna do ustalenia (testy: 3 dni); (7) dodatkowe błędy poza minimalnym zestawem: `InvalidHash`, `InvalidStatusTransition`, `ReputationNotSuspended`, `ReportNotFound`, `ReasonRequired`, `RolesMustBeSeparate`. Zmiana któregokolwiek punktu zmienia kontrakt i testy.
- **ADR-118 (PROPOSED) — publiczność `registry_number`.** `docs/03` zostawia ją „wg polityki”; widok `public_organizations` jej **nie** zawiera (wariant bezpieczny). Decyzja prawna/UX: czy numer rejestru ma być publiczny (zaufanie) czy prywatny (minimalizacja danych).
- **ADR-119 (PROPOSED) — retencja danych prywatnych.** Kolumny `retention_until` istnieją (`organization_private`, `abuse_reports`), automatycznego usuwania nie ma; potrzebna polityka prawna (okresy, podstawa, procedura usunięcia plików z Storage i `audit_logs`, które są append-only).

- **ADR-120 (PROPOSED) — definicja `orgHash` i metadanych przy tworzeniu kampanii (COC-033).** `docs/02` nazywa `orgHash` niezmiennym (INV-05), ale nie mówi, z czego powstaje. Implementacja używa `keccak256("charonchain:org:v1:" + uuid organizacji)` (bez danych osobowych, stabilny mimo zmiany nazwy). `metadataHash` = SHA-256 kanonicznego JSON (RFC 8785) niezmiennej rewizji, którą zatwierdził recenzent (pola: tytuł, opis, kategoria, slug, limit, okno czasu w sekundach, beneficjent, sieć, id organizacji). Czasy kampanii są zapisywane co do sekundy (zgodnie z `uint64` on-chain). **Obie wartości trafiają na łańcuch i są niezmienne — nie wdrażać na sieć publiczną przed decyzją właściciela.**
- **ADR-121 (PROPOSED) — przepływ organizacji w API.** (1) Zatwierdzenie organizacji (KYB, ustawienie `verified_at`) nie ma jeszcze endpointu: wymaga procesu weryfikacji i decyzji prawnej (dane osobowe w `organization_private`: imię i e-mail osoby kontaktowej są opcjonalne i jeszcze nie przetwarzane produkcyjnie); (2) szkic kampanii może założyć wyłącznie zatwierdzona organizacja, a beneficjentem jest zawsze jej zweryfikowany Safe; (3) `cancel-publication` (PUBLISHING → APPROVED) jest dozwolone tylko operacyjnie, gdy transakcja Safe nie została wykonana — po wykonaniu indexer zgłosi anomalię, nie zgadnie.

## Możliwe P1 — wymaga nowego PRD/ADR i threat modelu

- natywny BTC lub wrapped assets;
- USDT0 (najpierw compliance UE), ETH/WBTC z precyzyjnymi oracle;
- ~~gasless smart accounts i AA~~ → **przeniesione do P0 (v1.2)**; w P1 pozostają: płatność gasu w USDC jako fallback, EIP-7702 jako domyślna ścieżka;
- campaign escrow/milestones i refunds;
- matching pools / community missions;
- opłata dobrowolna, white-label, konta firmowe;
- przenoszenie reputacji między portfelami / powiązanie wielu portfeli;
- zdecentralizowane governance i rozbudowane osiągnięcia.
