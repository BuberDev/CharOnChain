/**
 * Słownik PL (język domyślny, docs/01 §1). Teksty podglądu — wersja robocza do akceptacji UX/prawnej.
 * Zasady: prostym językiem; bez „gas”, „approve”, „seed” na ścieżce głównej; bez obietnic
 * bezterminowego sponsorowania; „zweryfikowana organizacja” ≠ „zweryfikowany rezultat”.
 */
export const pl = {
  meta: {
    title: "CharOnChain — darowizny w USDC, które sprawdzisz",
    description:
      "Przekaż USDC prosto do portfela zweryfikowanej organizacji. Każdą wpłatę sprawdzisz publicznie.",
  },
  a11y: {
    skip: "Przejdź do treści",
    mainNav: "Menu główne",
    footerNav: "Menu w stopce",
    language: "Język",
    langPl: "Polski",
    langEn: "English",
  },
  demo: {
    notice: "Wersja podglądowa z danymi demonstracyjnymi. Nie przyjmujemy darowizn.",
    tag: "DEMO",
  },
  nav: {
    campaigns: "Zbiórki",
    how: "Jak to działa",
    proofs: "Trzy dowody",
    faq: "Pytania",
    login: "Zaloguj się",
    profile: "Mój profil",
    discover: "Odkryj zbiórki",
  },
  hero: {
    line1: "Wesprzyj",
    line2: "i sprawdź",
    lead: "CharOnChain przekazuje darowiznę w USDC prosto do portfela zweryfikowanej organizacji. Każdą wpłatę sprawdzisz publicznie.",
    caption: "Przykładowy kwit. Dane demonstracyjne.",
    amount: "Kwota",
    recipient: "Odbiorca",
    fee: "Obowiązkowa prowizja",
    networkFee: "Koszt przesłania",
    networkFeeValue: "pokrywa CharOnChain",
    status: "Potwierdzenie",
    statusValue: "publicznie widoczne",
    total: "Trafia do organizacji",
  },
  proofs: {
    heading: "Trzy dowody, osobno",
    items: [
      {
        name: "Płatność",
        text: "Widać ją publicznie. Każdy może ją sprawdzić samodzielnie.",
      },
      {
        name: "Organizacja",
        text: "Sprawdzamy ją przed publikacją zbiórki. Jej portfel wymaga co najmniej dwóch podpisów.",
      },
      {
        name: "Wpływ",
        text: "Organizacja publikuje raport z cyfrowym odciskiem, a niezależny recenzent go przegląda.",
      },
    ],
    note: "Zweryfikowana organizacja nie oznacza zweryfikowanego rezultatu pomocy.",
  },
  showcase: {
    heading: "Aktualne zbiórki",
    tablist: "Wybierz zbiórkę",
    raised: "Zebrano",
    of: "z",
    window: "Czas zbiórki",
    safe: "Portfel organizacji",
    open: "Zobacz zbiórkę",
    verify: "Jak sprawdzamy organizacje",
    progress: "Postęp zbiórki",
    from: "od",
    to: "do",
  },
  how: {
    heading: "Jak to działa",
    lead: "Cztery kroki. Po Twojej stronie jest jedna autoryzacja.",
    advanced:
      "Wolisz własny portfel? Połącz MetaMask, Rabby lub WalletConnect. Masz pełną kontrolę, ale koszt przesłania płacisz wtedy sam.",
    yoursTitle: "Po Twojej stronie",
    networkTitle: "Po stronie systemu i organizacji",
    steps: {
      amount: "Wybierasz kwotę",
      authorize: "Zatwierdzasz odciskiem palca lub kodem",
      fee: "Koszt przesłania jest pokryty",
      transfer: "USDC trafia prosto do portfela organizacji",
    },
    actors: { you: "Ty", platform: "CharOnChain", network: "Arbitrum" },
    resultLabel: "Efekt",
    resultValue: "kwit z dowodem wpłaty",
  },
  leagues: {
    heading: "Ligi",
    note: "Odznaka nie jest sprzedawana ani wymieniana. To uznanie, nie inwestycja.",
    threshold: "od",
    xpFrom: "od {xp} XP",
    rule: "1 USDC to 10 XP. Liczymy wpłaty w USDC, bez przeliczania na dolary.",
    names: {
      1: "Supporter",
      2: "Bronze",
      3: "Silver",
      4: "Gold",
      5: "Platinum",
      6: "Diamond",
    } as Record<number, string>,
  },
  faq: {
    heading: "Pytania",
    items: [
      {
        q: "Czy dostanę zwrot darowizny?",
        a: "Nie. Darowizna jest nieodwracalna po potwierdzeniu, a platforma nie obsługuje automatycznych zwrotów. Pomyłkami zajmuje się procedura poza kontraktem.",
      },
      {
        q: "Czy płacę prowizję?",
        a: "CharOnChain nie pobiera obowiązkowej prowizji. W trybie dla początkujących koszt przesłania pokrywa platforma. Może to zostać wstrzymane; wtedy darowizna nie zostanie wysłana, a Twoje środki zostaną na koncie.",
      },
      {
        q: "Czy muszę znać się na kryptowalutach?",
        a: "Nie. Wystarczy konto i zatwierdzenie darowizny. Możesz też użyć własnego portfela, jeśli wolisz pełną kontrolę.",
      },
      {
        q: "Czym jest USDC?",
        a: "To stablecoin powiązany z dolarem. Jego wartość może odbiegać od dolara, dlatego pokazujemy kwoty w USDC, a nie w dolarach.",
      },
      {
        q: "Co sprawdzacie?",
        a: "Płatność widać publicznie. Organizację weryfikujemy przed publikacją zbiórki. Raport ma osobny status. To trzy różne rzeczy i nie łączymy ich w jedno „zweryfikowane”.",
      },
      {
        q: "Czy odznakę można sprzedać?",
        a: "Nie. Odznaka jest niezbywalna i nie ma wartości rynkowej.",
      },
      {
        q: "Co, jeśli zbiórka okaże się oszustwem?",
        a: "Możesz ją zgłosić. Możemy wstrzymać dalsze wpłaty, ale środków już przekazanych organizacji platforma nie kontroluje.",
      },
      {
        q: "Czy to już działa?",
        a: "To wersja podglądowa. Nie przyjmujemy darowizn do czasu audytu bezpieczeństwa i opinii prawnej.",
      },
    ],
  },
  cta: {
    heading: "Zacznij od zbiórki",
    text: "Wybierz organizację i zobacz kwit, zanim cokolwiek zatwierdzisz.",
    side: "Nic nie zatwierdzasz, dopóki nie zobaczysz kwoty, odbiorcy i opłaty.",
    action: "Odkryj zbiórki",
  },
  footer: {
    sign: "Zachowaj kwit.",
    lines:
      "To wersja podglądowa. Prawdziwe dane, regulamin i polityka prywatności pojawią się przed uruchomieniem.",
    soon: "wkrótce",
    terms: "Regulamin",
    privacy: "Prywatność",
    imprint: "CharOnChain, wersja podglądowa",
  },
  campaign: {
    back: "Wszystkie zbiórki",
    about: "O zbiórce",
    proofsHeading: "Dowody",
    proofLabels: { payment: "Płatność", org: "Organizacja", impact: "Wpływ" },
    proofStatus: {
      payment: "Pierwsze wpłaty widać publicznie.",
      org: "Zweryfikowana przed publikacją (dane demonstracyjne).",
      impact: "Raport jeszcze nie został opublikowany.",
    },
    donationsHeading: "Ostatnie wpłaty",
    donationsEmpty: "Nie ma jeszcze potwierdzonych wpłat.",
    donationStatus: { confirmed: "potwierdzona", pending: "oczekuje na potwierdzenie" },
    reportsHeading: "Raporty",
    reportsEmpty:
      "Brak raportów. Raport pojawi się po zakończeniu zbiórki, a jego brak będzie widoczny publicznie.",
    closes: "Kończy się",
    safeLabel: "Adres portfela Safe organizacji",
    walletHeading: "Portfel organizacji",
    walletAddress: "Adres",
    walletSigners: "Wymagane podpisy",
    walletSignersValue: "co najmniej dwa (dane demonstracyjne)",
    walletNetwork: "Sieć",
    walletNote:
      "Środki trafiają bezpośrednio na ten adres. Adres kampanii nie może się zmienić po jej utworzeniu.",
    organisation: "Organizacja",
  },
  panel: {
    heading: "Wystaw kwit",
    amountLegend: "Kwota darowizny",
    presets: "Gotowe kwoty",
    custom: "Inna kwota w USDC",
    customHint: "Użyj cyfr i kropki, np. 12.50. Minimum 1 USDC.",
    remaining: "Pozostały limit",
    after: "Pozostały limit po wpłacie",
    xp: "Punkty (XP)",
    xpNote: "Ligę policzymy dla Twojego konta po potwierdzeniu.",
    amount: "Kwota",
    recipient: "Odbiorca",
    fee: "Obowiązkowa prowizja",
    networkFee: "Koszt przesłania",
    networkFeeValue: "pokrywa CharOnChain",
    toOrg: "Trafia do organizacji",
    action: "Wesprzyj zbiórkę",
    actionDisabled: "Wpisz poprawną kwotę",
    suggest: "Wpisz {amount} USDC",
    errors: {
      EMPTY: "Wpisz kwotę.",
      FORMAT: "Użyj cyfr i kropki, np. 12.50.",
      TOO_MANY_DECIMALS: "Maksymalnie sześć miejsc po kropce.",
      OVERFLOW: "Ta kwota jest zbyt duża.",
      INVALID_AMOUNT: "Wpisz kwotę większą niż zero.",
      BELOW_MINIMUM:
        "Minimalna darowizna to 1 USDC. Wyjątek: kwota, która dokładnie domyka cel zbiórki.",
      CAP_EXCEEDED: "Ta kwota przekracza pozostały limit zbiórki.",
      CAP_REACHED: "Cel zbiórki został osiągnięty.",
    } as Record<string, string>,
    disclosure: {
      transfer:
        "Przekazujesz {amount} USDC do zweryfikowanego portfela organizacji {org}, adres {address}.",
      fee: "CharOnChain nie pobiera obowiązkowej prowizji. Koszt przesłania pokrywa CharOnChain; może to zostać wstrzymane, wtedy darowizna nie zostanie wysłana.",
      irreversible:
        "Darowizna jest nieodwracalna po potwierdzeniu. Platforma nie obsługuje automatycznych zwrotów.",
      outside: "Wpłaty dokonane poza przyciskiem Wesprzyj nie zostaną uwzględnione w odznakach.",
      scope:
        "Weryfikacja organizacji nie gwarantuje rezultatu pomocy; raporty opisują zakres przeprowadzonej kontroli.",
    },
  },
  checkout: {
    title: "Sprawdź i zatwierdź",
    lead: "Zobacz kwit. Nic nie zostanie wysłane, dopóki go nie zatwierdzisz.",
    back: "Wróć do zbiórki",
    approve: "Zatwierdź darowiznę",
    retry: "Spróbuj ponownie",
    status: {
      review: {
        title: "Gotowe do zatwierdzenia",
        text: "Sprawdź kwotę i odbiorcę. Zatwierdzisz odciskiem palca lub kodem na swoim urządzeniu.",
      },
      authorizing: {
        title: "Zatwierdź na urządzeniu",
        text: "Potwierdź darowiznę odciskiem palca lub kodem. To jedyny krok po Twojej stronie.",
      },
      submitted: {
        title: "Wysłano, czekamy na potwierdzenie",
        text: "Darowizna została wysłana do realizacji. Nie jest jeszcze zakończona — poczekaj na potwierdzenie.",
      },
      confirmed: {
        title: "Darowizna potwierdzona",
        text: "Środki trafiły do portfela organizacji. Ten kwit możesz zachować i sprawdzić publicznie.",
      },
      rejected: {
        title: "Anulowano",
        text: "Darowizna nie została zatwierdzona. Nic nie zostało wysłane, a Twoje środki są bez zmian.",
      },
      sponsorship: {
        title: "Nie możemy teraz pokryć kosztu przesłania",
        text: "Darowizna nie została wysłana, a Twoje środki są bez zmian. Spróbuj ponownie za jakiś czas.",
      },
      reverted: {
        title: "Darowizna nie została zrealizowana",
        text: "Operacja została wysłana, ale darowizny nie przyjęto, np. dlatego, że limit zbiórki został właśnie osiągnięty. Twoje środki są bez zmian.",
      },
    },
    steps: {
      amount: "Kwota",
      approve: "Zatwierdzenie",
      network: "Przesłanie",
      done: "Potwierdzenie",
    },
    receiptStatus: {
      review: "do zatwierdzenia",
      authorizing: "zatwierdzanie",
      submitted: "wysłano, czekamy",
      confirmed: "potwierdzona",
      rejected: "anulowano",
      sponsorship: "nie wysłano",
      reverted: "nie zrealizowano",
    } as Record<string, string>,
    stepState: { done: "gotowe", current: "w toku", failed: "nie powiodło się", pending: "dalej" },
    detailsSummary: "Szczegóły techniczne",
    detailsNetwork: "Sieć",
    detailsToken: "Waluta",
    detailsTokenValue: "USDC (natywne, Circle)",
    detailsSafe: "Pełny adres portfela organizacji",
    detailsOp: "Identyfikator operacji (DEMO)",
    confirmedNote:
      "Potwierdzone zgodnie z polityką Arbitrum. To jeszcze nie jest ostateczność na poziomie Ethereum.",
    previewStates: "Podgląd stanów (tylko wersja podglądowa)",
    stateLinks: {
      review: "Do zatwierdzenia",
      authorizing: "Zatwierdzanie",
      submitted: "Wysłano",
      confirmed: "Potwierdzona",
      rejected: "Anulowano",
      sponsorship: "Brak pokrycia opłaty",
      reverted: "Nie zrealizowano",
    },
  },
  profile: {
    title: "Twoje wsparcie",
    lead: "Dane demonstracyjne konta podglądowego.",
    total: "Wpłacono łącznie",
    xp: "Punkty (XP)",
    league: "Liga",
    next: "Do ligi {name} brakuje",
    top: "Najwyższa liga osiągnięta",
    progress: "Postęp do kolejnej ligi",
    badgeHeading: "Odznaka",
    badgeNone: "Nie odebrano",
    badgeNoneText:
      "Odznaka jest dobrowolna. Odbierasz ją jednym gestem, osobno od darowizny, a koszt przesłania pokrywa CharOnChain.",
    claimedTitle: "Odznaka odebrana",
    claimedText:
      "Odznaka jest niezbywalna. Jej liga zmienia się razem z Twoimi wpłatami, bez nowej odznaki.",
    claim: "Odbierz odznakę",
    notForSale: "Nie do sprzedaży",
    historyHeading: "Historia wpłat",
    historyEmpty: "Nie ma jeszcze wpłat.",
    colDate: "Data",
    colCampaign: "Zbiórka",
    colAmount: "Kwota",
    colStatus: "Status",
    privacyHeading: "Prywatność",
    privacyText:
      "Historia wpłat jest publiczna i dostępna dla każdego niezależnie od tych ustawień. Ustawienia dotyczą tylko profilu i rankingu.",
    publicProfile: "Profil publiczny",
    leaderboard: "Udział w rankingu",
    off: "Wyłączony",
    on: "Włączony",
    confirmed: "potwierdzona",
  },
};

export type Dictionary = typeof pl;
