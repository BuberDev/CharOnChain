-- Cofnięcie 0001_baseline. Schemat `private` i tabela migracji należą do runnera i NIE są tu usuwane.
drop function if exists app.touch_updated_at();
drop domain if exists app.usdc_raw;
drop domain if exists app.hash32;
drop domain if exists app.evm_address;
drop schema if exists app;
