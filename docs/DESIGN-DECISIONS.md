# CharOnChain — rejestr decyzji wizualnych

**STATUS: KIERUNEK B „KWIT” WYBRANY PRZEZ WŁAŚCICIELA (2026-10-31); tokeny i preview w toku (COC-003/003A).** Poniższe sekcje 0–5 to historia propozycji sprzed wyboru. Nie oznacza to zatwierdzenia logo, palety, krojów pisma ani zdjęć. Żaden kierunek nie został jeszcze zbudowany; **nie ma** screenshotów, inspekcji w przeglądarce ani preview — powstaną po Twoim wyborze (COC-003A).

## 0. Realne użycie skilli (stan 2026-10-31)

| Skill | Źródło / wersja | Co faktycznie wykonano | Czego jeszcze NIE wykonano |
|---|---|---|---|
| `frontend-design` (Anthropic) | `/mnt/skills/public/frontend-design/SKILL.md` (przeczytany w całości) | plan tokenów (kolor, typografia, układ, zasady), wireframe'y ASCII, przegląd planu pod kątem „generycznych domyślnych” (sekcja 4) | budowa kodu, screenshoty, krytyka obrazów |
| `design-taste-frontend` (Taste) | `leonxlnx/taste-skill`, `skills/taste-skill/SKILL.md`, hash folderu `6ac8ba60…fb0d`, zainstalowany 2026-10-31 za zgodą właściciela (`npx skills add … -g --copy`). `SKILL.md` identyfikuje się jako „tasteskill v2”; numer drobny niepotwierdzony (`docs/08` podaje v2.1.x) | kroki 1–4 procedury: brief, inwentarz tematu, argument sekcji, losowanie kierunków `draw.mjs` (2 losowania, 4 pełne arkusze), zdanie-idea z testem konkurenta; przegląd skryptów skilla przed uruchomieniem (brak sieci w `draw/lint`, Chrome tylko lokalnie) | krok 6–10: build, `lint.mjs`, `inspect.mjs`, krytyka screenshotów, warstwa ruchu. `inspect.mjs` wymaga Chromium bez `--no-sandbox` jako root → potrzebny wrapper w `CHROME_PATH` |

Skrypty skilla zapisują pamięć losowań w `~/.taste-skill/`; w tej sesji przekierowana do katalogu roboczego (`TASTE_SKILL_HISTORY`). Pliki robocze `.taste-skill/` są w `.gitignore`.

## 1. Brief, inwentarz i argument (home UX-01)

**Brief (jedno zdanie):** niekustodialna platforma darowizn USDC na Arbitrum: darczyńca przekazuje środki prosto do portfela Safe 2-z-3 zweryfikowanej organizacji, każda płatność jest publicznie sprawdzalna, darczyńca dostaje odznakę, której nie można sprzedać, a organizacje publikują raporty zakotwiczone hashem. Odbiorcy: darczyńcy z PL/UE **bez wiedzy o krypto** (Beginner) i krypto-natywni (Advanced); organizacje; recenzenci.

**Inwentarz — to, co ma tylko CharOnChain:**
1. Nazwa: *Char*ity + *On-Chain*; brzmi jak *Charon*, przewoźnik z mitologii (przeprawa). Skojarzenie z zaświatami jest wrażliwe dla marki charytatywnej — **decyzja właściciela**, czy je wykorzystywać; żaden z trzech kierunków nie opiera się na nim.
2. **Trzy odrębne dowody**, których produkt nie wolno mieszać: płatność (łańcuch), organizacja (KYB), wpływ (raport z hashem) — `CLAUDE.md` pkt 12.
3. Portfel Safe z progiem 2-z-3 (trzy klucze, dwa podpisy).
4. Beneficjent kampanii **niezmienny** po utworzeniu.
5. **Twardy limit** kampanii i okno czasowe `[start, end)`; wyjątek: końcówka poniżej 1 USDC domykająca cel.
6. Kwoty z sześcioma miejscami po przecinku (`5.123456 USDC`).
7. 0% obowiązkowej prowizji; w trybie Beginner opłatę sieciową pokrywa platforma.
8. **Kwit transakcji**: hash, odbiorca, kwota, status, link do eksploratora.
9. Odznaka soulbound (ERC-5192), sześć lig: 1 / 100 / 1 000 / 10 000 / 25 000 / 100 000 USDC.
10. Raporty tylko dopisywane: korekta = nowa wersja, historia nie znika.
11. Uczciwe granice: brak zwrotów; „zweryfikowana organizacja” ≠ „zweryfikowany rezultat”.

