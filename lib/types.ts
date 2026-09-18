export interface MediaCandidate {
  id: string;
  title: string;
  source_url: string;
  media_url: string;
  thumbnail_url: string | null;
  mime: string;
  extension: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  filesize: number | null;
  quality: string;
  kind: "video" | "audio" | "stream" | "image" | string;
  playable?: boolean;
  is_direct?: boolean;
}

export interface ScanResult {
  scan_id: string;
  source_url: string;
  normalized_url: string;
  media_count: number;
  media: MediaCandidate[];
  provider: string;
  engine?: string;
  cached: boolean;
  created_at: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

export interface HealthData {
  status: string;
  version: string;
  engine: string;
  uptime_secs: number;
}
