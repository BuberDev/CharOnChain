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
- ADR-109: Dokładny SLO potwierdzeń Arbitrum oraz odpowiednia semantyka w UI.

## Możliwe P1 — wymaga nowego PRD/ADR i threat modelu

- natywny BTC lub wrapped assets;
- USDT0 (najpierw compliance UE), ETH/WBTC z precyzyjnymi oracle;
- gasless smart accounts i AA;
- campaign escrow/milestones i refunds;
- matching pools / community missions;
- opłata dobrowolna, white-label, konta firmowe;
- przenoszenie reputacji między portfelami / powiązanie wielu portfeli;
- zdecentralizowane governance i rozbudowane osiągnięcia.