**Argument strony głównej (claim → dowód):**
1. Darowizna trafia prosto do zweryfikowanej organizacji, bez pośrednika i bez obowiązkowej prowizji. → ścieżka darczyńca → Safe, narysowana jako prawdziwy fragment interfejsu (DEMO).
2. Każdą wpłatę możesz sprawdzić sam. → kwit z hashem i linkiem do eksploratora.
3. Sprawdzamy trzy różne rzeczy i trzymamy je osobno: płatność, organizację, wpływ. → trzy dowody z własnymi statusami.
4. Kampania ma twardy limit i stałego odbiorcę. → lista kampanii (DEMO do czasu realnych danych, AC-41).
5. Daj w kilka minut, bez wiedzy o krypto. → prawdziwa lista kroków.
6. Dostajesz odznakę, której nie można sprzedać: uznanie, nie inwestycja. → ligi.
7. Uczciwe odpowiedzi (zwroty, ryzyko USDC). → FAQ. 8. Wezwanie do działania.

Role sekcji przekazane do losowania: `proof, showcase, how-it-works, list, faq, cta, footer`. **Nie** użyto zestawu zdjęć „People” z arkuszy (patrz sekcja 2).

## 2. Odrzucone kierunki i redrawy (z powodem)

| Kierunek / slot | Powód |
|---|---|
| `place-carries-it` (losowany 2×) | wymaga wielu zdjęć miejsca; CharOnChain nie ma własnych, a wizerunki beneficjentów nie mogą być wymyślane ani stockowe udające dowód (AC-41) |
| `loud-flat-poster` | krzykliwy, ultra-ciężki kontrast — sprzeczny z „spokojny, wiarygodny” (`docs/08` §2); wymaga wycinanych zdjęć |
| `one-motif` (wybrany z listy, odrzucony po arkuszu) | burgund + róż i krój „Chillax” — sygnał zabawy, nie zaufania finansowego |
| Zestaw zdjęć „People … as atmosphere” (każdy arkusz) | zdjęcia ludzi jako tło sugerowałyby realnych beneficjentów; obrazy to rysunki w kodzie, prawdziwe fragmenty interfejsu i oznaczone DEMO placeholdery |
| Paleta „Forest and lime” (arkusz B) | seledyn/limonka ≈ „crypto-neon” (`CLAUDE.md` pkt 20), ciemna cała strona kłóci się z „jasne treści + ciemny akcent hero” (`docs/08`) → proporcje zachowane, kolory z roboczej palety właściciela |

Kierunki B i C pochodzą z listy dla sektora `nonprofit`, **wybrane świadomie** na podstawie inwentarza (nie wylosowane); `colour-chapters` i `editorial-report` wypadły w losowaniu.

## 3. Opcje art direction

| Kandydat | Paleta i typografia | Kompozycja | Fotografia / grafika | Mocne strony | Ryzyka |
|---|---|---|---|---|---|
| **A — Raport roczny** (`editorial-report`, „The printed annual”) | piasek `#E6DBC7`, kobalt `#062B8A`; krój **Switzer** (jeden) | oś pionowa ~42% szer.; po lewej notatki i liczby, po prawej narracja; wąski „masthead” | brak zdjęć beneficjentów; pas z dokumentami (skany raportów/kwitów, DEMO) rysowany w kodzie | autorytet, treść przed efektami, elegancka typografia, naturalny dla raportów wpływu | „ciepły krem” bywa znakiem generycznego designu; może wyglądać „instytucjonalnie”, nie „Web3”; Switzer ładowany z Fontshare — wymaga self-hostingu i sprawdzenia licencji oraz polskich znaków |
| **B — Kwit** (`page-is-the-object`, „The page is the object”) | granat `#0C1527`, papier `#F6F9FC`, tusz `#162033`, mięta `#53D5AE` (tylko na granacie); **Libre Franklin** (nagłówki) + **Source Serif 4** (tekst) | pierwszy ekran: pojedynczy kwit (karta ~5:7) z pozycjami; kolejne sekcje to dalsze elementy papeterii (odcinek, certyfikat); stopka = rewers | rysowana papeteria (kwit, odcinek z perforacją), prawdziwe fragmenty interfejsu (`data-ui`) | jedyny kierunek zbudowany na **własnym produkcie** CharOnChain (kwit z dowodem), spójny katalog → checkout → odznaka, zrozumiały dla Beginnera, ciągłość z paletą roboczą | skeuomorfizm łatwo przerysować; wycięcia `clip-path` i perforacje wymagają kontroli a11y; ryzyko ciężkiej strony ciemnej (granat tylko w hero i stopce) |
| **C — Trzy dowody** (`colour-chapters`) | biały, szary `#C5C5C5`, czerń, mięta `#A7FF9C`, pomarańcz `#FF6831`; krój **Hanken Grotesk** | pełnoekranowe rozdziały-pola koloru (min. 90svh), jeden nagłówek 8–12vw; hero jako „teczka z zakładkami” Płatność / Organizacja / Wpływ | brak zdjęć; kolor niesie strukturę | najbardziej współczesny, mocny na mobile, trzy dowody = trzy rozdziały | mięta `#A7FF9C` + pomarańcz ≈ „neon” (`CLAUDE.md` pkt 20); długi scroll; mniej „instytucjonalny” |

