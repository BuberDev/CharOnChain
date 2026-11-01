"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";

export interface MobileMenuProps {
  readonly links: readonly { readonly href: string; readonly label: string }[];
  readonly navLabel: string;
  readonly ctaHref: string;
  readonly ctaLabel: string;
}

/**
 * Menu na telefonie: przycisk z `aria-expanded`; linki są w DOM tylko po otwarciu (żadnych ukrytych
 * elementów poza kolejnością czytania). Esc zamyka i oddaje fokus przyciskowi; klik w link zamyka menu.
 */
export function MobileMenu({ links, navLabel, ctaHref, ctaLabel }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && open) {
      close();
      button.current?.focus();
    }
  };

  return (
    <div className="lg:hidden" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-navy-2 px-3 font-display text-small font-semibold text-paper"
      >
        Menu
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute inset-x-0 top-full z-30 bg-navy-2 px-gutter pb-6 pt-2"
        >
          <nav aria-label={navLabel} className="flex flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={close}
                className="link-plain inline-flex min-h-12 items-center font-display text-body font-semibold text-paper"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link href={ctaHref} onClick={close} className="btn btn-mint btn-block mt-4">
            {ctaLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
