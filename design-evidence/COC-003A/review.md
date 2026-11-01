# Przegląd wizualny COC-003A — rundy, wyniki inspektora, krytyka

Zasada: ocena z renderów (zrzuty z Chromium), nie z kodu. Kryteria: `references/critique.md` skilla Taste (cztery kryteria 40/30/20/10, limity). Autor oceniał własną pracę, więc punkty traktować ostrożnie: kalibracja skilla mówi, że realne Sites of the Day mają 7,5–8,0.

## 0. Uczciwy stan dowodów (AC-42)

- **Rundy 1 i 2 nie mają zapisanych punktów ani zrzutów „przed”.** Poniższe opisy są odtworzone z dziennika pracy (lista usterek i napraw), a zrzuty z tamtych momentów zostały nadpisane przez kolejne przebiegi. Dowodami są dziś: testy, które pilnują napraw (E2E, jednostkowe, `a11y.mjs`), i końcowe zrzuty.
- **Runda 3 jest pierwszą oceną z punktacją**, na finalnym buildzie.
- Wniosek: AC-42 („dwie rundy przed/po”) = **PARTIAL**. Od następnej rundy zrzuty „przed” trzeba archiwizować (`design-evidence/COC-003A/rounds/rN-before|after/`).

## 1. Wynik inspektora Taste na finalnym buildzie

| Ekran | Tryb | FAIL | WARN |
|---|---|---|---|
| home PL | strona | **0** | `no-real-pictures`, `no-footage`, `off-centre` |
| home EN | strona | **0** | te same |
| zbiórka (PL, EN) | strona | **0** | te + `still-page` |
| zbiórka: końcówka celu | strona | **0** | j.w. |
| zbiórka: **pusta** | strona | **1: `few-pictures`** | `no-footage`, `off-centre`, `still-page` |
| checkout review i confirmed | `--app` | **0** | `app-title-size` |
| profil | `--app` | **0** | `app-title-size` |

Taste `lint.mjs`: **0 FAIL**, 1 WARN (17 myślników; głównie „—” jako puste wartości kwot i separatory tytułów). `overflowX = 0` na każdym zrzucie z `capture-all.sh`.

### Ostrzeżenia i FAIL z obroną (albo bez)

| Znalezisko | Stanowisko |
|---|---|
| `no-real-pictures`, `no-footage` | **Świadomie.** Nie ma autentycznych, zatwierdzonych zdjęć ani wideo; stockowe wizerunki beneficjentów łamią AC-41 i `CLAUDE.md` pkt 20. Wniosek formalny: limit „design ≤ 6,5” (ADR-115). |
| `few-pictures` (FAIL, tylko pusta zbiórka) | **Znany wyjątek, nie naprawiony.** Stan pusty ma z założenia 3 fragmenty interfejsu zamiast ≥ 4. Dodanie czwartego wymagałoby zmyślonej wpłaty lub zdjęcia. Limit: dla tego ekranu overall ≤ 6,0. |
| `still-page` (zbiórka) | Ruch ograniczony celowo: wejścia sekcji + żywy panel; autoodtwarzanie wymagałoby kontrolki pauzy (WCAG 2.2.2). Przyznaję limit „design ≤ 7”. |
| `off-centre` (32 px z lewej, 64 px z prawej przy 1440) | **Nierozstrzygnięte (P2).** Krawędzie kontenerów mierzone sondą są równe (32/32); miara inspektora porównuje zasięg tekstu i prawdopodobnie łapie wewnętrzny odstęp prawego panelu. Wcześniejszy, głośniejszy FAIL `off-centre` przy 390 px na stronach zbiórek **zniknął po naprawie rozepchniętej ścieżki siatki** (zob. runda 2), więc dawny alarm był częściowo prawdziwy. |
| `app-title-size` | Ekrany robocze (checkout, profil) mają tytuły mniejsze niż strona marketingowa z założenia (`references/app-screens.md`). |

