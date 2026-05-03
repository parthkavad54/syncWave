
export interface YouTubeTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number; // Seconds
  type: 'youtube';
}

function parseDuration(duration: string): number {
  const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;
  const hours = parseInt(matches[1] || '0');
  const minutes = parseInt(matches[2] || '0');
  const seconds = parseInt(matches[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

export async function searchYouTube(query: string, apiKey: string): Promise<YouTubeTrack[]> {
  if (!apiKey) return [];
  
  // Search for videos
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=10&key=${apiKey}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (searchData.error) {
    throw new Error(searchData.error.message);
  }

  const videoIds = searchData.items.map((item: any) => item.id.videoId);
  if (videoIds.length === 0) return [];

  // Get details (duration, etc)
  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = await detailsRes.json();

  return detailsData.items.map((item: any) => ({
    id: item.id,
    title: item.snippet.title,
    artist: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url,
    duration: parseDuration(item.contentDetails.duration),
    type: 'youtube'
  }));
}
