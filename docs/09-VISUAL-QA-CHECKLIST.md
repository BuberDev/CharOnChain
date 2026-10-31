# CharOnChain — Visual QA i twarde bramki odbioru (v1.1)

To checklista dla Claude Code, code review i właściciela. **Testy automatyczne nie zastępują ręcznej oceny wizualnej.** Nie stosuj sztucznego wyniku 10/10 jako dowodu jakości.

## 1. Macierz pokrycia ekranów

- Public: UX-01 home; UX-02 katalog; UX-03 karta zbiórki; UX-04 checkout; UX-05 status; UX-06 organizacja; UX-07 impact; UX-17 trust; UX-18 legal.
- User: UX-08 własny profil; UX-09 publiczny profil; UX-10 leaderboard.
- Org: UX-11 apply; UX-12 portal; UX-13 kreator; UX-14 raporty.
- Admin: UX-15 moderacja; UX-16 monitor blockchain.
- AA / Beginner (v1.2): UX-19 logowanie; UX-20 „Twoje konto”; UX-21 zasil konto USDC; UX-22 autoryzacja darowizny; UX-23 odzyskiwanie; UX-24 tryb zaawansowany. Krytyczne w 360/390 px: UX-19, UX-21, UX-22; stany: sponsorowanie niedostępne, brak budżetu, operacja odrzucona, operacja zrewertowana, dostawca niedostępny.

**Każdy ekran**: mobile/desktop, empty/loading/error/success/long-text oraz role-based permissions jeśli adekwatne. Krytyczne: checkout w 360/390 px, wallet errors, confirm dialog, niedostępna sieć/RPC.

## 2. Wymagane artefakty PR

- `design-evidence/<PR-or-task>/design-brief.md` — odbiorca, zadanie ekranu, decyzje wizualne, realnie użyte skille.
- `design-evidence/<PR-or-task>/screenshots/` — screenshoty przeglądarki (realny render, nie generowane mockupy udające działający ekran) przy 360, 390, 768, 1280, 1440 px, PL i EN na reprezentatywnych ekranach.
- `design-evidence/<PR-or-task>/review.md` — lista usterek, priorytet P0/P1/P2, before/after, zamknięcie lub uzasadnienie.
- `design-evidence/<PR-or-task>/a11y.md` — wyniki axe / Playwright oraz ręczne focus/keyboard i screen reader smoke.
- W razie braku narzędzia browser screenshot, zapisz BLOCKED i brakujące testy zamiast tworzyć fikcyjne raporty.

## 3. Checklista jakości (ocena pass/fail)

| Obszar | Warunek odbioru |
|---|---|
| Art direction | Wybrany kierunek opisany, autorski, powiązany z filantropią; brak generycznych crypto-neon/gradient cards |
| Hierarchia | Cel zbiórki i CTA są czytelne w pierwszym ekranie; reputacja nie dominuje nad pomocą |
| Typografia | Czytelna na 360 px, poprawne polskie znaki, 1 H1 na stronę, tabular numerals |
| Layout | Brak poziomego scrolla, nakładających się elementów, uciętych etykiet i layout shifts |
| UI states | Każda akcja ma feedback; success nie myli approve z donate; empty/error opisuje następny krok |
| RWD | Test 360/390/768/1280/1440; kluczowy CTA nie zasłania disclosures |
| A11y | WCAG 2.2 AA; kontrast w faktycznych kombinacjach, keyboard/focus, 44px cele, aria, reduced motion |
| Wydajność | PageSpeed/Lighthouse i Web Vitals odnotowane; budżet doprecyzowany na rzeczywistym stagingu, brak zbędnych ciężkich animacji |
| Obrazy | Licencje i zgody potwierdzone, alt właściwy, obraz nie przedstawia fikcyjnego beneficjenta jako realnego |
| Dane | Brak fałszywych wpłat, recenzji, procentów i „verified” bez dowodu; demo jasno oznaczone |
| Finanse | Wyraźnie pokazane: USDC, Arbitrum, odbiorca Safe, gas, 0% obligatory fee, no auto refunds |
| Spójność | Jedno źródło tokenów, wspólne komponenty, identyczne wzorce formularzy i error states |

## 4. Visual regression & interaction

- Playwright snapshoty na stabilnych fixture'ach (fonty/locale/dane/clock przypięte) na głównych ekranach; zdjęcia dynamiczne maskowane lub z deterministycznymi fixture'ami.
- Interakcje: menu mobile, filtry, wyszukiwanie, checkboxy, dropdown, walidacja kwoty USDC, connect/wrong chain, approve, donation, NFT claim, raport, upload i role admin.
- Skontroluj długie nazwy organizacji, błędne polskie łamanie słów, 6 miejsc po przecinku, długie adresy EVM, wartości 0 i 100 000+ USDC.
- Przejdź minimum dwie rundy krytyki wizualnej głównych ekranów, z rzeczywistymi screenshotami i poprawkami.

## 5. Kryteria akceptacji — rozszerzenie AC-36..43

- **AC-36 / skills:** dla każdego zadania UI istnieje ślad odczytania i użycia `design-taste-frontend` oraz `frontend-design` w bieżącej sesji; jeśli którykolwiek niedostępny, status BLOCKED.
- **AC-37 / art direction:** co najmniej 3 warianty kierunku wizualnego i zapisana rekomendacja przed implementacją docelowych UI; wybór zawiera brand tokens, typografię, kompozycję i argumentację.
- **AC-38 / preview gate:** home, campaign detail, checkout mają reviewable preview i konsolidację uwag przed rozpoczęciem implementacji pozostałych ekranów.
- **AC-39 / responsive:** brak overflow/overlap/clip przy 360/390/768/1280/1440 na krytycznych ekranach; testowane na renderach browsera, nie tylko CSS assertions.
- **AC-40 / accessibility:** axe bez krytycznych/poważnych błędów w głównych flow; ręczny keyboard/focus, contrast, reduced-motion i test dotykowych elementów.
- **AC-41 / authentic content:** brak nieoznaczonych danych demo, obrazów fikcyjnych beneficjentów i nieudokumentowanych „verified”; wymagane jawne placeholdery do czasu zatwierdzenia.
- **AC-42 / polish review:** dwie rundy screenshot audit przed/po, jawny raport usterek i napraw na home, campaign, checkout, profile.
- **AC-43 / trust-first checkout:** UX test potwierdza, że USDC, sieć, Safe, gas, approve/donate i brak automatycznych zwrotów są zrozumiałe dla testującego, bez znajomości Web3. *(v1.2: rozszerzone o AC-63 — test z ≥5 osobami bez wiedzy o krypto, ścieżka rejestracja → zasilenie → darowizna.)*

**Warunek zamknięcia COC-047:** AC-36..43 PASS, dowody w repo, brak nierozwiązanych P0/P1 w krytycznych ścieżkach. Jeśli wynik jest niejednoznaczny, oznacz jako IN_REVIEW, a nie DONE.
