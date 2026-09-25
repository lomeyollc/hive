import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn/ui class-merging helper. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A `type="date"` input gives "YYYY-MM-DD". `new Date(that).toISOString()`
 * parses it as UTC midnight, so a Focus picked to end "today" goes overdue
 * at the *start* of that day in the user's local time (e.g. 00:00 UTC is
 * already 06:00 in Dhaka). Build the end of that calendar day in the
 * browser's local timezone instead, then convert to ISO for the wire.
 */
export function endOfDayLocalIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}
