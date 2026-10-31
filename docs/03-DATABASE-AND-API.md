# Modele danych, indeksator, API, uwierzytelnianie — CharOnChain MVP

## 1. Architektura przepływu

```
Wallet (Arbitrum One / Sepolia)
  ├── viem/wagmi -> USDC.approve() -> DonationRouter.donate()
  └── SIWE signature -> Next.js API -> sesja HttpOnly
                                   |
Arbitrum RPC -> indexer worker ----+--> Postgres (projekcje)
                                   |
                                   +--> public REST reads
                                   +--> org/admin workflows + RLS
                                   +--> Supabase Storage (public/private)
                                   +--> IPFS (tylko raporty publiczne / NFT)
```

- **Źródło prawdy finansowej:** chain; baza to projekcja dostępna do odtworzenia.
- **Źródło prawdy redakcyjnej:** Postgres dla opisów i prywatnego procesu akceptacji, onchain hash zatwierdzonej publicznej wersji.
- **Bezpieczna precyzja:** `NUMERIC(78,0)` dla raw USDC; `bigint`/`BigInt` w TS (w JSON zawsze string); brak floatów w rozliczeniach.
- **Wszystkie daty:** timestamptz UTC, UI według strefy użytkownika.
- **Adresy:** EIP-55 checksum do wyświetlania; unikalność po lowercase (np. `citext` lub dodatkowa kolumna); klucze `(chain_id, address_lower)`.
- **Baza UUID:** `gen_random_uuid()`; stale w repo migrations.

## 2. Schemat logiczny PostgreSQL

> Poniższe pola i constrainty są normatywne. Claude Code ma stworzyć wersjonowane migracje, RLS i indeksy dokładnie do tych encji; nazwy technicznych kolumn mogą być rozszerzone, ale nie wolno zmieniać semantyki rozliczeń bez ADR.

### `organizations`

| Kolumna | Typ | Wymaganie |
|---|---|---|
| `id` | uuid PK | publiczny identyfikator |
| `legal_name`, `display_name` | text | nazwa prawna i marketingowa |
| `country_code` | char(2) | ISO 3166-1 |
| `registry_number` | text nullable | identyfikator organizacji; publiczność według polityki |
| `status` | enum | `PENDING`, `UNDER_REVIEW`, `APPROVED`, `SUSPENDED`, `REJECTED` |
| `safe_address_lower` | varchar(42) | zweryfikowany adres fundacji na Arbitrum |
| `safe_chain_id` | int | 42161 lub 421614 |
| `verified_at`, `created_at`, `updated_at` | timestamptz | wersjonowanie |
| `verification_expires_at` | timestamptz nullable | re-review KYB |

Wydzielić **`organization_private`**: dane osób, kontakt, dokumenty KYB, wynik przeglądu i retencja. Nigdy nie zwracać w publicznym API. Dokumenty w prywatnym bucket, podpisane URL-e krótkoterminowe, tylko organ uprawniony.

### `organization_members`

`id uuid`, `organization_id uuid FK`, `wallet_lower varchar(42)`, `role enum(OWNER,MANAGER,REPORTER)`, `created_at`, `revoked_at`. Unique active membership; dodanie po potwierdzeniu kontroli portfela SIWE + podpisie zaproszenia lub decyzji admin; zmiana roli audytowana.

### `campaigns`

`id uuid PK`, `organization_id uuid FK`, `chain_id int`, `onchain_campaign_id bigint NULL`, `slug text unique`, `title text`, `summary text`, `description_md text`, `category text`, `status enum(DRAFT,SUBMITTED,UNDER_REVIEW,APPROVED,PUBLISHING,PUBLISHED,PAUSED,CLOSED,REJECTED)`, `cap_raw numeric(78,0)`, `start_at timestamptz`, `end_at timestamptz`, `beneficiary_lower varchar(42)`, `metadata_hash char(66)`, `cover_asset_id uuid nullable`, `created_by_wallet_lower`, `approved_by_wallet_lower`, `published_tx_hash char(66) nullable`, timestamps.