### Kontrast WCAG (policzony skryptem, nie zakładany z samych hexów)

| Para | Współczynnik | Ocena |
|---|---|---|
| A: kobalt `#062B8A` na piasku `#E6DBC7` | 8,91:1 | AAA |
| A: kobalt miękki `#3A5AA8` na piasku | 4,78:1 | AA (tylko tekst drugorzędny) |
| B: tusz `#162033` na papierze `#F6F9FC` | 15,42:1 | AAA |
| B: papier na granacie `#0C1527` | 17,25:1 | AAA |
| B: mięta `#53D5AE` na granacie / granat na mięcie (przycisk) | 9,98:1 | AAA |
| B: **mięta `#53D5AE` na papierze** | **1,73:1** | **FAIL — zakaz użycia jako tekst/ikona na jasnym tle** |
| B: szary `#55627A` na papierze | 5,82:1 | AA |
| C: czerń na mięcie `#A7FF9C` / na pomarańczu `#FF6831` | 17,43:1 / 7,28:1 | AAA |
| C: **biały na pomarańczu** | **2,89:1** | **FAIL — tylko czarny tekst na pomarańczu** |
| C: szary `#666` na bieli | 5,74:1 | AA |

Tokeny semantyczne (`success`, `warning`, `critical`, stany `focus`) nie są jeszcze zdefiniowane — dodać w COC-003 po wyborze, z kontrolą kontrastu w faktycznych kombinacjach.

### Szczegóły kierunków

**A — Raport roczny.** *Idea:* trzy rodzaje dowodów (płatność, organizacja, wpływ) stają się trzema **ustaleniami strony audytora** w raporcie rocznym; strona kampanii czyta się jak raport. *Test konkurenta:* platforma zbiórek obok nie rozdziela dowodów — zdanie nie działa dla niej. *Element żywy:* **„Sprawdź wpłatę”** — wklejasz hash transakcji (lub identyfikator operacji) i widzisz kwit: odbiorca (Safe), kwota, czas, status (zaobserwowana / potwierdzona). *Odznaka:* pieczęć rejestru w jednolitym tuszu; sześć lig = sześć pieczęci. *Ruch:* maskowane odsłonięcie nagłówka raz; informacja zwrotna na kontrolkach; `prefers-reduced-motion` zachowuje treść bez przesunięć. *Beginner:* ekran autoryzacji to „strona podpisu” z kwotą dużą cyfrą tabelaryczną.

**B — Kwit.** *Idea:* **kwit darowizny staje się samą stroną**. *Test konkurenta:* inne platformy nie wystawiają publicznie weryfikowalnego kwitu jako produktu — zdanie nie działa dla nich. *Element żywy:* **„Wystaw kwit”** — wybierasz kwotę, a kwit na ekranie uzupełnia się na żywo: kwota, odbiorca (Safe), prowizja 0%, opłata sieciowa pokryta, pozostały limit, XP i liga, jakie da ta wpłata. Po darowiźnie ten sam element staje się prawdziwym kwitem z dowodem; **jest zarazem projektem ekranu przeglądu i autoryzacji (UX-22)**. *Odznaka:* odcinek z perforacją (kropki ≥4 px), napis „nie do sprzedaży”. *Ruch:* wolne przenikanie; odrywanie odcinka przy odbiorze odznaki (odpowiedź na akcję użytkownika). *Beginner:* ekran zasilenia konta jako „kwit wpłaty” z adresem i QR; logowanie jako zwykły formularz.

**C — Trzy dowody.** *Idea:* trzy dowody to trzy pełnoekranowe **rozdziały kolorystyczne**. *Test konkurenta:* j.w. *Element żywy:* **„Ile miejsca zostało”** — wybierasz kwotę i widzisz dokładny pozostały limit w USDC (6 miejsc) po wpłacie. *Odznaka:* karty składane w grzbiety. *Ruch:* indeks z podglądem przy najechaniu; reduced-motion bez podglądu. *Beginner:* autoryzacja i zasilenie jako osobne rozdziały z jedną akcją.

### Wireframe'y pierwszego ekranu (desktop, ideacja)

