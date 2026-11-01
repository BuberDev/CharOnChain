"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Odsłanianie sekcji przy przewijaniu (jednorazowo; transform + opacity).
 * Treść nad zagięciem NIE jest ukrywana (brak migotania, LCP); ukrywamy tylko elementy poniżej zagięcia,
 * dopiero po hydracji. Bez JS albo przy `prefers-reduced-motion` wszystko jest od razu widoczne.
 */
export function RevealInit() {
  const pathname = usePathname();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (reduced || typeof IntersectionObserver === "undefined") return;

    const fold = window.innerHeight * 0.95;
    const below = targets.filter((el) => el.getBoundingClientRect().top > fold);
    below.forEach((el) => {
      el.classList.add("reveal-pending");
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.remove("reveal-pending");
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    below.forEach((el) => {
      observer.observe(el);
    });
    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
