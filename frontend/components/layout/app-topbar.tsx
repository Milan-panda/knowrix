"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useWorkspace } from "@/lib/workspace-context";

function getPageName(pathname: string, wsId: string | undefined): string {
  if (!wsId) return "Dashboard";
  const after = pathname.replace(`/workspace/${wsId}`, "");
  if (!after || after === "/") return "Dashboard";
  if (after.startsWith("/chat")) return "Chat";
  if (after.startsWith("/sources")) return "Sources";
  return "Dashboard";
}

export function AppTopbar() {
  const pathname = usePathname();
  const { currentWorkspace } = useWorkspace();
  const pageName = getPageName(pathname, currentWorkspace?.id);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink href={`/workspace/${currentWorkspace?.id}`}>
              {currentWorkspace?.name ?? "Workspace"}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{pageName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
