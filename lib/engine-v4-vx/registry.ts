import { V4Extractor } from "./types";
import { YouTubeExtractor } from "./extractors/youtube";
import { VimeoExtractor } from "./extractors/vimeo";
import { TikTokExtractor } from "./extractors/tiktok";
import { RedditExtractor } from "./extractors/reddit";
import { MissavExtractor } from "./extractors/missav";
import { DirectMediaExtractor } from "./extractors/direct-media";
import { GenericExtractor } from "./extractors/generic";

/**
 * ENGINE V4 VX - Extractor Registry
 *
 * Order matters: direct-media and platform extractors run before the generic
 * fallback. The generic extractor always runs last as the universal path.
 */
export class ExtractorRegistry {
  private extractors: V4Extractor[];

  constructor() {
    this.extractors = [
      new DirectMediaExtractor(),
      new YouTubeExtractor(),
      new VimeoExtractor(),
      new TikTokExtractor(),
      new RedditExtractor(),
      new MissavExtractor(),
      new GenericExtractor(),
    ];
  }

  public getExtractorsFor(url: URL): V4Extractor[] {
    return this.extractors.filter((ext) => ext.canHandle(url));
  }

  public all(): V4Extractor[] {
    return [...this.extractors];
  }
}
