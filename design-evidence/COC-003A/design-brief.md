# COC-003 / COC-003A — brief wykonawczy (kierunek B „Kwit”)

Stan: **IN_REVIEW**, nie DONE. Ten dokument opisuje, co zostało zbudowane, jak i z jakich decyzji. Oceny i usterki: `review.md`. Dostępność: `a11y.md`. Wszystkie dane na ekranach są **DEMO** (oznaczone w interfejsie); nie ma żadnych prawdziwych organizacji, wpłat ani zdjęć.

## 1. Pomysł (jedno zdanie) i test konkurenta

> **Strona jest kwitem darowizny.** Każdy ekran to wydrukowana kartka z pozycjami, sumą i zygzakowatą krawędzią, a „Wystaw kwit” to żywy element, który zmienia kwit razem z kwotą.

Test konkurenta: platformy zbiórek nie wystawiają publicznie sprawdzalnego kwitu jako produktu; po zamianie nazwy zdanie przestaje działać. Element żywy: panel „Wystaw kwit” na stronie zbiórki (kwota, odbiorca, prowizja 0%, koszt przesłania, pozostały limit, XP przeliczają się na bieżąco i walidują tymi samymi regułami co kontrakt).

## 2. Skille: co faktycznie użyto (AC-36)

| Skill | Użycie w tej pracy |
|---|---|
| `design-taste-frontend` (Taste, v2) | brief, inwentarz, argument sekcji, losowanie kierunków (`draw.mjs`), zdanie-idea; **statyczny lint** `lint.mjs` (0 FAIL, 1 WARN: 17 myślników, głównie znaki „—” jako puste wartości); **inspektor w przeglądarce** `inspect.mjs` (tryb strony dla home i zbiórek, `--app` dla checkoutu i profilu) na finalnym buildzie; krytyka według `references/critique.md` (`review.md`) |
| `frontend-design` (Anthropic) | plan tokenów i układu, wireframe'y, przegląd pod kątem „generycznych domyślnych” (`docs/DESIGN-DECISIONS.md` §4) |

Ślady: `docs/DESIGN-DECISIONS.md` §0, raporty inspektora w `.taste-skill/` (poza repo, `.gitignore`), liczby w `review.md`.

## 3. Tokeny (źródło prawdy: `packages/ui/src/styles.css`)

| Token | Wartość | Rola |
|---|---|---|
| `navy` / `navy-2` | `#0C1527` / `#14213A` | pole ciemne, panel stanu |
| `paper` | `#F6F9FC` | kwit, karty |
| `field` | `#E4EBF4` | pole jasne (sekcje, pola formularza) |
| `ink` / `ink-soft` / `muted` | `#162033` / `#3E4B63` / `#55627A` | tekst na jasnym |
| `mist` | `#A9B8CE` | tekst drugorzędny na granacie |
| `mint` | `#53D5AE` | wyłącznie na granacie albo jako wypełnienie przycisku (nigdy tekst na jasnym) |
| `success/warning/critical` (+ `-on-navy`) | `#19694A` / `#7A5200` / `#A5281F`; `#6FE0B5` / `#F2C46B` / `#FF9A8F` | statusy, zawsze z tekstem, nigdy sam kolor |

Kontrasty policzone skryptem (nie z samych wartości hex): tekst ≥ 5,8:1 na swoim tle, większość ≥ 8:1; elementy nietekstowe i pole formularza: patrz `a11y.md` §4.

Typografia (self-hosted, `@fontsource-variable`, bez CDN, RODO): **Libre Franklin** (nagłówki, display) i **Source Serif 4** (tekst), pełny zestaw polskich znaków sprawdzony w renderze. Skala: `--text-small` ≥ 1rem, `--text-display` `clamp(2.75rem, 1.4rem + 4.8vw, 5rem)`. Interpunkcja polska: spacja niełamliwa po jednoliterowych wyrazach (test jednostkowy).

Kształt zamiast ramek: maski (`zygzak`, `festony`, `wcięcia`) i perforacja. Funkcjonalne obramowanie ma tylko pole kwoty (WCAG 1.4.11). Ruch: sygnatura to „drukowanie” pozycji kwitu raz po załadowaniu (czyste CSS, bez autoodtwarzania); wejścia sekcji poniżej pierwszego ekranu; przy `prefers-reduced-motion` wszystko od razu widoczne (przetestowane).

## 4. Zakres ekranów