Constraints: `cap_raw > 0`, `end_at > start_at`, `onchain_campaign_id` unique per chain when non-null, published records require known tx hash and corresponding event, `beneficiary_lower` nie zmienia się po opublikowaniu. Status onchain może być chwilowo sprzeczny z DB do chwili indeksacji; prezentować status chain z ostatniego potwierdzonego zdarzenia.

### `campaign_revisions` / `campaign_reviews`

`campaign_revisions`: `id uuid`, `campaign_id`, `version int`, `content_json jsonb`, `content_sha256 char(66)`, `created_by`, `created_at`; unikalne `(campaign_id,version)`. Każda zmiana zachowuje historię. `campaign_reviews`: `id`, `campaign_id`, `revision_id`, `reviewer_wallet_lower`, `decision`, `reason_private`, `reason_public`, `created_at`.

**4-eyes rule:** autor/submitter nie może być jedynym zatwierdzającym; backend ma wymuszać rolę oraz niezależną akceptację. Onchain `createCampaign` dopiero po zatwierdzeniu.

### `chain_events` (kanoniczny journal)

`id uuid PK`, `chain_id int NOT NULL`, `contract_lower`, `event_name`, `tx_hash char(66)`, `log_index int`, `block_number bigint`, `block_hash char(66)`, `tx_index int`, `args jsonb`, `canonical bool`, `confirmation_state enum(OBSERVED,CONFIRMED,ORPHANED)`, `observed_at`, `confirmed_at`.

**Unique `(chain_id,tx_hash,log_index)` dla rekordu eventu**, nie podwójna księgowość. Na reorg rekordu nie usuwać bez śladu — zaznaczyć `ORPHANED` i zrebuildować projekcje; przy ponownym pojawieniu się identycznej transakcji/indeksu z innym blokiem aktualizować status z wersjonowaną historią.

### `donations` (projekcja z `DonationReceived`)

`id uuid`, `chain_event_id uuid unique FK`, `chain_id int`, `campaign_id uuid`, `onchain_campaign_id bigint`, `donor_wallet_lower varchar(42)`, `beneficiary_lower varchar(42)`, `token_address_lower`, `amount_raw numeric(78,0)`, `block_time timestamptz`, `status enum(PENDING,CONFIRMED,ORPHANED)`, `created_at`.

Constraints: `amount_raw >= 1000000`, token musi odpowiadać natywnemu USDC danego środowiska, event hash zgodny z kontraktem routera. `donations` i `donor_totals` są tylko do odczytu po stronie UI; **żadnych ręcznie pisanych rekordów „wpłata” przez web API**.

### `donor_profiles`, `donor_stats`

`donor_profiles`: `(chain_id, wallet_lower)` composite PK, `display_name nullable`, `avatar_asset_id nullable`, `bio nullable`, `leaderboard_opt_in bool default false`, `profile_public bool default false`, `created_at`, `updated_at`.

`donor_stats`: `(chain_id,wallet_lower)` PK, `total_donated_raw numeric(78,0)`, `xp numeric(78,0)`, `tier smallint`, `derived_at`, `source_block_number bigint`, `last_reconciliation_at`.

`donor_stats` jest **cache**: musi odpowiadać `DonationRouter.totalDonatedRaw` po potwierdzonym bloku; w razie niezgodności UI czyta bezpośrednio contract, cache oznaczony stale. Przy `suspended=true`, raw i XP się nie zerują, tylko publiczny tier może być `0` i status `under_review`.

### `impact_reports`, `impact_report_reviews`

`impact_reports`: `id uuid`, `campaign_id`, `version int`, `status enum(DRAFT,SUBMITTED,REDACTING,PUBLISHED,VERIFIED,REJECTED,REVOKED)`, `public_json_storage_path nullable`, `public_uri nullable`, `content_sha256 nullable`, `onchain_report_id bigint nullable`, `publish_tx_hash nullable`, `review_tx_hash nullable`, `period_start`, `period_end`, `created_by`, `created_at`, `updated_at`.

`impact_report_reviews`: `id`, `report_id`, `reviewer`, `decision`, `reason_public`, `reason_private`, `created_at`. Unique `(campaign_id,version)`. Wersje raportów są niemutowalne po `PUBLISHED`; korekta = wersja +1. Publiczny JSON kanonizowany wg RFC 8785 przed SHA-256.

