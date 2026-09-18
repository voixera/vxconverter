import { V4Extractor } from "./types";
import { YouTubeExtractor } from "./extractors/youtube";
import { VimeoExtractor } from "./extractors/vimeo";
import { TikTokExtractor } from "./extractors/tiktok";
import { RedditExtractor } from "./extractors/reddit";
import { DirectMediaExtractor } from "./extractors/direct-media";
import { GenericExtractor } from "./extractors/generic";

/**
 * Engine V4 VX - Extractor Registry
 */
export class ExtractorRegistry {
  private extractors: V4Extractor[] = [];

  constructor() {
    // Register platform-specific extractors first (highest priority)
    this.extractors.push(new YouTubeExtractor());
    this.extractors.push(new VimeoExtractor());
    this.extractors.push(new TikTokExtractor());
    this.extractors.push(new RedditExtractor());
    this.extractors.push(new DirectMediaExtractor());

    // Register generic fallback extractor last
    this.extractors.push(new GenericExtractor());
  }

  public getExtractorsFor(url: URL): V4Extractor[] {
    return this.extractors.filter((ext) => ext.canHandle(url));
  }
}