| Ekran | Trasa | Stany |
|---|---|---|
| Home | `/pl`, `/en` | hero-kwit, trzy dowody, plansza zbiórek, jak to działa, ligi, pytania, wezwanie |
| Zbiórka | `/{lang}/campaigns/{slug}` | normalna, **końcówka celu (0,50 USDC)**, **pusta (bez wpłat i raportów)**, panel z błędami walidacji |
| Checkout | `/{lang}/campaigns/{slug}/donate?amount=…&state=…` | review, authorizing, submitted, **confirmed**, rejected, sponsorship (brak budżetu), reverted, invalid; `OP_INCLUDED` nie jest sukcesem (docs/11 §7) |
| Profil | `/{lang}/profile` | KPI, postęp do ligi, odznaka (przed/po odbiorze), historia, prywatność |

Dane: `apps/web/src/demo/*` (trzy zbiórki demonstracyjne, w tym przypadki brzegowe). Interfejs nigdy nie pokazuje „100% zweryfikowane”: płatność, organizacja i wynik pomocy mają osobne statusy (CLAUDE.md pkt 12), testy słowników pilnują zakazanych fraz (żargon, fałszywa pilność, gwarancje).

## 5. Decyzje i odstępstwa (jawnie)

1. **Hero bez zdjęcia.** Slot „karta przycięta” zamiast slotu ze zdjęciem: CharOnChain nie ma prawdziwych, zatwierdzonych zdjęć, a zdjęcia stockowe udające beneficjentów łamią AC-41 i CLAUDE.md pkt 20. Skutek: Taste ma ostrzeżenia `no-real-pictures`/`no-footage`, a krytyka ma limit „design ≤ 6,5” (`review.md`).
2. **Sygnatura ruchu zmieniona** z „wolnego przenikania” na „drukowanie kwitu”: autoodtwarzany ruch wymagałby kontrolki pauzy (WCAG 2.2.2).
3. **Checkout jako ekran aplikacji** (`inspect --app`), bo to ekran roboczy, nie strona marketingowa.
4. **Słownictwo Beginner (docs/04 §zasada językowa):** w polskim interfejsie na ścieżce głównej nie ma „gas/approve/seed/sieć”; „sieć” zostaje tylko w szczegółach technicznych (etykieta portfela Safe i akordeon). Test jednostkowy pilnuje reguły. **Wersja EN nie została jeszcze przejrzana pod tym kątem** (propozycja w `docs/DECISIONS.md`).
5. **Pusta zbiórka**: inspektor zgłasza `few-pictures` (3 fragmenty interfejsu zamiast ≥ 4), bo stan pusty z założenia ma mniej treści; nie dodajemy zmyślonych wpłat ani zdjęć. Znany wyjątek.

## 6. Mapowanie AC-36..43

| AC | Stan | Dowód |
|---|---|---|
| AC-36 skille | PASS | sekcja 2 |
| AC-37 art direction | PASS | `docs/DESIGN-DECISIONS.md` §3–5 (3 kierunki, rekomendacja przed implementacją, wybór właściciela) |
| AC-38 preview gate | **IN_REVIEW** | home, zbiórka, checkout (+ profil) mają działający preview i zrzuty; czeka na uwagi właściciela |
| AC-39 responsywność | PASS (renderowane) | zrzuty 360/390/768/1280/1440 i 320; `overflowX=0` na wszystkich; E2E „brak poziomego przewijania” 10 ekranów × 2 rozmiary |
| AC-40 dostępność | **PASS automatyczna, ręczna niepełna** | `a11y.md` (axe 83/83, fokus, cele dotykowe, reduced-motion); brak testu z czytnikiem ekranu |
| AC-41 autentyczna treść | PASS | wszystko oznaczone DEMO, brak zdjęć/donorów/„verified” |
| AC-42 dwie rundy before/after | **PARTIAL** | rundy opisane w `review.md`; zrzuty „przed” z rund 1–2 nie były archiwizowane |
| AC-43 trust-first checkout | **NIE ZBADANE** | wymaga testu z ≥ 5 osobami spoza Web3 (po stronie właściciela) |

Warunek zamknięcia COC-047 (AC-36..43 PASS) **nie jest spełniony**; dlatego status to IN_REVIEW.

## 7. Jak odtworzyć

```bash
pnpm install --frozen-lockfile
pnpm --filter @charonchain/web build
pnpm --filter @charonchain/web exec next start -p 3100 &
QA_BASE_URL=http://localhost:3100 tools/visual-qa/capture-all.sh   # zrzuty (5 szerokości + 320, stany, reduced-motion)
QA_BASE_URL=http://localhost:3100 node tools/visual-qa/a11y.mjs     # axe + fokus + reflow + odstępy tekstu
pnpm test:e2e                                                       # Playwright (uruchamia własny serwer)
```

W kontenerze działającym jako root przeglądarka wymaga `--no-sandbox` (wrapper w `/usr/bin/google-chrome`, zmienna `PLAYWRIGHT_CHROME_PATH`).
