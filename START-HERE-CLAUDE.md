# Uruchomienie projektu CharOnChain z Claude Code

**Nie wklejaj całego PRD do jednego promptu, jeśli pliki znajdują się w repozytorium.** Umieść katalog `CharOnChain-spec` w nowym repozytorium i otwórz go w Claude Code. Pliki są przygotowaną specyfikacją, a nie działającą aplikacją.

## Pierwsza komenda/prompt

```text
Przeczytaj README.md, CLAUDE.md, komplet docs/01-06,
docs/08-DESIGN-SYSTEM-AND-SKILLS.md, docs/09-VISUAL-QA-CHECKLIST.md, docs/DECISIONS.md
oraz contracts/src/interfaces/ICharOnChain.sol. Potraktuj je jako
obowiązującą specyfikację projektu CharOnChain.

Zanim zaczniesz, podaj przegląd architektury, wykryte sprzeczności,
ryzyka i proponowany plan implementacji z docs/06, łącznie z COC-003A i COC-047.
Nie usuwaj założeń bezpieczeństwa. Potem zaimplementuj wyłącznie
COC-001, z testami i dokumentacją. Bez mainnet deployment.
```

## Obowiązkowy start designu po infrastrukturze

Przed COC-003 (design system) i wszystkimi ekranami UI skorzystaj z **Promptu D** w `docs/06-CLAUDE-CODE-BACKLOG.md`.

**Wymagane skille:** `design-taste-frontend` (Taste) i `frontend-design` (Design). Muszą rzeczywiście istnieć w Twojej sesji Claude Code. W razie braku któregokolwiek wstrzymaj zadanie UI i zainstaluj po własnym zatwierdzeniu zgodnie z instrukcjami `docs/08` (Claude nie może udawać, że skill uruchomił). Najpierw trzy kierunki wizualne, potem review preview home/campaign/checkout, na końcu realne screenshoty browsera, poprawki i AC-36..43.

## Kolejne prompty

Proś o pojedyncze zadanie, np. „Zrealizuj COC-010”, po code review i akceptacji poprzedniego PR. Dla kontraktów zawsze wymagaj Foundry unit/fuzz/invariant. Dla backendu RLS, testów autoryzacji, migracji. Dla płatności i indexera testów nieodwracalności/duplikatów/reorgów. Raport z postępów prowadź według tabeli z backlogu.

## Rzeczy, które musi zrobić właściciel projektu

- Założyć repozytorium i wybrać miejsca deploymentu; dostęp do Supabase, RPC i hostingów bez ujawniania private keys w kodzie.
- Potwierdzić właścicieli Safe oraz organizacje pilotażowe.
- Dostarczyć zatwierdzone logo/identyfikację oraz zgodne z prawem teksty i zgody.
- Zapewnić niezależną opinię prawną i audyt przed realnym pozyskiwaniem pieniędzy.

**Projekt jest z założenia bezpieczniejszy jako testnet-first.** Claude Code może napisać kod i testy, ale nie zastąpi audytora, prawników, procedur KYB ani decyzji osób zarządzających funduszami.
