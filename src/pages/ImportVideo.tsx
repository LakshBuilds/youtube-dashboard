import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/dashboard/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, Link as LinkIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@clerk/clerk-react";
import {
  extractYouTubeVideoId,
  fetchVideoData,
  buildVideoMetadataFromApi,
} from "@/lib/youtubeScraper";

const ImportVideo = () => {
  const navigate = useNavigate();
  const { user, isLoaded } = useUser();
  const [loading, setLoading] = useState(true);
  const [singleVideoUrl, setSingleVideoUrl] = useState("");
  const [importingSingle, setImportingSingle] = useState(false);
  const [bulkUrls, setBulkUrls] = useState("");
  const [importingBulk, setImportingBulk] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { navigate("/auth"); return; }
    setLoading(false);
  }, [isLoaded, user, navigate]);

  const saveVideo = async (videoId: string, url: string, apiData: Record<string, unknown> | null) => {
    if (!user) throw new Error("Not authenticated");

    const { data: existing } = await supabase
      .from("videos")
      .select("id")
      .eq("video_id", videoId)
      .maybeSingle();

    if (existing) {
      toast.info(`Video ${videoId} already exists`);
      return false;
    }

    const userInfo = {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress || "",
      fullName: user.fullName || "User",
    };

    const record: Record<string, unknown> = {
      video_id: videoId,
      video_url: url,
      created_by_user_id: userInfo.id,
      created_by_email: userInfo.email,
      created_by_name: userInfo.fullName,
    };

    if (apiData) {
      Object.assign(record, buildVideoMetadataFromApi(apiData, url));
    } else {
      record.is_short = url.includes("/shorts/");
      record.title = `YouTube Video ${videoId}`;
    }

    const { error } = await supabase.from("videos").insert(record);
    if (error) throw error;
    return true;
  };

  const handleImportSingle = async () => {
    if (!user) { toast.error("Not authenticated"); return; }
    const url = singleVideoUrl.trim();
    if (!url) { toast.error("Please enter a video URL"); return; }

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) { toast.error("Invalid YouTube URL"); return; }

    setImportingSingle(true);
    try {
      toast.info("Fetching video data from API...");
      const apiData = await fetchVideoData(url);
      if (!apiData) toast.warning("API unavailable — saving with URL only");

      const saved = await saveVideo(videoId, url, apiData);
      if (saved) {
        toast.success(apiData ? `Imported: ${(apiData as { title?: string }).title || videoId}` : "Video imported (metadata pending)");
        setSingleVideoUrl("");
      }
    } catch (error: unknown) {
      console.error("Import error:", error);
      toast.error(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setImportingSingle(false);
    }
  };

  const handleImportBulk = async () => {
    if (!user) { toast.error("Not authenticated"); return; }
    const urls = bulkUrls.split("\n").map((u) => u.trim()).filter((u) => u.length > 0);
    if (urls.length === 0) { toast.error("Enter at least one URL"); return; }

    setImportingBulk(true);
    setBulkProgress({ current: 0, total: urls.length });
    let success = 0, errors = 0;

    for (let i = 0; i < urls.length; i++) {
      setBulkProgress({ current: i + 1, total: urls.length });
      const url = urls[i];
      try {
        const videoId = extractYouTubeVideoId(url);
        if (!videoId) { errors++; continue; }
        const apiData = await fetchVideoData(url);
        const saved = await saveVideo(videoId, url, apiData);
        if (saved) success++;
      } catch {
        errors++;
      }
    }

    if (errors === 0 && success > 0) {
      toast.success(`Successfully imported ${success} video(s)!`);
      setBulkUrls("");
    } else if (success > 0) {
      toast.warning(`Imported ${success}, failed ${errors}`);
    } else {
      toast.error("Failed to import videos");
    }

    setImportingBulk(false);
    setBulkProgress({ current: 0, total: 0 });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold bg-gradient-youtube bg-clip-text text-transparent">Import Videos</h1>
          <p className="text-muted-foreground mt-1">Import YouTube videos — metadata is fetched automatically via API</p>
        </div>

        <Tabs defaultValue="single" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single"><LinkIcon className="h-4 w-4 mr-2" />Single Video</TabsTrigger>
            <TabsTrigger value="bulk"><FileText className="h-4 w-4 mr-2" />Bulk Import</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Import Single Video</CardTitle>
                <CardDescription>Enter a YouTube video or Shorts URL — title, views, likes, channel info will be fetched automatically</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="single-url">Video URL</Label>
                  <Input
                    id="single-url"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    value={singleVideoUrl}
                    onChange={(e) => setSingleVideoUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleImportSingle()}
                  />
                </div>
                <Button onClick={handleImportSingle} disabled={importingSingle || !singleVideoUrl.trim()} className="bg-gradient-youtube w-full" size="lg">
                  {importingSingle ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Fetching & Importing...</>) : (<><Upload className="h-4 w-4 mr-2" />Import Video</>)}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Bulk Import Videos</CardTitle>
                <CardDescription>Enter multiple YouTube URLs, one per line — each will be fetched from the API</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bulk-urls">Video URLs (one per line)</Label>
                  <Textarea
                    id="bulk-urls"
                    placeholder={`https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtube.com/shorts/abc123\nhttps://youtu.be/xyz789`}
                    value={bulkUrls}
                    onChange={(e) => setBulkUrls(e.target.value)}
                    rows={10}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{bulkUrls.split("\n").filter((l) => l.trim()).length} URL(s) entered</p>
                </div>
                {importingBulk && bulkProgress.total > 0 && (
                  <div className="space-y-2">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-youtube transition-all duration-300" style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground text-center">{bulkProgress.current} / {bulkProgress.total} videos processed</p>
                  </div>
                )}
                <Button onClick={handleImportBulk} disabled={importingBulk || !bulkUrls.trim()} className="bg-gradient-youtube w-full" size="lg">
                  {importingBulk ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing {bulkProgress.current}/{bulkProgress.total}...</>) : (<><Upload className="h-4 w-4 mr-2" />Import All Videos</>)}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default ImportVideo;
