# @charonchain/api

Logika API v1 niezależna od frameworka (COC-032): funkcje `(ctx, input) → { status, body, headers }`. Trasy Next.js tylko tłumaczą `Request`/`Response`. **Nie jest jeszcze podpięte do `apps/web`** (brak puli połączeń roli `app_api` i konfiguracji środowiska).

- Czyta **wyłącznie** z widoków `public_*` (migracje 0005/0006) na roli `app_api`; prywatne tabele są poza zasięgiem nawet przy błędzie zapytania.
- Kwoty zawsze jako ciągi dziesiętne (jednostki najmniejsze USDC); stronicowanie keyset (kursor nieprzejrzysty, zmanipulowany → `INVALID_CURSOR`).
- Błędy: `{ error: { code, message, requestId } }`, bez SQL, stack trace i wartości wejściowych (`respond`/`toErrorResponse`).
- **`projection`** w odpowiedziach z sumami (AC-33): `OK` = indexer działa i uzgodnienie z kontraktem nie wykryło różnic; `STALE`/`ERROR`/`UNAVAILABLE` ⇒ `final: false` — interfejs nie może wtedy prezentować sum jako ostatecznych.
- Brak: rate limit, nagłówki bezpieczeństwa, CSRF i uwierzytelnione endpointy (COC-033, trasy w `apps/web`).

Testy: `pnpm test:db` (wymaga `TEST_DATABASE_URL`).
