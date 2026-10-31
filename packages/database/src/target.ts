/**
 * Bezpieczny wybór bazy docelowej dla migracji i seedów (COC-004; docs/05 §4: osobne środowiska).
 *
 *  - local:      baza MUSI być lokalna (localhost / gniazdo unix).
 *  - staging:    dowolny host nielokalny lub lokalny; seedy dozwolone.
 *  - production: wymaga jawnego potwierdzenia hosta (MIGRATE_CONFIRM_PRODUCTION=<host>), host
 *                nie może być lokalny; seedy i cofanie migracji ZABRONIONE.
 * Hasła nigdy nie trafiają do komunikatów ani logów.
 */
export type AppEnv = "local" | "staging" | "production";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface MigrationTarget {
  readonly url: string;
  readonly appEnv: AppEnv;
  readonly host: string;
  readonly database: string;
  /** URL bez hasła — jedyna postać dozwolona w logach. */
  readonly redactedUrl: string;
  readonly allowDown: boolean;
  readonly allowSeed: boolean;
}

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1", "[::1]"]);

function parseAppEnv(value: string | undefined): AppEnv {
  if (value === undefined || value === "") return "local";
  if (value === "local" || value === "staging" || value === "production") return value;
  throw new UnsafeTargetError(
    `Nieznane APP_ENV: ${JSON.stringify(value)} (local | staging | production)`,
  );
}

export function redactUrl(url: URL): string {
  const copy = new URL(url.toString());
  if (copy.password !== "") copy.password = "***";
  return copy.toString();
}

export function resolveTarget(env: EnvLike): MigrationTarget {
  const raw = env.DATABASE_URL;
  if (raw === undefined || raw === "") throw new UnsafeTargetError("Brak DATABASE_URL.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Celowo nie pokazujemy wartości — może zawierać hasło.
    throw new UnsafeTargetError("DATABASE_URL nie jest poprawnym adresem URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new UnsafeTargetError("DATABASE_URL musi używać schematu postgres:// lub postgresql://.");
  }

  const appEnv = parseAppEnv(env.APP_ENV);
  const host = url.hostname;
  const isLocal = LOCAL_HOSTS.has(host);
  const database = url.pathname.replace(/^\//, "");
  const base = {
    url: raw,
    appEnv,
    host,
    database,
    redactedUrl: redactUrl(url),
  };

  if (appEnv === "local") {
    if (!isLocal) {
      throw new UnsafeTargetError(
        `APP_ENV=local, ale host bazy (${host}) nie jest lokalny. Ustaw APP_ENV=staging lub użyj lokalnej bazy.`,
      );
    }
    return { ...base, allowDown: true, allowSeed: true };
  }

  if (appEnv === "staging") {
    return { ...base, allowDown: true, allowSeed: true };
  }

  // production
  if (isLocal) {
    throw new UnsafeTargetError(
      "APP_ENV=production z lokalnym hostem bazy — to wygląda na pomyłkę.",
    );
  }
  if (env.MIGRATE_CONFIRM_PRODUCTION !== host) {
    throw new UnsafeTargetError(
      `Migracja produkcyjna wymaga MIGRATE_CONFIRM_PRODUCTION=${host} (jawne potwierdzenie hosta).`,
    );
  }
  return { ...base, allowDown: false, allowSeed: false };
}
