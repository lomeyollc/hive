import { useEffect } from "react";

/** Suffix on every page except the ones that ARE the brand (login, 404). */
export const TITLE_SUFFIX = "Hive";

/**
 * Sets document.title for the current page and restores nothing on unmount —
 * the next page sets its own title, so a restore would only cause a flash.
 *
 * Pass `null` while the page is still loading the thing it is named after
 * (a board name, a task title); the title then stays whatever it was until
 * the real name arrives, instead of flashing a placeholder.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return;
    document.title = title ? `${title} · ${TITLE_SUFFIX}` : TITLE_SUFFIX;
  }, [title]);
}
