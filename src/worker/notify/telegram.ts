/**
 * Minimal Telegram push — used for the needs-human escalation ping and the
 * daily digest (see scheduled() in src/worker/index.ts). No-ops cleanly
 * when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID aren't set yet, so a fresh
 * self-hosted instance never crashes on this — it just doesn't notify
 * until those two secrets are configured.
 */
export async function sendTelegramMessage(env: Env, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID unset) — skipping notification");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (error) {
    console.error("Telegram sendMessage threw:", error);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function needsHumanPingMessage(params: {
  boardId: string;
  taskId: string;
  title: string;
  reason: string | null;
  appUrl: string;
}): string {
  const lines = [
    `🐝 <b>Hive needs you</b>`,
    `Board: <code>${escapeHtml(params.boardId)}</code>`,
    `Task: ${escapeHtml(params.title)}`,
  ];
  if (params.reason) lines.push(`Why: ${escapeHtml(params.reason)}`);
  lines.push(`${params.appUrl}/boards/${params.boardId}`);
  return lines.join("\n");
}
