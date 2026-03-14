"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Database,
  MessageSquare,
  Layers,
  Activity,
  Plus,
  ArrowRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api";

const DASHBOARD_SCOPE_KEY = "contextiq_dashboard_scope";

interface DailyCount {
  date: string;
  count: number;
}

interface WorkspaceStats {
  sources_count: number;
  ready_sources_count: number;
  threads_count: number;
  total_chunks: number;
  query_activity: DailyCount[];
  source_timeline: DailyCount[];
}

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
  created_at: string;
}

function useCssColor(varName: string, fallback: string) {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim();
    if (raw) setColor(raw);
  }, [varName]);
  return color;
}

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type StatsScope = "workspace" | "personal";

function getInitialScope(isOwner: boolean): StatsScope {
  if (!isOwner) return "personal";
  if (typeof window === "undefined") return "workspace";
  const stored = window.localStorage.getItem(DASHBOARD_SCOPE_KEY);
  return stored === "personal" ? "personal" : "workspace";
}

export default function WorkspaceDashboardPage() {
  const { currentWorkspace, currentRole } = useWorkspace();
  const isOwner = currentRole === "owner";
  const [scope, setScope] = useState<StatsScope>(() => getInitialScope(isOwner));
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync scope from localStorage when isOwner changes (e.g. switched workspace)
  useEffect(() => {
    setScope((prev) => getInitialScope(isOwner));
  }, [isOwner]);

  const fetchStats = useCallback(() => {
    if (!currentWorkspace) return;
    setLoading(true);
    const scopeParam = isOwner ? `?scope=${scope}` : "";
    Promise.all([
      api<WorkspaceStats>(`/api/v1/workspaces/${currentWorkspace.id}/stats${scopeParam}`),
      api<Source[]>(`/api/v1/sources?workspace_id=${currentWorkspace.id}`),
    ])
      .then(([statsData, sourcesData]) => {
        setStats(statsData);
        setSources(sourcesData);
      })
      .catch(() => {
        setStats(null);
        setSources([]);
      })
      .finally(() => setLoading(false));
  }, [currentWorkspace, isOwner, scope]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleScopeChange = useCallback(
    (value: string) => {
      const next = value as StatsScope;
      setScope(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DASHBOARD_SCOPE_KEY, next);
      }
    },
    [],
  );

  const showingPersonal = !isOwner || scope === "personal";

  const wsId = currentWorkspace?.id;

  const queryChartData = useMemo(
    () =>
      stats?.query_activity.map((d) => ({
        date: formatShortDate(d.date),
        queries: d.count,
      })) ?? [],
    [stats],
  );

  const sourceChartData = useMemo(
    () =>
      stats?.source_timeline.map((d) => ({
        date: formatShortDate(d.date),
        sources: d.count,
      })) ?? [],
    [stats],
  );

  const chart1 = useCssColor("--chart-1", "#60a5fa");
  const chart2 = useCssColor("--chart-2", "#818cf8");
  const borderColor = useCssColor("--border", "#27272a");
  const mutedFg = useCssColor("--muted-foreground", "#a1a1aa");

  const processingCount = sources.filter(
    (s) => s.status === "processing",
  ).length;

  const statusValue = loading
    ? "..."
    : processingCount > 0
      ? "Indexing"
      : "Active";
  const statusDescription = loading
    ? ""
    : processingCount > 0
      ? `${processingCount} source${processingCount > 1 ? "s" : ""} processing`
      : "Workspace is ready";

  const statCards = [
    {
      title: "Total Sources",
      value: loading ? "..." : (stats?.sources_count ?? 0),
      icon: Database,
      description: `${stats?.ready_sources_count ?? 0} indexed`,
    },
    {
      title: showingPersonal ? "Your conversations" : "Conversations",
      value: loading ? "..." : (stats?.threads_count ?? 0),
      icon: MessageSquare,
      description:
        (stats?.threads_count ?? 0) === 0
          ? "Start chatting"
          : showingPersonal
            ? "Your threads"
            : "Total threads",
    },
    {
      title: "Chunks Indexed",
      value: loading
        ? "..."
        : (stats?.total_chunks ?? 0).toLocaleString(),
      icon: Layers,
      description: "Across all sources",
    },
    {
      title: "Status",
      value: statusValue,
      icon: Activity,
      description: statusDescription,
    },
  ];

  return (
    <div className="flex-1 space-y-6 p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {currentWorkspace?.name ?? "Workspace"}
          </h2>
          <p className="text-muted-foreground">
            Overview of your workspace activity and sources.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <Tabs value={scope} onValueChange={handleScopeChange} className="w-auto">
              <TabsList className="h-9">
                <TabsTrigger value="workspace" className="text-xs px-3">
                  All activity
                </TabsTrigger>
                <TabsTrigger value="personal" className="text-xs px-3">
                  My activity
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Button variant="outline" asChild>
            <Link href={`/workspace/${wsId}/sources`}>
              <Plus className="mr-2 h-4 w-4" />
              Add source
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/workspace/${wsId}/chat`}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Start chat
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions / empty state */}
      {!loading && sources.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold">No sources yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-4">
              Add PDFs, GitHub repos, or web URLs to start building your
              knowledge base.
            </p>
            <Button asChild>
              <Link href={`/workspace/${wsId}/sources`}>
                <Plus className="mr-2 h-4 w-4" />
                Add your first source
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Sources</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/workspace/${wsId}/sources`}>
                  View all
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sources.slice(0, 5).map((source) => (
                <div
                  key={source.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-sm">
{source.source_type === "pdf" || source.source_type === "file"
                        ? "📄"
                        : source.source_type === "github"
                        ? "🐙"
                        : source.source_type === "notion"
                        ? "📓"
                        : source.source_type === "github_discussions"
                        ? "💬"
                        : source.source_type === "youtube"
                        ? "▶️"
                        : "🌐"}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{source.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {source.source_type} &middot; {source.status}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      source.status === "ready"
                        ? "bg-green-500"
                        : source.status === "processing"
                          ? "bg-yellow-500 animate-pulse"
                          : "bg-red-500"
                    }`}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              {showingPersonal ? "Your query activity" : "Query activity"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {showingPersonal ? "Your messages over the last 14 days" : "User messages over the last 14 days"}
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={queryChartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={borderColor}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: mutedFg }}
                    stroke={mutedFg}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: mutedFg }}
                    stroke={mutedFg}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: `1px solid ${borderColor}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: mutedFg }}
                    itemStyle={{ color: chart1 }}
                  />
                  <Bar
                    dataKey="queries"
                    fill={chart1}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Source Growth
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Cumulative sources over the last 14 days
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sourceChartData}>
                  <defs>
                    <linearGradient
                      id="sourceGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={chart2}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="100%"
                        stopColor={chart2}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={borderColor}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: mutedFg }}
                    stroke={mutedFg}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: mutedFg }}
                    stroke={mutedFg}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: `1px solid ${borderColor}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: mutedFg }}
                    itemStyle={{ color: chart2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sources"
                    stroke={chart2}
                    fill="url(#sourceGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
