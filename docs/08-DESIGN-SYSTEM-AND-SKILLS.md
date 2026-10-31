# CharOnChain — Design Direction & obowiązkowe skille Claude Code (v1.1)

**Status:** normatywna specyfikacja dla każdego zadania frontendowego. Uzupełnia `04-UX-AND-ACCEPTANCE.md`, ale nie nadpisuje wymagań bezpieczeństwa, prawdziwości danych i dostępności.

## 1. Obowiązkowe skille i weryfikacja dostępności

Przed `COC-003`, `COC-003A`, `COC-040..047` i każdym redesignem:

1. W bieżącej sesji Claude Code **sprawdź rzeczywistą dostępność** obu skilli (lista dostępnych skills / konfiguracja pluginów):
   - **Taste:** `design-taste-frontend` (Leonxlnx/taste-skill, obecnie v2.1.x; po instalacji w pluginie może być namespaced).
   - **Design:** `frontend-design` (Anthropic, oficjalny skill/plugin).
2. **Odczytaj treść właściwego `SKILL.md` każdego dostępnego skilla i zastosuj jego workflow** do projektowanego ekranu; nie poprzestawaj na wzmiance w raporcie.
3. W raporcie zadania odnotuj: faktycznie uruchomione skille, odczytane źródła, przebieg, ewentualne ograniczenia. Nigdy nie twierdź, że zastosowano skill, jeśli nie był dostępny.
4. Jeśli któregoś brakuje — **zatrzymaj zadanie UI jako BLOCKED**, pokaż instalację i poproś właściciela o zatwierdzenie; nie instaluj samowolnie, nie symuluj działania skilla i nie uznawaj UI za gotowe. Prace nie-UI mogą być kontynuowane.
5. Jeśli wymogi skilli kolidują, pierwszeństwo mają: bezpieczeństwo i prawdziwość darowizn -> WCAG 2.2 AA -> niniejsze wymagania marki -> sugestie skilli. Wybór udokumentuj w `docs/DECISIONS.md`.

### Weryfikowalne źródła i instalacja (aktualne na 31.10.2026)

- Taste upstream: https://github.com/Leonxlnx/taste-skill — przykładowo `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` albo w Claude Code: `/plugin marketplace add Leonxlnx/taste-skill`, `/plugin install taste-skill@taste-skill`. Wersja v2.1+ obejmuje również app screens i dashboardy. Może wymagać Node 22+ oraz Chrome/Chromium do inspekcji; przed uruchomieniem sprawdź instrukcję zainstalowanej wersji.
- Design Anthropic: https://github.com/anthropics/skills/tree/main/skills/frontend-design i https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design — instalacja według aktualnej dokumentacji Claude Code. Nie zakładaj, że skill jest automatycznie obecny.
- Nie kopiuj zawartości zewnętrznych skilli do repo ani nie przypisuj sobie ich autorstwa; wczytuj z legalnie zainstalowanego źródła.

## 2. Charakter i cel estetyczny

**Pozycjonowanie:** human-centered financial trust product. Profesjonalizm instytucji finansowej, empatia i czytelna informacja o pomocy. Nie „krypto kasyno”, nie sklep z tokenami, nie generyczny SaaS.

**One-line design read:** „Transparentne pomaganie, w którym darczyńca natychmiast rozumie komu, ile i po co przekazuje środki, a blockchain jest wiarygodnym dowodem, nie barierą”.

**Docelowe odczucia:** spokojny, wiarygodny, nowoczesny, międzynarodowy, wyrazisty, ale nienachalny. Tworzyć projekt, który jest charakterystyczny dla CharOnChain, nie losowy szablon Tailwind/shadcn.

### Kierunek wizualny (punkt startowy, wymaga prototypu i oceny)