### Pozostałe tabele

- `assets`: `id`, `bucket`, `object_path`, `mime`, `size_bytes`, `sha256`, `owner_org_id`, `visibility enum(PUBLIC,PRIVATE)`, `created_at`; zakaz zewnętrznych URL od użytkownika bez walidacji.
- `abuse_reports`: `id`, `campaign_id`, `reporter_wallet_lower nullable`, `category`, `details_private`, `attachment_asset_ids`, `status`, `handled_by`, `timestamps`.
- `audit_logs`: `id`, `actor_wallet_lower nullable`, `actor_type`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `request_id`, `created_at`. Append-only dostęp tylko do admina.
- `siwe_nonces`: `nonce_hash`, `wallet_lower nullable`, `domain`, `chain_id`, `issued_at`, `expires_at`, `used_at` (single use). Hashe nonce, brak przechowywania raw nonce w logach.
- `sessions`: identyfikator zaszyfrowanego/haszowanego tokenu sesji, wallet, expiracja, revoke timestamp; cookie HttpOnly/Secure/SameSite.
- `indexer_cursors`: `chain_id`, `contract_lower`, `last_scanned_block`, `last_confirmed_block`, `last_block_hash`, `updated_at`, `status`.
- `system_flags`: awaryjne wyłączenia checkout w UI, nie mogą zastępować on-chain pause.

## 3. Indeksy, RLS, polityka dostępu

- Publiczne: SELECT `organizations` tylko APPROVED (wybrane kolumny!), `campaigns` tylko PUBLISHED/PAUSED/CLOSED po zweryfikowanym evencie; SELECT potwierdzonych donations bez jakichkolwiek danych KYC; publiczne raporty zredagowane.
- Profile: odczyt własnego po SIWE, zapis wyłącznie własnych pól i wyłącznie przy aktywnej sesji; cudze niepubliczne profile niewidoczne. Wallet nie jest anonimowy na chainie — to ograniczenie prywatności, a nie gwarancja ukrycia kwot.
- Organizacja: członkowie tylko własnych draftów/raportów; nie mogą `APPROVE` własnych kampanii ani nadpisać onchain address po publikacji.
- Admin/weryfikator: wyłącznie przydzielone role serwerowe z audytem. Service role Supabase tylko w backendzie, bez publicznych kluczy.
- Prywatne storage i `organization_private` blokowane przez RLS nawet dla członków innych organizacji.
- `chain_events`, `donations`, `donor_stats`: write tylko przez zaufanego indexera z kontem serwisowym; zapisy nie przez klienta.
- **Indeksy:** `campaigns(status,created_at desc)`, `campaigns(organization_id,status)`, `donations(campaign_id,block_time desc)`, `donations(donor_wallet_lower,block_time desc)`, `chain_events(chain_id,block_number,log_index)`, `impact_reports(campaign_id,version desc)`, `audit_logs(entity_type,entity_id,created_at desc)`, partial on active members.
- SQL views/public RPC expose whitelist pól; nie polegać wyłącznie na RLS dla tajnych kolumn tabel ogólnych.

## 4. API v1 (JSON; wszystkie raw kwoty jako string)

