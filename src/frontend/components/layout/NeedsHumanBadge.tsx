import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { listNeedsHuman } from "@/lib/api";

/**
 * The nav-level "what's stuck on me" indicator — cross-board visibility for
 * the same needs_human flag that drives the Telegram ping/digest. Polls
 * rather than sockets: it's a summary across every board's DO, not one
 * board's live stream, so a plain interval is the simpler correct choice.
 */
export function NeedsHumanBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const items = await listNeedsHuman();
        if (!cancelled) setCount(items.length);
      } catch {
        // Silent — this is a nav decoration, not a page the user is waiting on.
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!count) return null;

  return (
    <Link
      to="/needs-you"
      className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1 text-sm font-medium text-destructive"
    >
      <AlertTriangle className="size-3.5" />
      {count} need{count === 1 ? "s" : ""} you
    </Link>
  );
}
