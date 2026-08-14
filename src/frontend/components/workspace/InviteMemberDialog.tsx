import { useState } from "react";
import { toast } from "sonner";
import { createInvite } from "@/lib/api";
import type { WorkspaceMember } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Copy, Check } from "lucide-react";

export function InviteMemberDialog({
  workspaceId,
  onInvited,
}: {
  workspaceId: string;
  onInvited: (member: WorkspaceMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function openWithFreshValues(next: boolean) {
    if (next) {
      setEmail("");
      setInviteUrl(null);
      setCopied(false);
    }
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim().includes("@")) {
      toast.error("A valid email is required");
      return;
    }
    setSubmitting(true);
    try {
      const { invite_url } = await createInvite(workspaceId, email.trim());
      setInviteUrl(invite_url);
      onInvited({
        id: crypto.randomUUID(), // display-only placeholder; the real row is refetched on next page load
        email: email.trim().toLowerCase(),
        role: "member",
        status: "invited",
        invited_by: null,
        invited_at: new Date().toISOString(),
        accepted_at: null,
        invite_url,
      });
      toast.success("Invite created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyUrl() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={openWithFreshValues}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="size-4" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {!inviteUrl ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
              <DialogDescription>
                No email is sent — you'll get a link to copy and send yourself.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5 py-4">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create invite link"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite created</DialogTitle>
              <DialogDescription>Send this link to {email} however you like.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-4">
              <Input readOnly value={inviteUrl} className="text-xs" />
              <Button type="button" size="icon-sm" variant="outline" onClick={copyUrl}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
