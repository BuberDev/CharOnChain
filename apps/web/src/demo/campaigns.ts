/**
 * DANE DEMONSTRACYJNE (AC-41). Wszystko tutaj jest wymyślone na potrzeby podglądu:
 * organizacje, kwoty, daty i adresy. Adresy to oczywiste wzorce (powtórzony bajt), nie realne portfele.
 * Nie wolno ich używać poza wersją podglądową ani przedstawiać jako zweryfikowanych.
 */
import type { Locale } from "../i18n/index";

const USDC = 1_000_000n;

interface LocalizedText {
  readonly pl: string;
  readonly en: string;
}

export interface DemoDonation {
  readonly id: string;
  readonly donor: string;
  readonly amountRaw: bigint;
  readonly date: string;
  readonly status: "confirmed" | "pending";
}

export interface DemoCampaign {
  readonly slug: string;
  readonly title: LocalizedText;
  readonly organisation: LocalizedText;
  readonly summary: LocalizedText;
  readonly description: readonly [LocalizedText, LocalizedText];
  readonly capRaw: bigint;
  readonly raisedRaw: bigint;
  readonly startAt: string;
  readonly endAt: string;
  /** Syntetyczny adres „portfela Safe” (wzorzec, nie realny). */
  readonly safe: string;
  readonly donations: readonly DemoDonation[];
}

export const demoCampaigns: readonly DemoCampaign[] = [
  {
    slug: "cieple-posilki",
    title: { pl: "Ciepłe posiłki zimą", en: "Warm meals this winter" },
    organisation: { pl: "Fundacja Przykładowa", en: "Example Foundation" },
    summary: {
      pl: "Gorące posiłki dla osób w kryzysie bezdomności przez cztery zimowe miesiące.",
      en: "Hot meals for people experiencing homelessness through four winter months.",
    },
    description: [
      {
        pl: "Zbieramy na codzienne ciepłe posiłki w trzech punktach pomocy. Środki idą na produkty i przygotowanie jedzenia.",
        en: "We are raising money for daily hot meals at three support points. Funds go to ingredients and preparing the food.",
      },
      {
        pl: "Organizacja opublikuje raport po zakończeniu zbiórki. Dopóki go nie ma, pokazujemy to wprost.",
        en: "The organisation will publish a report after the campaign ends. Until it exists, we say so openly.",
      },
    ],
    capRaw: 10_000n * USDC,
    raisedRaw: 3_420_500_000n,
    startAt: "2026-11-01",
    endAt: "2027-02-28",
    safe: `0x${"d1".repeat(20)}`,
    donations: [
      {
        id: "d-4",
        donor: `0x${"a4".repeat(20)}`,
        amountRaw: 25n * USDC,
        date: "2026-11-03",
        status: "confirmed",
      },
      {
        id: "d-3",
        donor: `0x${"a3".repeat(20)}`,
        amountRaw: 100n * USDC,
        date: "2026-11-02",
        status: "confirmed",
      },
      {
        id: "d-2",
        donor: `0x${"a2".repeat(20)}`,
        amountRaw: 5_500_000n,
        date: "2026-11-02",
        status: "confirmed",
      },
      {
        id: "d-1",
        donor: `0x${"a1".repeat(20)}`,
        amountRaw: 10n * USDC,
        date: "2026-11-01",
        status: "pending",
      },
    ],
  },
  {
    slug: "szkolne-pracownie",
    title: { pl: "Szkolne pracownie", en: "School workshops" },
    organisation: { pl: "Stowarzyszenie Demo", en: "Demo Association" },
    summary: {
      pl: "Wyposażenie dwóch pracowni dla uczniów małej szkoły. Do celu brakuje ostatniej drobnej kwoty.",
      en: "Equipment for two workshops at a small school. Only a last small amount is missing.",
    },
    description: [
      {
        pl: "Ta zbiórka pokazuje przypadek brzegowy: do limitu zostało mniej niż 1 USDC. Wtedy dozwolona jest tylko kwota, która dokładnie domyka cel.",
        en: "This campaign shows an edge case: less than 1 USDC is left to the limit. Then only an amount that exactly completes the goal is allowed.",
      },
      {
        pl: "Limit zbiórki jest twardy: nie przyjmujemy wpłat ponad cel.",
        en: "The campaign limit is hard: we do not accept payments above the goal.",
      },
    ],
    capRaw: 25_000n * USDC,
    raisedRaw: 24_999_500_000n,
    startAt: "2026-10-01",
    endAt: "2026-12-15",
    safe: `0x${"d2".repeat(20)}`,
    donations: [
      {
        id: "d-9",
        donor: `0x${"b9".repeat(20)}`,
        amountRaw: 40n * USDC,
        date: "2026-10-29",
        status: "confirmed",
      },
      {
        id: "d-8",
        donor: `0x${"b8".repeat(20)}`,
        amountRaw: 250n * USDC,
        date: "2026-10-28",
        status: "confirmed",
      },
    ],
  },
  {
    slug: "sprzet-ratownikow",
    title: { pl: "Sprzęt dla ratowników", en: "Rescue team equipment" },
    organisation: { pl: "Fundacja Demonstracyjna", en: "Demonstration Foundation" },
    summary: {
      pl: "Nowa zbiórka, jeszcze bez wpłat. Pokazuje stan pusty zamiast sztucznych liczb.",
      en: "A new campaign with no payments yet. It shows an empty state instead of invented numbers.",
    },
    description: [
      {
        pl: "Zbiórka na sprzęt ratowniczy dla lokalnej jednostki. Nie ma jeszcze żadnych wpłat i nie udajemy, że są.",
        en: "A campaign for rescue equipment for a local unit. There are no payments yet and we do not pretend otherwise.",
      },
      {
        pl: "Pierwsza potwierdzona wpłata pojawi się na liście publicznie.",
        en: "The first confirmed payment will appear on the public list.",
      },
    ],
    capRaw: 5_000n * USDC,
    raisedRaw: 0n,
    startAt: "2026-11-15",
    endAt: "2027-03-31",
    safe: `0x${"d3".repeat(20)}`,
    donations: [],
  },
];

export function findCampaign(slug: string): DemoCampaign | undefined {
  return demoCampaigns.find((campaign) => campaign.slug === slug);
}

export function text(value: LocalizedText, locale: Locale): string {
  return value[locale];
}

/** Data ISO (RRRR-MM-DD) w zapisie lokalnym; wejście demonstracyjne jest zawsze poprawne. */
export function formatDate(iso: string, locale: Locale): string {
  const [year, month, day] = iso.split("-");
  return locale === "pl"
    ? `${day ?? ""}.${month ?? ""}.${year ?? ""}`
    : `${year ?? ""}-${month ?? ""}-${day ?? ""}`;
}

export interface DemoProfileRow {
  readonly id: string;
  readonly date: string;
  readonly slug: string;
  readonly amountRaw: bigint;
}

export const demoProfile: {
  readonly totalRaw: bigint;
  readonly badgeClaimed: boolean;
  readonly history: readonly DemoProfileRow[];
} = {
  totalRaw: 550n * USDC,
  badgeClaimed: false,
  history: [
    { id: "p-3", date: "2026-11-03", slug: "cieple-posilki", amountRaw: 25n * USDC },
    { id: "p-2", date: "2026-10-20", slug: "szkolne-pracownie", amountRaw: 250n * USDC },
    { id: "p-1", date: "2026-10-05", slug: "cieple-posilki", amountRaw: 275n * USDC },
  ],
};