| Method + route | Access | Request / response |
|---|---|---|
| `GET /api/v1/campaigns` | public | `q,category,status,page,cursor`; skrócona lista z onchain status/amount |
| `GET /api/v1/campaigns/:slug` | public | opis, benefit address, hard cap, `raisedRaw`, terminy, reports |
| `GET /api/v1/campaigns/:slug/donations` | public | stronicowane confirmed eventy, adresy donorów (można skracać do wyświetlenia, bez obietnic anonimowości) |
| `GET /api/v1/organizations/:id` | public | bez danych KYB prywatnych |
| `GET /api/v1/donors/:chainId/:address` | public | profil wyłącznie opt-in, odznaka i publiczne statystyki chain z zastrzeżeniem zakresu |
| `GET /api/v1/donors/me` | SIWE | pełny widok własnego profilu i historii |
| `PATCH /api/v1/donors/me` | SIWE | `displayName,bio,profilePublic,leaderboardOptIn` po walidacji |
| `POST /api/v1/auth/nonce` | public/rate-limited | `address,chainId`; nonce powiązany z domeną, TTL 5 min |
| `POST /api/v1/auth/verify` | public/rate-limited | `message,signature`; 1x nonce, EIP-4361, EIP-1271, cookie |
| `POST /api/v1/auth/logout` | SIWE | revoke cookie/session |
| `POST /api/v1/orgs/applications` | SIWE | wniosek organizacji, Safe, dane podstawowe |
| `POST /api/v1/orgs/:id/campaigns` | org manager | draft, data, kategorię, capRaw, start/end |
| `PATCH /api/v1/campaign-drafts/:id` | org manager | aktualizacja tylko do czasu submission |
| `POST /api/v1/campaign-drafts/:id/submit` | org manager | status submitted, immutable snapshot |
| `POST /api/v1/admin/campaigns/:id/review` | admin reviewer | approve/reject, reason, 4-eyes |
| `POST /api/v1/admin/campaigns/:id/publish-intent` | admin | przygotowuje calldata do Safe; nie podpisuje za admina |
| `POST /api/v1/orgs/:id/reports` | org reporter | draft raportu i dokumenty public/private |
| `POST /api/v1/reports/:id/submit` | org reporter | raport trafia do redakcji i weryfikacji |
| `POST /api/v1/admin/reports/:id/review` | reviewer | approval/rejection w backendzie |
| `GET /api/v1/campaigns/:slug/reports` | public | historia wersji i statusów wraz z tx |
| `POST /api/v1/abuse-reports` | auth/guest rate-limited | zgłoszenie nadużycia |
| `GET /api/v1/health/indexer` | admin | lag, reorg, ostatni confirmed block, errors |

**Ważne:** `POST /api/v1/donations` nie istnieje. Checkout podpisuje i wysyła transakcję bezpośrednio z portfela. Backend nie „tworzy” wpłat. Dla admin write API każdorazowo sprawdzaj rolę + CSRF + rate limit + audit log.

### Standard błędów

```json
{
  "error": {
    "code": "CAMPAIGN_CAP_EXCEEDED",
    "message": "Kwota przekracza pozostały limit kampanii.",
    "requestId": "req_..."
  }
}
```

Brak stack trace, SQL, wewnętrznych kluczy i treści dokumentów w publicznym błędzie. Statusy 400 (validation), 401, 403, 404, 409 (state conflict), 429, 503.

## 5. Auth SIWE i kontrola sesji

1. Frontend przygotowuje `address`, `chainId`; backend generuje losowy nonce >= 128 bit entropii, TTL 5 minut, one-time.
2. Wiadomość EIP-4361 zawiera dokładną domenę, URI, chain ID, czas, nonce i expiration.
3. Serwer waliduje domain/URI, nonce niezużyty, czas, chain, signature (EOA lub EIP-1271 wywołane na właściwej sieci).
4. Atomic consume nonce i wydanie sesji HttpOnly/Secure/SameSite=Lax; ograniczony czas ważności, rotacja, logout/revoke.
5. Sesja daje uprawnienia do profilu; **nigdy** nie jest zgodą na przesyłanie USDC ani podnoszenie uprawnień do admina.
6. Rola organizacji/admin sprawdzana na serwerze oraz przez RLS; nigdy tylko flagą w frontendzie.

## 6. Indexer

- Nasłuchuje jawnie skonfigurowanych adresów kontraktów i eventów. RPC na test/mainnet rozdzielone; mainnet wymaga stabilnego dostawcy RPC, fallback i limitów.
- `last_scanned` nie równa się `last_confirmed`: użyć konfigurowalnego bufora (np. 12 bloków L2) i opisać w UI jako „potwierdzone na Arbitrum”; to **nie** jest gwarancja finalizacji na Ethereum L1.
- Ponowne pobieranie zakresu z zakładką (np. 100 ostatnich bloków), zapis zdarzeń idempotentny. Przed awansem kursora sprawdzać hash bloku oraz aktualizować `canonical`.
- Przy reorg: oznaczyć logi orphan, odtworzyć agregaty, wyemitować status „reconciling” i zaktualizować frontend. Nie ukrywać od użytkownika anulowanej transakcji.
- `totalRaised` i `totalDonated` reconcile z publicznymi getterami kontraktów co najmniej cyklicznie oraz po awarii; alarm przy niezgodności.
- Chronić przed replay/backfill duplikatami i przedmiotową niezależnością tenantów.
- Bezpieczny restart: idempotentne ponawianie, retry/backoff, dead-letter job, alert.

