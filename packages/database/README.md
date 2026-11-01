# @charonchain/database

Migracje Postgres/Supabase, runner i narzędzia (COC-004). Schemat docelowy: `docs/03-DATABASE-AND-API.md`.

## Konwencje

- Pliki `migrations/NNNN_nazwa.up.sql` + `NNNN_nazwa.down.sql`, numeracja ciągła od 0001. **Nie edytuj zastosowanej migracji** — runner wykrywa zmianę (suma kontrolna) i odmówi pracy; dodaj nową.
- Pliki nie zawierają `BEGIN/COMMIT/ROLLBACK` (runner zarządza transakcją). Bloki `begin … end;` w funkcjach PL/pgSQL są dozwolone.
- Wspólne typy w schemacie `app` (niewystawianym przez API): `app.evm_address` (adres małymi literami), `app.hash32`, `app.usdc_raw` (`NUMERIC(78,0)`, 0…uint256), `app.touch_updated_at()`.
- Tabela runnera: `private.schema_migrations` (RLS włączone, deny-by-default).
- Każda nowa tabela w `public`/`app`/`private` musi mieć włączone RLS — sprawdza to `findTablesWithoutRls` (używaj w testach).
- Migracje nie odwołują się do ról Supabase (`anon`, `authenticated`, `service_role`). Polityki RLS powstają razem z tabelami (COC-023).

## Użycie

```bash
pnpm --filter @charonchain/database run build
```

```bash
APP_ENV=local DATABASE_URL=postgres://user:pass@localhost:5432/charonchain node packages/database/dist/cli.js up
```

Polecenia: `up`, `down [n]`, `status`, `seed`. Bezpieczeństwo celu (`src/target.ts`):

| `APP_ENV` | Wymagania | `down` | `seed` |
|---|---|---|---|
| `local` (domyślne) | host lokalny | tak | tak |
| `staging` | dowolny host | tak | tak |
| `production` | `MIGRATE_CONFIRM_PRODUCTION=<host>`, host nielokalny | **nie** | **nie** |

Hasła nigdy nie są wypisywane. Operacje na produkcji wymagają osobnej, jawnej zgody właściciela (`docs/05` §6).

## Testy

- `pnpm test` — jednostkowe (bez bazy): pliki migracji, bezpieczeństwo celu.
- `pnpm test:db` — integracyjne na **prawdziwym Postgresie**; wymaga `TEST_DATABASE_URL` (rola z `CREATEDB`). Każdy plik tworzy i usuwa własną bazę. Brak zmiennej to błąd, nie pominięcie.

## Czego tu nie ma

Lokalny stos Supabase (`supabase start`) wymaga Dockera i konta/projektu Supabase — poza zakresem sesji COC-004; konfigurację `supabase/` i połączenie z projektem wykonuje właściciel lub osobne zadanie po decyzji. Seedy dla encji powstają razem z tabelami (COC-020..022).

## Tabele projekcji (COC-021, migracja 0002)

`chain_events` (journal, unikalność `(chain_id, tx_hash, log_index)`, niemutowalna tożsamość, **brak DELETE** — reorg to `ORPHANED`), `chain_event_history` (append-only), `donations` (ADR-112: `amount_raw > 0`), `donor_stats` (cache; `xp`/`tier` wymuszone zgodnie z progami PRD — lustro `packages/shared`, zgodność sprawdza test), `indexer_cursors`. Wszystkie z RLS deny-by-default i odebranymi uprawnieniami rolom `anon`/`authenticated`; zapisuje wyłącznie zaufany indexer. FK `donations → campaigns` dodała migracja 0003.

## Organizacje i kampanie (COC-020, migracja 0003)

`organizations` (publiczne; `APPROVED` wymaga zweryfikowanego Safe, jeden Safe = jedna organizacja na sieci), `organization_private` (dane osób, kontakt, KYB, retencja — tylko backend), `organization_members` (jedno aktywne członkostwo portfela), `campaigns`, `campaign_revisions` (append-only), `campaign_reviews` (append-only, 4-eyes).

Reguły egzekwowane w bazie (obrona w głąb; backend też je wymusza): dozwolone przejścia statusu kampanii; od `PUBLISHING` zamrożone są beneficjent, limit, okno, sieć i organizacja (INV-05, AC-03); `PUBLISHED` tylko po **potwierdzonym, kanonicznym** zdarzeniu `CampaignCreated` zgodnym z kampanią (AC-01; konwencja `chain_events.args`: klucze jak w ABI, liczby jako ciągi dziesiętne, adresy małymi literami); kampania niezatwierdzonej organizacji nie przechodzi do `APPROVED` (AC-02); autor kampanii ani aktywny członek organizacji nie zatwierdzają jej (4-eyes); kampanii nie usuwa się. `donations` ma złożony FK do `campaigns (id, chain_id, onchain_campaign_id)`. RLS włączone, bez polityk (COC-023).

## Raporty, zasoby, audyt, SIWE (COC-022, migracja 0004)

`assets` (koszyk ⇒ widoczność; publiczny plik tylko po czystym skanie; bez SVG; limity 10/20 MB; okładka kampanii to wyłącznie publiczny obraz), `impact_reports` + `impact_report_reviews` (wersje bez luk, niemutowalne po `PUBLISHED`, `PUBLISHED/VERIFIED/REVOKED` tylko po potwierdzonym zdarzeniu z łańcucha o zgodnej treści; recenzent ≠ autor ≠ członek organizacji), `abuse_reports`, `audit_logs` (append-only, także TRUNCATE), `siwe_nonces` (TTL ≤ 15 min, **atomowe zużycie** funkcją `app.consume_siwe_nonce`), `sessions` (token tylko jako hash, TTL ≤ 30 dni, `app.session_wallet`), `system_flags` (`checkout_disabled`), `donor_profiles` (domyślnie prywatne). `app.purge_expired_auth()` sprząta tylko dawno nieaktualne nonce i sesje; **retencja plików prywatnych i zgłoszeń nadużyć czeka na politykę prawną** (kolumna `retention_until` istnieje, automatycznego usuwania nie ma).

Testy `*.db.test.ts` tworzą role `anon`/`authenticated`, jeśli ich brak (wymaga uprawnień do tworzenia ról; w CI rola `postgres`), a do `SET ROLE` wymagają członkostwa w tych rolach.