- Paleta robocza z `04-UX...`: midnight navy `#0C1527`, mint `#53D5AE`, off-white `#F6F9FC`, ink `#162033`. Dodaj semantyczne `success`, `warning`, `critical`, `surface`, `border`, `muted` w tokenach; każdą parę tekst/tło sprawdź kontrastem, nie zakładaj zgodności na podstawie samych hexów.
- Layout: **jasne, czytelne treści i formularze** z ciemnym, oszczędnym heroicznym akcentem w home. Zaufanie przed gamifikacją, konkretna historia beneficjenta przed Web3 słownictwem.
- Typografia: przygotuj porównanie 2 alternatywnych zestawów; rekomendacja startowa **Manrope** dla display/headings oraz **IBM Plex Sans** dla UI i liczb (są to kandydaci, nie twarde decyzje). Wczytuj przez `next/font`; dopracuj polskie znaki i szerokość dla EN.
- Siatka i rytm: skala odstępów 4/8 pt, stała szerokość content container, wyraźne breakpointy (360, 390, 768, 1024, 1440), logiczna hierarchia H1-H3, tabular numerals dla kwot i statystyk.
- Karty: nie ozdabiaj wszystkich elementów identycznymi obramowaniami. Zróżnicuj hierarchię i gęstość: kampanie/impact mogą być wizualnie bogatsze, checkout i kwestie prawne spokojniejsze.
- Zdjęcia: prawdziwe, legalnie pozyskane fotografie zgodne z tematyką, z przypisaniem źródła/licencji i zgód. W mockach wyraźne placeholdery **DEMO**. Nie używaj nieautoryzowanych wizerunków cierpiących osób, ilustracji mających udawać dokumentację rzeczywistego zdarzenia, stocków udających dowód wpływu.
- Ikony: spójny zestaw (np. Lucide), bez chaotycznego mieszania ikon/emoji; NFT mogą mieć bardziej ekspresyjną identyfikację, ale nie mogą sugerować inwestycji.
- Motion: łagodne stany hover, przejścia i feedback; zero ciężkich parallaxów, scroll-jackingu i pulsujących CTA. Szanuj `prefers-reduced-motion` i budżet wydajności.
- Dark/light: dla całej aplikacji przede wszystkim czytelność; zaprojektuj wersje pozwalające utrzymać kontrast. W MVP nie obiecuj pełnego przełącznika, jeśli nie jest zaimplementowany.

### Kierunek layoutów

**Home — desktop:**
```text
HEADER: logo | Kampanie | Jak to działa | Transparentność | [Połącz portfel]
HERO: [emocjonalna, zgodna z prawami historia + konkretna obietnica]
      [CTA Odkryj zbiórki]           [autentyczne zdjęcie / editorial visual]
TRUST STRIP: co jest on-chain | jak weryfikujemy | brak obowiązkowej prowizji
CAMPAIGNS: przeszukiwalne, prawdziwe zweryfikowane kampanie (bez fake metr.)
HOW IT WORKS: trzy krótkie kroki
PROOF OF IMPACT: rzeczywisty raport i rozróżnienie dowodu transferu/efektu
REPUTATION: liga i NFT jako wtórny benefit, bez obietnic pieniężnych
FOOTER: metodologia, legal, prywatność, status, kontakt
```

**Campaign detail:** lewa kolumna: beneficjent, konkretne potrzeby, dowody, organizacja, raporty. Prawa: stabilny panel darowizny z kwotą USDC, siecią i Safe. Na mobile panel przesuwa się w naturalnym flow i jest zawsze dostępny bez zasłaniania tekstu; nie używaj overlay zasłaniającego disclosure.

**Donor dashboard:** czytelny stat summary, odznaka, dalszy próg, chronologiczna historia wpływu; bez przerysowanych wykresów. **Organization/admin:** bardziej zwarty, enterprise-UX z filtrami, tabelami, edycją danych i role-aware confirmation — osobny styl gęstości w ramach wspólnych tokenów.

## 3. Wymagany proces projektowania — ZANIM powstanie kod