## 2. Runda 1 — pierwsza kompletna budowa (odtworzona; bez punktów)

Metoda: inspektor + oglądanie zrzutów 360–1440. Znalezione i naprawione:

| # | Usterka | Naprawa |
|---|---|---|
| 1 | Własne reguły CSS bez `@layer` (`.btn{display:inline-flex}`) nadpisywały narzędzia Tailwind (`hidden`) → przepełnienie nagłówka na telefonie | cały CSS niestandardowy w `@layer base/components` |
| 2 | Menu mobilne na `<details>` dawało fałszywe pomiary i ukryte linki w DOM | komponent klienta `MobileMenu` (linki w DOM tylko po otwarciu, Esc, `aria-expanded`) |
| 3 | Wiersze kwitu na wąskich ekranach: osierocone kropki prowadzące, wartości wypychające układ | wariant mobilny `.cc-row`, wariant bez prowadnicy `.cc-row--plain` |
| 4 | Tablet: ucięta kwota na plakietce, ściśnięte slipy i FAQ | przełączenie układu na `lg`, mniejsza skala kwoty |
| 5 | Pasek postępu niewidoczny na granacie i polu | zmienne `--meter-track/--meter-fill` per tło |
| 6 | Ukrywanie treści „reveal” także nad pierwszym ekranem (FOUC/LCP) | ukrywanie wyłącznie po hydracji i tylko poniżej pierwszego ekranu; „drukowanie” kwitu czystym CSS |
| 7 | Blok portfela: `dd` wypychał układ o 84–114 px przy 360/390 | `.cc-row--plain > :last-child {min-width:0}`; wykryte skryptem przepełnień, nie inspektorem |

## 3. Runda 2 — weryfikacja dostępności i układu (ta sesja)

Metoda: `a11y.mjs`, sondy układu przy 320–1440, przegląd zrzutów po każdej zmianie, E2E. **Zrzuty „przed” nie były archiwizowane**; dowodem są testy i raporty narzędzi.

| # | Znalezisko | Wykryte przez | Naprawa |
|---|---|---|---|
| 1 | nazwa dostępna przełącznika języka bez widocznego tekstu (2.5.3), 49 stron | axe | „PL, Polski” |
| 2 | nagłówek 26 px za szeroki przy 320 px | reflow | mniejszy znak, `flex-wrap` |
| 3 | grid bez jawnej ścieżki rozpychał kolumnę zbiórki (333 px w ekranie 320; **dawny FAIL `off-centre` @390**) | sonda układu + inspektor | `grid-cols-1` (`minmax(0,1fr)`) we wszystkich siatkach |
| 4 | przepełnienia pod nadpisanymi odstępami tekstu (do 49 px) | test 1.4.12 | łamanie długich słów w nagłówkach, zawijanie etykiet kwitu, adres bez `nowrap` |
| 5 | kwota „25,00 USDC” łamała się w środku słowa („USD/C”) w wierszu sumy | **oglądanie zrzutu 360** | zawija się tylko etykieta; kwota trzyma szerokość |
| 6 | „550,00 US/DC” na profilu przy 1440, potem zachodzenie kwoty na „5 500” | **oglądanie zrzutu 1440** | kolumny KPI dopasowane do treści; E2E „kolizja KPI” (mutacja potwierdza wykrywanie) |
| 7 | podpowiedź kwoty = **cały pozostały limit** dla kwoty poniżej minimum i dla zera (błąd funkcjonalny) | test jednostkowy | podpowiedź to minimum 1 USDC albo dokładne domknięcie |
| 8 | podpowiedź wstawiała „6,579.5” (separator tysięcy), którego walidator nie przyjmował | E2E | `amountToInput` + testy roundtripu |
| 9 | brak kontrastu granicy pola kwoty (1,14:1; WCAG 1.4.11) | ręczne obliczenie | obramowanie 2 px `ink-soft` (8,3:1; ADR-116) |
| 10 | teksty PL łamiące zasadę językową `docs/04` („sieć”, „opłata sieciowa”) | czytanie specyfikacji | przepisane; test jednostkowy pilnuje reguły (ADR-114 dla EN) |
| 11 | test menu mobilnego był pomijany na obu projektach (`isMobile`) | lista pominiętych | warunek po szerokości okna |

