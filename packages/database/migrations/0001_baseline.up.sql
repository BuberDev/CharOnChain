-- 0001_baseline (COC-004)
-- Wspólne typy i funkcje zgodne z konwencjami z docs/03 §1. Brak tabel domenowych (COC-020..022).
-- Nie odwołuje się do ról Supabase (anon/authenticated/service_role): te role tworzy platforma,
-- a polityki RLS powstają razem z tabelami (COC-023).

create schema if not exists app;

comment on schema app is
  'Wspólne domeny i funkcje CharOnChain. Schemat nie jest wystawiany przez API (nie dodawać do exposed schemas).';

-- Adres EVM: zawsze małe litery (klucz techniczny; checksum EIP-55 tylko do wyświetlania) — docs/03 §1.
create domain app.evm_address as varchar(42)
  check (value ~ '^0x[0-9a-f]{40}$');

-- Hash 32 B (tx hash, block hash, SHA-256, bytes32) — małe litery hex z prefiksem 0x.
create domain app.hash32 as char(66)
  check (value ~ '^0x[0-9a-f]{64}$');

-- Kwota USDC w jednostkach najmniejszych: NUMERIC(78,0) w zakresie uint256 — docs/03 §1, CLAUDE.md pkt 7.
create domain app.usdc_raw as numeric(78, 0)
  check (value >= 0 and value <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);

-- Wyzwalacz utrzymujący updated_at.
create function app.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
