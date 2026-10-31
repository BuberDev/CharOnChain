# seed

Dane początkowe wyłącznie dla środowisk `local` i `staging` (runner odmawia seedowania `production`).
Pliki `*.sql` są wykonywane w kolejności alfabetycznej, w jednej transakcji.

Zasady (docs/09 AC-41, CLAUDE.md pkt 13/20): dane demonstracyjne muszą być jawnie oznaczone jako DEMO;
żadnych fikcyjnych darczyńców, kwot ani „zweryfikowanych” organizacji bez dowodu. Seedy dla encji
powstają razem z migracjami tabel (COC-020..022).