## 4. Runda 3 — krytyka z punktacją (finalny build)

```
ROUND 3
Seen in one second: biała kartka na granacie z napisem „WESPRZYJ I SPRAWDŹ” i wierszami kwitu.
Idea (one sentence): Strona jest kwitem darowizny: każda sekcja to wydrukowana kartka z pozycjami, sumą
  i zygzakowatą krawędzią, a „Wystaw kwit” zmienia kwit razem z kwotą.
Live thing: panel „Wystaw kwit” (kwota → odbiorca, 0% prowizji, koszt przesłania, pozostały limit,
  XP, walidacja jak w kontrakcie); na home kwit tylko „drukuje się” raz.
Layout words by section: hero=centered card / showcase=split(card|text) / jak-to-dziala=split(text|slip) /
  ligi=split(text|slip) / pytania=split(heading|2 columns) / cta=split(text|tilted card) / stopka=cropped card
Scores: design 6.0 · usability 7.0 · creativity 7.0 · content 7.5 → overall 6.65 → 6.5 po limitach
Caps applied: brak prawdziwych zdjęć → design ≤ 6.5 (nie obniża, bo 6.0); kropkowane prowadnice kwitu
  traktowane ostrożnie jako „dekoracyjna linia” → overall ≤ 6.5; zbiórka pusta: FAIL inspektora → overall ≤ 6.0;
  still-page (zbiórka) → design ≤ 7
Top three problems:
1. Sameness: pięć kolejnych sekcji to dwukolumnowy podział (home, 1440). Szablon prześwituje od „Jak to działa”
   w dół. Fix (nie wykonany): „Ligi” jako pozioma drabina plakietek na pełną szerokość, „Pytania” jako jedna
   kolumna z akordeonem; kwit zostaje tylko tam, gdzie jest obiektem (hero, panel, stopka).
2. Puste pola obok wysokich slipów przy 1440: pod „Ligi”, „Jak to działa” i na profilu pod paskiem postępu
   lewa kolumna ma 300–500 px martwego tła. Fix (nie wykonany): nagłówek sekcji sticky albo przeniesienie
   treści pomocniczej w lewą kolumnę.
3. Zero autentycznych obrazów: największy limit oceny, ale zamierzony (ADR-115). Fix: zdjęcia od organizacji
   z pisemną zgodą i metadanymi pochodzenia; do tego czasu nie udawać.
```

Pozytywy (nie punktowane): jedna metafora spina home, panel, checkout, odznakę i stopkę; stany błędów i brak budżetu mówią wprost „środki bez zmian”; polska typografia i teksty konkretne (bez sloganów); kontrast i fokus wyraźne; panel „Wystaw kwit” jest realnym, działającym elementem.

Oceny pozostałych ekranów (bez osobnej punktacji): zbiórka — ta sama metafora, panel sticky, najmocniejszy ekran; checkout i profil — ekrany robocze, czytelne, czysty wynik inspektora w trybie aplikacji; profil ma puste pole pod KPI przy 1440 (problem 2).

## 5. Co dalej (kolejność z `critique.md`: idea → hierarchia → układ → obrazy → detal)

1. Problem 1 i 2 (układ) — jedna iteracja z archiwizacją „przed/po”.
2. Uwagi właściciela do preview (AC-38).
3. ADR-114/115/116.
4. Test z czytnikiem ekranu i z ≥ 5 osobami spoza Web3 (AC-43/AC-63), po stronie właściciela.
5. Przegląd w Safari i Firefox (maski CSS, `text-wrap: balance`, `overflow-wrap`).
