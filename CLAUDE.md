# Claude Code — instrukcje repozytorium CharOnChain

1. Zanim napiszesz kod, przeczytaj README, docs/01–06 oraz docs/08–09. Dokumenty są źródłem prawdy; sprzeczności zgłoś i nie rozwiązuj arbitralnie w komponentach finansowych.
2. Realizuj jedno zadanie `COC-xxx` na gałąź/PR. W każdym PR podaj kryteria akceptacji, ryzyka, testy, zmienione API i migracje.
3. Domyślnie pracuj na **Arbitrum Sepolia** i lokalnych mockach; **nie deployuj na mainnet i nie używaj prawdziwych pieniędzy** bez jawnej decyzji właściciela i spełnienia bramek bezpieczeństwa.
4. Stos: TypeScript strict + Next.js (App Router), Supabase Postgres/Storage, wagmi/viem, Solidity/OpenZeppelin 5.x/Foundry. Wersje zależności przypnij po weryfikacji kompatybilności; żadnych `latest` w produkcji.
5. W kontraktach: niezmiennego beneficjenta nie zmieniaj; żadnych funkcji admin-withdraw; żadnego upgrade proxy w MVP; żadnych niezweryfikowanych tokenów; zero niejawnych prowizji.
6. Każde zdarzenie chain jest konsumowane idempotentnie, z obsługą reorgów i potwierdzeń; suma w bazie jest **projekcją**, nigdy źródłem prawdy.
7. Wszystkie kwoty przechowuj jako integer `uint256`/`NUMERIC(78,0)` w jednostkach najmniejszych USDC (6 decimals); frontend używa biblioteki do BigInt, nie floatów JavaScript.
8. Pojedynczy portfel = pojedyncza tożsamość NFT w MVP. Nie implementuj migracji reputacji między portfelami bez osobnego ADR i modelu zagrożeń.
9. Zawsze sprawdzaj autoryzację na serwerze i RLS Supabase. Sekrety w env, nigdy w kodzie klienta ani w logach. Service role wyłącznie na backendzie.
10. PII, dokumentów beneficjentów, surowego KYC nie umieszczaj na IPFS ani blockchainie. Publiczny raport musi przejść redakcję danych.
11. Testy wymagane przy każdej zmianie: Foundry unit + fuzz/invariant dla kontraktów, unit/integration dla backendu, Playwright dla ścieżek krytycznych; aktualizuj testy wraz ze zmianą zachowania.
12. W interfejsie czytelnie odróżniaj: transakcję on-chain, weryfikację organizacji i rzeczywiste potwierdzenie rezultatu. Nigdy nie pokazuj „100% zweryfikowane”, jeśli brak niezależnego dowodu.
13. Używaj PL jako języka domyślnego, EN jako drugiego; uwzględniaj WCAG 2.2 AA. Brak dark patterns, fałszywego urgency oraz nieprawdziwych liczb darczyńców.
14. Nie zakładaj bez pytania uprawnień do deployowania, wykonywania transakcji, przetwarzania danych osobowych lub publikowania publicznie.
15. Jeśli wymagana decyzja produktowa jest otwarta, wpisz ją w `docs/DECISIONS.md` jako propozycję, nie jako wdrożony fakt.

## OBOWIĄZKOWY PROTOKÓŁ DESIGN / UI — bez wyjątków dla frontend PR

16. Zanim rozpoczniesz jakiekolwiek zadanie UI (COC-003/003A/040–047, landing, dashboard, redesign), przeczytaj `docs/08-DESIGN-SYSTEM-AND-SKILLS.md` oraz `docs/09-VISUAL-QA-CHECKLIST.md`.
17. Sprawdź, czy Claude Code **rzeczywiście ma dostęp** do obu skilli: `design-taste-frontend` (Taste) i `frontend-design` (Anthropic Design). Przeczytaj ich aktualne `SKILL.md`, zastosuj workflow i udokumentuj realne użycie. Jeśli niedostępne: UI task BLOCKED; nie udawaj użycia skilla.
18. Przed implementacją wybierz kierunek spośród 3 odmiennych art directions, przygotuj brand tokens, preview home/campaign/checkout i odnotuj decyzje w `docs/DESIGN-DECISIONS.md`. Wierność prawdzie transakcji, przejrzystość, WCAG i bezpieczeństwo mają pierwszeństwo przed efektami estetycznymi.
19. Wymagane realne screenshoty przeglądarki 360/390/768/1280/1440, PL/EN, kluczowe stany i co najmniej dwie iteracje visual review. Nie uznawaj frontendu za DONE bez AC-36..43, testów a11y, screenshot artifacts i QA pass; gdy brak narzędzia browser — raportuj BLOCKED.
20. Żadnego nieuzasadnionego AI-template look, crypto-neonu, nadmiarowych gradientów, lorem ipsum w produkcji, fikcyjnych KPI, donorów/recenzji ani fake verifications. Nie zastępuj jakości wizualnej samą implementacją shadcn.