1. **Brief:** określ użytkownika (gość/darczyńca/organizacja/admin), zadanie ekranu, dane potrzebne do decyzji, ograniczenia prywatności.
2. **Skills:** zweryfikuj, odczytaj i zastosuj `frontend-design` oraz `design-taste-frontend`; zapisz ślad ich realnego użycia.
3. **Art direction:** zaproponuj **trzy różne kierunki dla pierwszych publicznych ekranów**, zawierające paletę, typografię, kompozycję, styl zdjęć i powód, dla którego pasują do filantropii on-chain. Wskaż rekomendowany kierunek i zapisz w `docs/DESIGN-DECISIONS.md`.
4. **Tokeny:** przygotuj nazwy/role dla kolorów, fontów, spacingu, radius, shadow, ikon, stanów. Zero surowych losowych kolorów rozrzuconych po komponentach.
5. **Wireframes + preview:** zbuduj ocenialną wersję home, campaign detail i checkout **oraz ekranów Beginner UX-19 (logowanie) i UX-22 (autoryzacja darowizny)** (najpierw warianty na komponentach statycznych, z wyraźnym oznaczeniem demo). Nie rozpoczynaj implementacji wszystkich 18 ekranów zanim spójność tej trójki nie przejdzie review.
6. **Build:** implementuj w wybranym stacku, mobile-first, oddzielając dane i dostępność od dekoracji. Używaj rzeczywistych stanów aplikacji i nie wymyślaj metryk.
7. **Browser inspection:** wykonaj realne zrzuty w przeglądarce (Playwright lub narzędzie skilla), przy 360, 390, 768, 1280 i 1440 px, dla PL i EN oraz light/dark *jeśli wspierane*.
8. **Critique -> poprawki -> review:** co najmniej dwie iteracje oceny względem `09-VISUAL-QA-CHECKLIST.md` na głównych ekranach, z dowodami przed/po. Nie oceniaj wyłącznie na podstawie JSX i kodu CSS.
9. **Gate:** krytyczne problemy UX/design blokują oznaczenie zadania jako DONE. Przy brakującym browserze zgłoś BLOCKED, nie twierdź, że dokonano wizualnej inspekcji.

## 4. UX copy, bezpieczna gamifikacja i etyka

- Główna akcja: „Wesprzy zbiórkę”, bez agresywnego niedoboru, fałszywego countdownu i manipulacyjnych CTA.
- Darczyńca musi znać: kwotę i walutę, sieć, portfel Safe odbiorcy, koszt gas, status approve vs donate, finalizację, ryzyko braku zwrotu.
- NFT i XP to **uznanie i reputacja**, nie możliwa inwestycja. Unikaj komunikatów „zarabiaj za pomaganie”.
- „Zweryfikowana organizacja” != „zweryfikowany rezultat”. Każda z tych etykiet ma tooltip/metodologię i odmienny status.
- Użytkownik nigdy nie może być zawstydzany za małą wpłatę. Liga/leaderboard nie może przesłonić podstawowej funkcji charytatywnej.
- Error states muszą mówić *co zrobić teraz* (wrong network, gas, odrzucony podpis, hard cap, wygasła kampania, reorg, odłączony portfel).

## 5. Reużywalne komponenty i kryteria

W `packages/ui` stwórz wersjonowane komponenty z przykładami stanów: `SiteHeader`, `TrustStatus`, `CampaignCard`, `DonationPanel`, `USDCAmount`, `WalletStatus`, `TierBadge`, `XPProgress`, `ImpactTimeline`, `ReportVerificationStatus`, `TransactionStatus`, `SafeAddress`, `EmptyState`, `ErrorState`, `DataTable`, `PageShell`, `LoadingSkeleton`; **v1.2 (AA/Beginner):** `OnboardingFlow`, `FundAccountPanel`, `AuthorizeDonationSheet`, `RecoveryStatus`, `SponsoredFeeNotice`, `ModeSwitcher`, `OperationStatus` (stany i wymagania: `docs/11` §7, §10). Język Beginnera bez żargonu (gas/approve/sieć/seed) na ścieżce głównej.

Każdy komponent: semantyka, aria, keyboard, loading/disabled/error/success, PL/EN, RWD, test jednostkowy lub interaction test i preview. Zero duplikatów flow donate w oddzielnych komponentach.

**Definition of Done dla frontendu:** źródła obu skilli zweryfikowane + dokumentacja design decisions + screenshot artifacts + raport QA + pozytywne testy a11y/Playwright + zatwierdzony brak danych fikcyjnych + spójność z PRD. Nie claimuj jakości „award-winning” bez zewnętrznej oceny.
