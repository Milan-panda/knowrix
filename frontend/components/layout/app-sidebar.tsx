"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  MessageSquare,
  Database,
  Plug,
  Users,
  LogOut,
  Plus,
  Trash2,
  ChevronRight,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { api, apiDelete } from "@/lib/api";

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
}

interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
}

function sourceIcon(type: string) {
  if (type === "pdf" || type === "file") return "📄";
  if (type === "github") return "🐙";
  if (type === "notion") return "📓";
  if (type === "github_discussions") return "💬";
  if (type === "youtube") return "▶️";
  return "🌐";
}

function statusColor(status: string) {
  if (status === "ready") return "bg-green-500";
  if (status === "processing") return "bg-yellow-500 animate-pulse";
  return "bg-red-500";
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signout } = useAuth();
  const { currentWorkspace, canManageSources, canManageMembers } = useWorkspace();
  const [sources, setSources] = useState<Source[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);

  const wsId = currentWorkspace?.id;
  const isOnChat = wsId ? pathname.startsWith(`/workspace/${wsId}/chat`) : false;

  useEffect(() => {
    if (!wsId) return;
    api<Source[]>(`/api/v1/sources?workspace_id=${wsId}`)
      .then(setSources)
      .catch(() => {});

    const interval = setInterval(() => {
      api<Source[]>(`/api/v1/sources?workspace_id=${wsId}`)
        .then(setSources)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [wsId]);

  const fetchThreads = useCallback(() => {
    if (!wsId) return;
    api<ChatThread[]>(`/api/v1/chat/threads?workspace_id=${wsId}`)
      .then(setThreads)
      .catch(() => {});
  }, [wsId]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Re-fetch threads when navigating to chat or when a new thread is created
  useEffect(() => {
    if (isOnChat) fetchThreads();
  }, [isOnChat, fetchThreads]);

  useEffect(() => {
    const handler = () => fetchThreads();
    window.addEventListener("thread-created", handler);
    return () => window.removeEventListener("thread-created", handler);
  }, [fetchThreads]);

  async function handleDeleteThread(threadId: string) {
    try {
      await apiDelete(`/api/v1/chat/threads/${threadId}`);
      fetchThreads();
      if (pathname.includes(threadId)) {
        router.push(`/workspace/${wsId}/chat`);
      }
    } catch {}
  }

  const navItems = [
    {
      title: "Dashboard",
      url: `/workspace/${wsId}`,
      icon: LayoutDashboard,
      match: wsId ? pathname === `/workspace/${wsId}` : false,
    },
    {
      title: "Chat",
      url: `/workspace/${wsId}/chat`,
      icon: MessageSquare,
      match: isOnChat,
    },
    {
      title: "Sources",
      url: `/workspace/${wsId}/sources`,
      icon: Database,
      match: wsId ? pathname.startsWith(`/workspace/${wsId}/sources`) : false,
    },
    ...(canManageSources
      ? [
          {
            title: "Integrations",
            url: `/workspace/${wsId}/connectors`,
            icon: Plug,
            match: wsId ? pathname.startsWith(`/workspace/${wsId}/connectors`) : false,
          },
        ]
      : []),
    {
      title: "Members",
      url: `/workspace/${wsId}/members`,
      icon: Users,
      match: wsId ? pathname.startsWith(`/workspace/${wsId}/members`) : false,
    },
  ];

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.charAt(0).toUpperCase() ?? "?";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <Separator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) =>
                item.title === "Chat" && threads.length > 0 ? (
                  <Collapsible key={item.title} asChild defaultOpen={isOnChat} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={item.match} tooltip={item.title}>
                          <item.icon />
                          <span>{item.title}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>

                      <SidebarMenuAction asChild className="group-data-[collapsible=icon]:hidden">
                        <Link href={`/workspace/${wsId}/chat`}>
                          <Plus className="h-4 w-4" />
                          <span className="sr-only">New chat</span>
                        </Link>
                      </SidebarMenuAction>

                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {threads.map((thread) => (
                            <SidebarMenuSubItem key={thread.id} className="group/thread">
                              <SidebarMenuSubButton asChild className="pr-7">
                                <Link href={`/workspace/${wsId}/chat?thread=${thread.id}`}>
                                  <span className="truncate text-xs">{thread.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                              <button
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 rounded opacity-0 group-hover/thread:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteThread(thread.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.match}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {sources.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Sources</SidebarGroupLabel>
            {canManageSources && (
              <SidebarGroupAction asChild>
                <Link href={`/workspace/${wsId}/sources`}>
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Add source</span>
                </Link>
              </SidebarGroupAction>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {sources.map((source) => (
                  <SidebarMenuItem key={source.id}>
                    <SidebarMenuButton
                      asChild
                      tooltip={`${source.name} (${source.status})`}
                      className="text-xs"
                    >
                      <Link href={`/workspace/${wsId}/sources`}>
                        <span className="text-sm">{sourceIcon(source.source_type)}</span>
                        <span className="truncate">{source.name}</span>
                        <span
                          className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(source.status)}`}
                        />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">{user?.name ?? "User"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user?.email}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 group-data-[collapsible=icon]:hidden cursor-pointer"
            onClick={() => {
              signout();
              window.location.href = "/signin";
            }}
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