## 7. Media, storage i privacy

- `public-campaign-assets` (obrazy, publiczne grafiki; CDN); `private-organization-docs` (KYC/KYB, signed URL); `public-report-attachments` (wyłącznie po redakcji), `private-abuse-attachments`.
- Walidacja typu po rzeczywistej zawartości (magic bytes), ograniczenie wielkości (np. obraz do 10MB, dokument do 20MB), re-encoding obrazów, stripping EXIF, antywirus/asynchroniczny skan dokumentów; odpowiednia CSP.
- Obowiązkowe usuwanie/retencja plików prywatnych zgodnie z przyjętą polityką prawną; publiczne IPFS tylko świadomie trwałe treści.
- Zrzut/zdjęcie z wizerunkiem i dane medyczne podlegają szczególnym regułom; jeśli brak ważnej podstawy prawnej, nie publikować.
- Dla NFT zestaw sześciu zweryfikowanych i pinowanych JSON metadanych + grafik w IPFS; brak danych osobowych i danych prywatnych w URI.

## 8. Non-functional / operations

- Dostępność katalogu/docelowo >=99.5% miesięcznie; checkout graceful degradation przy RPC awarii.
- p95 public API <800ms przy warunkach testu obciążenia (bez liczenia zewnętrznego wallet approval); TTI mobile monitorowane.
- Weryfikacja RLS, rate limiting i weryfikacja każdej mutacji.
- Backup Postgres z testem odtwarzania, oddzielne sekrety na środowiska, 2FA dla operacji admin; minimalny RPO 24h i RTO 8h jako wstępne cele do przeglądu.
- Logi z `requestId`, metryki bez danych wrażliwych; monitor RPC/indexer/reorg, Safe role changes, application errors, kontrakt pause; alert on-call.
- Nazwy tabel i endpointów nie są uzasadnieniem zbierania większej ilości danych — data minimization by design.

## 9. Rozszerzenie AA (v1.2) — PROPOZYCJA

Normatywny opis: `docs/11` §8–§9. Skrót, aby nie dublować treści:

- **SIWE:** dodać ERC-6492 (konta niewdrożone) obok EIP-1271; weryfikacja 6492 wyłącznie z zatwierdzonymi fabrykami (`§5` pkt 3 zachowuje domenę/chain/nonce/atomowe zużycie).
- **Nowe tabele (service role, RLS deny-by-default):** `wallet_accounts`, `user_operations`, `sponsorship_decisions` (append-only), `sponsorship_budgets`. Brak e-maila i identyfikatorów społecznościowych w naszej bazie.
- **`donations`:** dodać `user_op_hash` (nullable). `unique(chain_event_id)` i klucz `(chain_id, tx_hash, log_index)` bez zmian — w transakcji bundlera może być wiele darowizn różnych użytkowników, każda z innym `log_index`.
- **API:** `POST /api/v1/aa/paymaster` (ERC-7677), `GET /api/v1/aa/user-operations/:userOpHash`, `GET /api/v1/health/sponsorship` (admin). `POST /api/v1/donations` **nadal nie istnieje**.
- **Indexer (`§6`):** śledzi także `UserOperationEvent`/`UserOperationRevertReason`; rekoncyliacja kosztu i depozytu paymastera; reorgi → `ORPHANED` jak dla `chain_events`.
- **Zastrzeżenie (DOC-01, `docs/10` §5):** `donations.amount_raw >= 1000000` (§2) jest sprzeczne z wyjątkiem „końcówka celu” z `docs/02` §2 i AC-04. **Nie zmieniono** — propozycja poprawki (`amount_raw > 0`) czeka na decyzję właściciela (komponent finansowy).
