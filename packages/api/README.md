# @charonchain/api

Logika API v1 niezależna od frameworka (COC-032): funkcje `(ctx, input) → { status, body, headers }`. Trasy Next.js tylko tłumaczą `Request`/`Response`. **Nie jest jeszcze podpięte do `apps/web`** (brak puli połączeń roli `app_api` i konfiguracji środowiska).

- Czyta **wyłącznie** z widoków `public_*` (migracje 0005/0006) na roli `app_api`; prywatne tabele są poza zasięgiem nawet przy błędzie zapytania.
- Kwoty zawsze jako ciągi dziesiętne (jednostki najmniejsze USDC); stronicowanie keyset (kursor nieprzejrzysty, zmanipulowany → `INVALID_CURSOR`).
- Błędy: `{ error: { code, message, requestId } }`, bez SQL, stack trace i wartości wejściowych (`respond`/`toErrorResponse`).
- **`projection`** w odpowiedziach z sumami (AC-33): `OK` = indexer działa i uzgodnienie z kontraktem nie wykryło różnic; `STALE`/`ERROR`/`UNAVAILABLE` ⇒ `final: false` — interfejs nie może wtedy prezentować sum jako ostatecznych.
- **Zapis (COC-033):** `withActor` uruchamia każde żądanie w transakcji jako `app_api` z `app.wallet` z sesji (`SET LOCAL`); autoryzację egzekwuje baza (RLS + wyzwalacze), API mapuje odmowy na `403/404/409` bez treści błędów SQL i zapisuje audyt w tej samej transakcji. Moduły: `org-campaigns` (wniosek organizacji, szkic, edycja, zgłoszenie z niezmienną rewizją), `admin` (kolejka, przegląd 4-eyes, publish-intent → calldata dla Safe, anulowanie). Backend nie podpisuje ani nie wysyła transakcji; `PUBLISHED` ustawia tylko indexer.
- Brak: rate limit, nagłówki bezpieczeństwa, CSRF, uwierzytelnienie sesji (cookie → portfel) i trasy w `apps/web`; zatwierdzanie organizacji (KYB) i API raportów wpływu (ADR-121).

Testy: `pnpm test:db` (wymaga `TEST_DATABASE_URL`).
