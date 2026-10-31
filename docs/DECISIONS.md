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
- **ADR-112 (PROPOSED, DOC-01):** korekta ograniczenia `donations.amount_raw >= 1000000` → `> 0`, bo odrzuciłoby legalną końcówkę celu (`docs/10` §5).
- **ADR-113 (PROPOSED, DOC-05):** opcjonalna kontrola on-chain beneficjenta (Safe, próg ≥2) w `createCampaign` — zmiana dotyka przepływu pieniędzy.

## Możliwe P1 — wymaga nowego PRD/ADR i threat modelu

- natywny BTC lub wrapped assets;
- USDT0 (najpierw compliance UE), ETH/WBTC z precyzyjnymi oracle;
- ~~gasless smart accounts i AA~~ → **przeniesione do P0 (v1.2)**; w P1 pozostają: płatność gasu w USDC jako fallback, EIP-7702 jako domyślna ścieżka;
- campaign escrow/milestones i refunds;
- matching pools / community missions;
- opłata dobrowolna, white-label, konta firmowe;
- przenoszenie reputacji między portfelami / powiązanie wielu portfeli;
- zdecentralizowane governance i rozbudowane osiągnięcia.
