import { useEffect, useRef } from "react";
import { boardSocketUrl } from "@/lib/api";
import type { BoardSocketMessage } from "@/lib/types";

/**
 * Opens a WebSocket to the given board's BoardDO (Hibernation API on the
 * server side — see src/worker/durable-objects/BoardDO.ts) and calls
 * `onMessage` for every parsed frame. Reconnects with backoff on close.
 *
 * TODO(integration): confirm the wire format matches BoardSocketMessage in
 * lib/types.ts once src/worker/durable-objects/BoardDO.ts broadcasts real
 * messages — this hook only assumes each frame is one JSON object.
 */
export function useBoardSocket(slug: string | undefined, onMessage: (msg: BoardSocketMessage) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!slug) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(boardSocketUrl(slug));

      socket.addEventListener("open", () => {
        attempt = 0;
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data) as BoardSocketMessage;
          onMessageRef.current(msg);
        } catch {
          // Ignore malformed frames rather than crash the board view.
        }
      });

      socket.addEventListener("close", () => {
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        socket?.close();
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [slug]);
}
