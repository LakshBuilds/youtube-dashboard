import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/dashboard/Header";
import StatsCards from "@/components/dashboard/StatsCards";
import VideosTable from "@/components/dashboard/VideosTable";
import ProgressTracker from "@/components/dashboard/ProgressTracker";
import WeeklySummary from "@/components/dashboard/WeeklySummary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@clerk/clerk-react";
import type { Video } from "@/lib/types";
import {
  buildVideoMetadataFromApi,
  fetchVideoData,
  resolveVideoUrl,
  REFRESH_DELAY_MS,
} from "@/lib/youtubeScraper";

const PAGE_SIZE = 1000;

async function fetchAllPages(buildQuery: () => any): Promise<Video[]> {
  let from = 0;
  const all: Video[] = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) return all;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function calculateStats(videos: Video[]) {
  const best = new Map<string, Video>();
  for (const v of videos) {
    const key = v.video_id || v.id;
    const existing = best.get(key);
    if (!existing || (Number(v.view_count) || 0) > (Number(existing.view_count) || 0)) {
      best.set(key, v);
    }
  }
  const unique = Array.from(best.values());
  return {
    totalVideos: unique.length,
    totalLikes: unique.reduce((s, v) => s + (Number(v.like_count) || 0), 0),
    totalComments: unique.reduce((s, v) => s + (Number(v.comment_count) || 0), 0),
    totalViews: unique.reduce((s, v) => s + (Number(v.view_count) || 0), 0),
    totalPayout: unique.reduce((s, v) => s + (Number(v.payout) || 0), 0),
  };
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedCategory = searchParams.get("category") || "All";
  const selectedLanguage = searchParams.get("language") || "All";
  const { user, isLoaded } = useUser();
  const [yourVideos, setYourVideos] = useState<Video[]>([]);
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [globalVideos, setGlobalVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setActiveTab] = useState("your-videos");
  const [teamRefreshMode, setTeamRefreshMode] = useState<"idle" | "zero" | "all">("idle");
  const [teamRefreshProgress, setTeamRefreshProgress] = useState({ current: 0, total: 0 });

  const userEmail = user?.primaryEmailAddress?.emailAddress;

  const fetchVideos = async (email: string) => {
    const buildUserQ = () => {
      let q: any = supabase.from("videos").select("*").eq("created_by_email", email);
      if (selectedCategory !== "All") q = q.eq("category", selectedCategory);
      if (selectedLanguage !== "All") q = q.eq("language", selectedLanguage);
      return q.order("published_at", { ascending: false });
    };
    const buildTeamQ = () => {
      let q: any = supabase.from("videos").select("*");
      if (selectedCategory !== "All") q = q.eq("category", selectedCategory);
      if (selectedLanguage !== "All") q = q.eq("language", selectedLanguage);
      return q.order("published_at", { ascending: false });
    };
    const buildGlobalQ = () => supabase.from("videos").select("*").order("published_at", { ascending: false });

    const [u, t, g] = await Promise.all([fetchAllPages(buildUserQ), fetchAllPages(buildTeamQ), fetchAllPages(buildGlobalQ)]);
    setYourVideos(u);
    setAllVideos(t);
    setGlobalVideos(g);
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { navigate("/auth"); return; }
    (async () => {
      try {
        await fetchVideos(userEmail || "");
      } catch (e) {
        console.error("Error loading videos:", e);
        toast.error("Failed to load videos");
      } finally {
        setLoading(false);
      }
    })();
  }, [isLoaded, user, navigate, selectedCategory, selectedLanguage]);

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }
  if (!user) return null;

  const yourStats = calculateStats(yourVideos);
  const allStats = calculateStats(allVideos);
  const globalStats = calculateStats(globalVideos.length > 0 ? globalVideos : allVideos);

  const refreshVideos = () => fetchVideos(userEmail || "");

  const runTeamVideoRefresh = async (mode: "zero" | "all") => {
    const withUrl = allVideos.filter((v) => resolveVideoUrl(v));
    const targets =
      mode === "zero"
        ? withUrl.filter((v) => (Number(v.view_count) || 0) === 0)
        : withUrl;

    if (targets.length === 0) {
      toast.info(
        mode === "zero"
          ? "No videos with 0 views (and a URL) to refresh."
          : "No videos with a URL to refresh."
      );
      return;
    }

    setTeamRefreshMode(mode);
    setTeamRefreshProgress({ current: 0, total: targets.length });
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < targets.length; i++) {
      const video = targets[i];
      const url = resolveVideoUrl(video)!;
      setTeamRefreshProgress({ current: i + 1, total: targets.length });

      const now = new Date().toISOString();
      try {
        const apiData = await fetchVideoData(url);
        if (!apiData) {
          await supabase
            .from("videos")
            .update({ refresh_failed: true, last_refresh_at: now })
            .eq("id", video.id);
          fail++;
        } else {
          const patch = buildVideoMetadataFromApi(apiData, url);
          await supabase
            .from("videos")
            .update({ ...patch, refresh_failed: false, last_refresh_at: now })
            .eq("id", video.id);
          ok++;
        }
      } catch {
        await supabase
          .from("videos")
          .update({ refresh_failed: true, last_refresh_at: now })
          .eq("id", video.id);
        fail++;
      }

      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, REFRESH_DELAY_MS));
      }
    }

    await refreshVideos();
    setTeamRefreshMode("idle");
    setTeamRefreshProgress({ current: 0, total: 0 });

    if (fail === 0) {
      toast.success(`Refreshed ${ok} video(s).`);
    } else {
      toast.warning(`Updated ${ok}, failed or no API data for ${fail}.`);
    }
  };

  const teamRefreshing = teamRefreshMode !== "idle";
  const zeroViewCount = allVideos.filter(
    (v) => (Number(v.view_count) || 0) === 0 && resolveVideoUrl(v)
  ).length;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold bg-gradient-youtube bg-clip-text text-transparent">Creator Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage and track your YouTube content performance
            {selectedCategory !== "All" && <span className="ml-2 text-primary font-medium">• Category: {selectedCategory}</span>}
          </p>
        </div>

        <Tabs defaultValue="your-videos" className="space-y-6" onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="your-videos">Your Videos</TabsTrigger>
            <TabsTrigger value="team-videos">Team Videos</TabsTrigger>
          </TabsList>

          <TabsContent value="your-videos" className="space-y-6">
            <ProgressTracker yourViews={yourStats.totalViews} teamViews={globalStats.totalViews} variant="your-videos" />
            <StatsCards totalVideos={yourStats.totalVideos} totalLikes={yourStats.totalLikes} totalComments={yourStats.totalComments} totalViews={yourStats.totalViews} totalPayout={yourStats.totalPayout} />
            <VideosTable videos={yourVideos} onUpdate={refreshVideos} />
          </TabsContent>

          <TabsContent value="team-videos" className="space-y-6">
            <ProgressTracker yourViews={yourStats.totalViews} teamViews={globalStats.totalViews} variant="team-videos" />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Refresh team videos</CardTitle>
                <CardDescription>
                  Re-fetch stats from the YouTube scraper API. Use for rows stuck at 0 views or to update everyone&apos;s numbers.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="default"
                    className="bg-gradient-youtube"
                    disabled={teamRefreshing || zeroViewCount === 0}
                    onClick={() => runTeamVideoRefresh("zero")}
                  >
                    {teamRefreshMode === "zero" ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Refreshing {teamRefreshProgress.current}/{teamRefreshProgress.total}…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh 0-view videos
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={teamRefreshing || allVideos.filter((v) => resolveVideoUrl(v)).length === 0}
                    onClick={() => runTeamVideoRefresh("all")}
                  >
                    {teamRefreshMode === "all" ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Refreshing {teamRefreshProgress.current}/{teamRefreshProgress.total}…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh all videos
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground sm:ml-auto">
                  {zeroViewCount} with 0 views · {allVideos.filter((v) => resolveVideoUrl(v)).length} with URL
                </p>
              </CardContent>
            </Card>
            <WeeklySummary totalViews={globalStats.totalViews} totalVideos={globalStats.totalVideos} totalLikes={globalStats.totalLikes} totalComments={globalStats.totalComments} totalPayout={globalStats.totalPayout} />
            <StatsCards totalVideos={allStats.totalVideos} totalLikes={allStats.totalLikes} totalComments={allStats.totalComments} totalViews={allStats.totalViews} totalPayout={allStats.totalPayout} />
            <VideosTable videos={allVideos} onUpdate={refreshVideos} />
          </TabsContent>
        </Tabs>

        <footer className="mt-12 text-center text-sm text-muted-foreground">
          <p>Powered by buyhatke</p>
        </footer>
      </main>
    </div>
  );
};

export default Dashboard;
