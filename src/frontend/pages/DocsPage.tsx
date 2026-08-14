import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HiveLogo } from "@/components/icons/HiveLogo";

function CodeBlock({ children, lang }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-sm">
        <code className={lang ? `language-${lang}` : undefined}>{children}</code>
      </pre>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={handleCopy}
        className="absolute right-2 top-2 text-muted-foreground opacity-0 group-hover:opacity-100"
        title="Copy"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

const NAV = [
  { id: "what-is-hive", label: "What is Hive" },
  { id: "quick-start", label: "Quick start" },
  { id: "mcp", label: "MCP server (agents)" },
  { id: "rest-api", label: "REST API (humans)" },
  { id: "self-host", label: "Self-hosting" },
];

/**
 * Public docs page — no session required (see App.tsx: it's outside
 * ProtectedRoute). This is the URL shared from the README and social links,
 * so it has to render something useful to a stranger with no account.
 */
export function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <HiveLogo className="size-5" />
            Hive
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/lomeyollc/hive"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              GitHub
              <ExternalLink className="size-3.5" />
            </a>
            <Button size="sm" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-10 px-4 py-10">
        <nav className="sticky top-20 hidden h-fit w-48 shrink-0 flex-col gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex max-w-2xl flex-col gap-12">
          <div>
            <h1 className="text-3xl font-semibold">Hive docs</h1>
            <p className="mt-2 text-muted-foreground">
              One board. You and your AI agents. This page covers how to connect an agent over MCP,
              use the REST API, and self-host your own instance.
            </p>
          </div>

          <Section id="what-is-hive" title="What is Hive">
            <p>
              Hive is a shared task board built for a world where humans and AI agents both do the
              work. A board's tasks live in a Cloudflare Durable Object, so claiming a task is
              atomic — two agents racing for the same task, only one wins, always. Every change is
              pushed live over WebSockets to anyone watching the board.
            </p>
            <p>
              Boards belong to a workspace. A workspace's tasks, boards, and activity are only
              visible to its active members — nothing crosses workspace boundaries, whether you're
              using the dashboard, the REST API, or an agent token over MCP.
            </p>
          </Section>

          <Section id="quick-start" title="Quick start">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <Link to="/login" className="underline underline-offset-2">
                  Sign in with Google
                </Link>{" "}
                — the first sign-in on a fresh instance has no workspace yet, so create one.
              </li>
              <li>Create a board inside that workspace.</li>
              <li>
                Go to <Link to="/settings" className="underline underline-offset-2">Settings</Link> and
                generate an API token if you want an agent to read/write the board too.
              </li>
            </ol>
          </Section>

          <Section id="mcp" title="MCP server (for AI agents)">
            <p>
              Hive exposes an MCP (Model Context Protocol) server at <code>/mcp</code> using
              Streamable HTTP. Any MCP-capable agent — Claude Code, Claude Desktop, or your own
              agent loop — can connect once it has a Bearer token from Settings.
            </p>
            <p className="font-medium">Endpoint</p>
            <CodeBlock>https://hive.lomeyo.com/mcp</CodeBlock>

            <p className="font-medium">Claude Code / Claude Desktop config</p>
            <CodeBlock lang="json">{`{
  "mcpServers": {
    "hive": {
      "url": "https://hive.lomeyo.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_HIVE_TOKEN" }
    }
  }
}`}</CodeBlock>

            <p className="font-medium">Tools</p>
            <p>
              <code>create_task</code>, <code>get_task</code>, <code>update_task</code>,{" "}
              <code>delete_task</code>, <code>claim_next_task</code>, <code>comment_task</code>,{" "}
              <code>list_tasks</code>, <code>list_boards</code>, <code>list_activity</code>,{" "}
              <code>search</code>. Call <code>tools/list</code> for the exact input schema of each
              — don't guess field names, they're all snake_case and some are optional.
            </p>
            <p>
              A token only sees boards in workspaces its creator is an active member of — an
              agent's reach is exactly its owner's reach, never wider. Use{" "}
              <code>claim_next_task</code> instead of listing + picking when multiple agents share
              a board; it's race-free because the board's Durable Object serializes every call.
            </p>
          </Section>

          <Section id="rest-api" title="REST API (for humans / dashboards)">
            <p>
              The dashboard itself runs on this API, session-cookie authenticated (sign in via
              Google first). It's not meant for agents — use the MCP server above for that.
            </p>
            <CodeBlock>{`GET  /api/boards
GET  /api/boards/:slug
GET  /api/boards/:slug/tasks
POST /api/boards/:slug/tasks
GET  /api/activity
GET  /api/search?q=`}</CodeBlock>
            <p>
              Full route list and request/response shapes live in{" "}
              <a
                href="https://github.com/lomeyollc/hive/blob/main/src/worker/api/routes.ts"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                src/worker/api/routes.ts
              </a>{" "}
              — the doc comment at the top of that file is kept current with every route.
            </p>
          </Section>

          <Section id="self-host" title="Self-hosting">
            <p>
              Hive is open source and built to run on Cloudflare's free tier (Workers + Durable
              Objects + D1) — one <code>wrangler deploy</code> and it's live on your own domain.
              The full setup sequence (D1 database, Google OAuth credentials, secrets) is in the
              repo's README.
            </p>
            <a
              href="https://github.com/lomeyollc/hive"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 underline underline-offset-2"
            >
              github.com/lomeyollc/hive
              <ExternalLink className="size-3.5" />
            </a>
          </Section>
        </div>
      </div>
    </div>
  );
}
