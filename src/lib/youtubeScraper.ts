export const YOUTUBE_SCRAPER_API_BASE = "https://youtube-scrapper-api.onrender.com";

export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function parseDurationToSeconds(duration: string | undefined | null): number | null {
  if (!duration) return null;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) {
    const parts = duration.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

export async function fetchVideoData(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${YOUTUBE_SCRAPER_API_BASE}/video?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data ?? json;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Metadata fields from API response (for insert or update). */
export function buildVideoMetadataFromApi(apiData: Record<string, unknown>, url: string): Record<string, unknown> {
  const snippet = (apiData.snippet as Record<string, unknown> | undefined) || {};
  const stats = (apiData.statistics as Record<string, unknown> | undefined) || {};
  const content = (apiData.contentDetails as Record<string, unknown> | undefined) || {};
  const channel = (apiData.channel as Record<string, unknown> | undefined) || {};
  const thumbs = (snippet.thumbnails as Record<string, Record<string, { url?: string }>> | undefined) || {};

  return {
    is_short: (apiData.isShort as boolean | undefined) ?? url.includes("/shorts/"),
    title: (snippet.title as string) || (apiData.title as string) || null,
    description: (snippet.description as string) || (apiData.description as string) || null,
    channel_name: (snippet.channelTitle as string) || (channel.title as string) || null,
    channel_id: (snippet.channelId as string) || (channel.id as string) || null,
    thumbnail_url:
      thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null,
    view_count: Number(stats.viewCount) || null,
    like_count: Number(stats.likeCount) || null,
    comment_count: Number(stats.commentCount) || null,
    subscriber_count: Number(channel.subscriberCount) || null,
    duration_seconds:
      (content.durationSeconds as number | undefined) || parseDurationToSeconds(content.duration as string) || null,
    published_at: (snippet.publishedAt as string) || null,
    category: (snippet.categoryId as string) || null,
    tags: Array.isArray(snippet.tags) && snippet.tags.length ? snippet.tags : null,
  };
}

export function resolveVideoUrl(video: { video_url: string | null; video_id: string | null; is_short?: boolean | null }): string | null {
  const trimmed = video.video_url?.trim();
  if (trimmed) return trimmed;
  const id = video.video_id?.trim();
  if (!id) return null;
  if (video.is_short) return `https://www.youtube.com/shorts/${id}`;
  return `https://www.youtube.com/watch?v=${id}`;
}

export const REFRESH_DELAY_MS = 650;
