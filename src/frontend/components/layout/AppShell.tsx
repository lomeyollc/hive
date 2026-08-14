import { Link, NavLink, Outlet } from "react-router-dom";
import { Settings, LogOut } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { HiveLogo } from "@/components/icons/HiveLogo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NeedsHumanBadge } from "@/components/layout/NeedsHumanBadge";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

export function AppShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link to="/boards" className="flex items-center gap-2 font-semibold">
              <HiveLogo className="size-5" />
              Hive
            </Link>
            <span className="h-5 w-px bg-border" />
            <WorkspaceSwitcher />
          </div>

          <nav className="flex items-center gap-1">
            <NavLink
              to="/boards"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              Boards
            </NavLink>

            <NavLink
              to="/workspace"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              Workspace
            </NavLink>

            <NavLink
              to="/activity"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              Activity
            </NavLink>

            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Docs
            </a>

            <NeedsHumanBadge />

            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="ml-2 h-9 gap-2 px-2">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-xs">{initials(user.email)}</AvatarFallback>
                    </Avatar>
                    <span className="hidden text-sm sm:inline">{user.email}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="font-normal">
                    <span className="text-sm font-medium">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings className="size-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void signOut()} className="flex items-center gap-2">
                    <LogOut className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