```text
A — Raport roczny                             B — Kwit (grunt: granat)
┌──────────────────────────────────────┐      ┌──────────────────────────────────────┐
│ CharOnChain   Kampanie  Dowody  [Zaloguj]│  │ CharOnChain   Kampanie  Jak to działa  [Zaloguj]│
├──────────────────────────────────────┤      │                                      │
│ ▒▒▒ pas: skany raportów i kwitów (DEMO) ▒▒│  │  Wesprzyj organizację.   ┌───────────────┐│
├────────────┬─────────────────────────┤      │  Sprawdź każdą wpłatę.   │ KWIT (DEMO)   ││
│ notatki:   │ Każda darowizna.        │      │  [Odkryj zbiórki]        │ Kwota  25 USDC││
│ dowód 1    │ Pełna przejrzystość.    │      │                          │ Odbiorca Safe ││
│ dowód 2    │ Sprawdzisz każdą wpłatę.│      │                          │ Prowizja    0%││
│ dowód 3    │ [Odkryj zbiórki]        │      │                          └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘│
└────────────┴─────────────────────────┘      └──────────────────────────────────────┘
C — Trzy dowody
┌──────────────────────────────────────┐
│ CharOnChain          Kampanie [Zaloguj]│
├─[Płatność]─[Organizacja]─[Wpływ]──────┤
│ ███ pole #1 (mięta) ██████████████████│
│ Trzy rzeczy sprawdzamy osobno.        │
└──────────────────────────────────────┘
```

Teksty w wireframe'ach to robocze propozycje. Slogan PRD „Każda darowizna. Pełna przejrzystość.” jest kierunkiem marketingowym, **nie gwarancją** (PRD §1) — w produkcji nie wolno go łączyć z twierdzeniem „100% zweryfikowane”.

## 4. Przegląd planu względem „generycznych domyślnych” (`frontend-design`)

- **Kobalt na piasku (A)** jest blisko „ciepłego kremu” z kalibracji skilla; różni się kobaltem i krojem bezszeryfowym zamiast szeryfu + terakoty, ale pozostaje ryzykiem. Środek zaradczy do sprawdzenia w preview: chłodniejszy papier przy zachowaniu kobaltu.
- **Pomarańcz + mięta + czerń (C)** to „neonowy akcent” — zmniejszyć nasycenie mięty w stronę roboczej `#53D5AE`.
- **Granat + mięta (B)** to częsta para „fintech”; wyróżnikiem nie jest paleta, tylko artefakt (kwit). Warunek: kwit ma być realnym fragmentem interfejsu z prawdziwymi polami, nie ozdobą.
- Zmiany względem pierwszego planu: usunięto zestaw zdjęć „People”, zastąpiono paletę „Forest and lime”, odrzucono trzy kierunki (sekcja 2). Siła kierunku ma być w **jednym miejscu** (A: oś i raport; B: kwit; C: pole koloru), reszta spokojna.

## 5. Rekomendacja i akceptacja

**Rekomendacja: B — Kwit.** To jedyny kierunek, którego centralny pomysł jest produktem CharOnChain (publicznie sprawdzalnym kwitem), łączy katalog, checkout i odznakę w jedną metaforę, jest zrozumiały bez wiedzy o krypto i zachowuje ciągłość z roboczą paletą z `docs/04`. A jest najlepszą alternatywą dla stron o dużej ilości treści (raporty), C dla bardziej ekspresyjnej, mniej „instytucjonalnej” marki. **Akceptacja właściciela: TBD.**

Zasady wspólne dla wszystkich kierunków: bez fikcyjnych KPI, darczyńców i „verified” bez dowodu (AC-41); obrazy to rysunki, prawdziwe fragmenty interfejsu i oznaczone DEMO placeholdery; kroje ładowane przez `next/font` i self-hostowane (bez zapytań do CDN przy wyświetlaniu strony — RODO); polskie znaki do sprawdzenia w renderze; PL domyślnie, EN pełne.

## Zapis wyboru

- Numer ADR i data: DD-001, 2026-10-31 (PROPOSED)
- Wybrany kierunek: **B — Kwit** (`page-is-the-object`), wybór właściciela z 2026-10-31
- Krótkie uzasadnienie względem celu zbiórek i potrzeby zaufania: kwit z publicznie sprawdzalnym dowodem jest produktem CharOnChain; jedna metafora łączy katalog, checkout i odznakę; zrozumiały dla Beginnera (decyzja zgodna z rekomendacją, sekcja 5)
- Tokeny palette/type/spacing/motion: kandydaci w sekcji 3; ostateczne po wyborze
- Rzeczywiście uruchomione skille (źródło i wersja, nie przypuszczenie): sekcja 0
- Linki do prawdziwych renderów i screenshotów: brak — jeszcze nie wykonano
- Wyniki oceny PL/EN i 360/390/768/1280/1440: brak — jeszcze nie wykonano
- Problemy oraz poprawki (2 iteracje): brak — jeszcze nie wykonano
- Testy dostępności i kontrastu: kontrast par kolorów policzony (sekcja 3); axe/Playwright — jeszcze nie wykonano
- Decyzja końcowa: TBD
