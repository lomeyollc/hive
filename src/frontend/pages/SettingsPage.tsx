import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/api";
import type { ApiToken, CreatedApiToken } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";

function formatDateTime(iso: string | null) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SettingsPage() {
  useDocumentTitle("Settings");
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiToken | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function refresh() {
    listApiTokens()
      .then(setTokens)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to load tokens"));
  }

  useEffect(refresh, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const created = await createApiToken(newTokenName.trim());
      setJustCreated(created);
      setNewTokenName("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokeApiToken(id);
      toast.success("Token revoked");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage API Bearer tokens for AI agents and the MCP server.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>API tokens</CardTitle>
            <CardDescription>
              Used by agents and the <code>/mcp</code> route via{" "}
              <code>Authorization: Bearer &lt;token&gt;</code>.
            </CardDescription>
          </div>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setJustCreated(null);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <KeyRound className="size-4" />
                Generate new token
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              {!justCreated ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Generate API token</DialogTitle>
                    <DialogDescription>
                      Give it a label so you remember which agent it's for.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-1.5 py-2">
                    <Label htmlFor="token-name">Label</Label>
                    <Input
                      id="token-name"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                      placeholder="jugglehire-bugfix-agent"
                      autoFocus
                    />
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreate} disabled={creating}>
                      {creating ? "Generating…" : "Generate"}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Token created</DialogTitle>
                    <DialogDescription>
                      Copy this now — it will not be shown again.
                    </DialogDescription>
                  </DialogHeader>

                  <Alert variant="destructive">
                    <AlertTitle>You will not see this token again</AlertTitle>
                    <AlertDescription>
                      Store it somewhere safe. If you lose it, revoke it here and generate a new one.
                    </AlertDescription>
                  </Alert>

                  <div className="flex items-center gap-2">
                    <Input readOnly value={justCreated.token} className="font-mono text-xs" />
                    <Button type="button" size="icon" variant="outline" onClick={() => copyToken(justCreated.token)}>
                      <Copy className="size-4" />
                    </Button>
                  </div>

                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDialogOpen(false);
                        setJustCreated(null);
                      }}
                    >
                      Done
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {tokens === null && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {tokens !== null && tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">No API tokens yet.</p>
          )}

          {tokens !== null && tokens.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Revoke</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id} className={token.revoked ? "opacity-50" : undefined}>
                    <TableCell className="flex items-center gap-2 font-medium">
                      {token.label ?? "Unnamed token"}
                      {token.revoked && (
                        <Badge variant="outline" className="font-normal">
                          Revoked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(token.created_at)}</TableCell>
                    <TableCell>{formatDateTime(token.last_used_at)}</TableCell>
                    <TableCell className="text-right">
                      {!token.revoked && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={revokingId === token.id}
                          onClick={() => handleRevoke(token.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
