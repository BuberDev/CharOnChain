/**
 * Warstwa API niezależna od frameworka (COC-032/033): funkcje przyjmują kontekst i zwracają `{status, body}`.
 * Trasy Next.js (App Router) tylko tłumaczą `Request` ↔ ten kształt. Wszystkie kwoty to ciągi dziesiętne
 * (jednostki najmniejsze USDC, 6 miejsc) — nigdy `number` (CLAUDE.md pkt 7).
 */
import type { ClientBase } from "pg";

import { ZodError } from "zod";

export type Queryable = Pick<ClientBase, "query">;

export interface ApiContext {
  readonly db: Queryable;
  /** Sieć środowiska (421614 / 42161): wszystkie odczyty są ograniczone do niej. */
  readonly chainId: number;
  readonly requestId: string;
  /** Próg nieaktualności projekcji (s); domyślnie 300. */
  readonly staleAfterSeconds?: number;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const PUBLIC_CACHE_HEADERS = {
  "cache-control": "public, max-age=10, stale-while-revalidate=30",
} as const;

function envelope(
  ctx: { requestId: string },
  code: string,
  message: string,
  extra?: object,
): unknown {
  return { error: { code, message, requestId: ctx.requestId, ...extra } };
}

/**
 * Zamienia wyjątek na bezpieczną odpowiedź (docs/03 §4): bez stack trace, SQL, wartości wejściowych i
 * wewnętrznych kluczy. Nieoczekiwane błędy → 500 z ogólnym komunikatem; szczegóły trafiają do `onUnexpected`.
 */
export function toErrorResponse(
  ctx: { requestId: string },
  error: unknown,
  onUnexpected?: (error: unknown) => void,
): ApiResponse {
  if (error instanceof ApiError) {
    return { status: error.status, body: envelope(ctx, error.code, error.message) };
  }
  if (error instanceof ZodError) {
    // Tylko ścieżki pól — nigdy wartości (mogą zawierać dane osobowe lub próby ataku).
    const fields = [...new Set(error.issues.map((i) => i.path.map(String).join(".") || "(root)"))];
    return {
      status: 400,
      body: envelope(ctx, "VALIDATION_ERROR", "Nieprawidłowe dane wejściowe.", { fields }),
    };
  }
  onUnexpected?.(error);
  return {
    status: 500,
    body: envelope(ctx, "INTERNAL_ERROR", "Wystąpił błąd serwera. Spróbuj ponownie."),
  };
}

/** Uruchamia handler i gwarantuje, że nic poza `ApiResponse` nie wycieknie na zewnątrz. */
export async function respond(
  ctx: { requestId: string },
  run: () => Promise<ApiResponse>,
  onUnexpected?: (error: unknown) => void,
): Promise<ApiResponse> {
  try {
    return await run();
  } catch (error) {
    return toErrorResponse(ctx, error, onUnexpected);
  }
}
