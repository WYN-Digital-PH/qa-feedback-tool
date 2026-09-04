import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import TeamMembers from "@/components/settings/TeamMembers";
import TeamInvites from "@/components/settings/TeamInvites";
import RolePermissions from "@/components/settings/RolePermissions";
import { Page, PageHeader, SectionHeading } from "@/components/layout/Page";
import { brand } from "@/config/brand";
import { humanize } from "@/lib/feedbackMeta";
import { cn } from "@/lib/utils";

/**
 * Remembers whether a settings section is expanded, so the big panels don't
 * spring back open on every visit. Storage is a convenience only — if it is
 * unavailable we just fall back to the default.
 */
function useSectionOpen(id: string, initial: boolean) {
  const key = `settings.section.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });

  return [
    open,
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
  ] as const;
}

interface SectionProps {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** A card whose body folds away, so a long panel doesn't push the rest of the page down. */
function CollapsibleCard({ id, title, description, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useSectionOpen(id, defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="surface-card">
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-4 rounded-lg p-6 text-left hover:bg-secondary/40 transition-colors">
        <div className="min-w-0">
          <SectionHeading>{title}</SectionHeading>
          {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-6 pb-6">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export default function Settings() {
  const { user, roles, can, isOwner } = useAuth();
  const canManageTeam = can("team.manage");
  // Deliberately a role check rather than a permission one: this panel exposes
  // the whole access model of the workspace, and who may look at it is not
  // itself something the matrix should be able to hand out.
  const canSeePermissions = isOwner || roles.includes("admin");

  return (
    <Page>
      <PageHeader title="Settings" description="Your account and workspace configuration." />

      <div className="grid gap-4 lg:grid-cols-12 items-start">
        {/* Left: short, always-visible facts about you and the workspace. */}
        <div className="space-y-4 lg:col-span-4">
          <div className="surface-card p-6 space-y-3">
            <SectionHeading>Account</SectionHeading>
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Email:</span> {user?.email}</div>
              <div>
                <span className="text-muted-foreground">Role:</span>{" "}
                {roles.length ? roles.map((r) => humanize(r)).join(", ") : "No access yet"}
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/reset-password">Change password</Link>
            </Button>
          </div>

          <div className="surface-card p-6">
            <SectionHeading className="mb-2">Workspace</SectionHeading>
            <p className="text-sm text-muted-foreground">{brand.companyName}</p>
          </div>
        </div>

        {/* Right: the two long administrative panels, each foldable. */}
        {(canManageTeam || canSeePermissions) && (
          <div className="space-y-4 lg:col-span-8">
            {canManageTeam && (
              <CollapsibleCard id="team" title="Team" description="Members and pending invitations.">
                <Tabs defaultValue="members">
                  <TabsList className="mb-4">
                    <TabsTrigger value="members">Members</TabsTrigger>
                    <TabsTrigger value="invites">Invites</TabsTrigger>
                  </TabsList>
                  <TabsContent value="members">
                    <TeamMembers />
                  </TabsContent>
                  <TabsContent value="invites">
                    <TeamInvites />
                  </TabsContent>
                </Tabs>
              </CollapsibleCard>
            )}

            {/* Owners and admins only. Everyone else sees their own role above; the
                full matrix is a map of the workspace's access model and stays with
                the people who run it. Editing remains owner-only, enforced by RLS. */}
            {canSeePermissions && (
              <CollapsibleCard
                id="permissions"
                title="Roles & permissions"
                defaultOpen={false}
                description={
                  isOwner
                    ? "You are the workspace owner, so you can change what every other role may do."
                    : "What each role may do in this workspace. Only the owner can change this."
                }
              >
                <RolePermissions />
              </CollapsibleCard>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
