/**
 * Real-world MissAV packed player block (trimmed) used to guard the extractor
 * against grabbing the wrong UUID. The page contains a decoy `user_uuid`
 * cookie value BEFORE the real player source, which is packed:
 *
 *   source='https://surrit.com/<uuid>/playlist.m3u8';
 *   source842='https://surrit.com/<uuid>/720p/video.m3u8';
 *   source1280='https://surrit.com/<uuid>/1080p/video.m3u8';
 *
 * Expected uuid: bdfdc743-8557-416a-87fe-732b08003cec
 * Decoy uuid:    56e04d58-866f-45ac-a1b3-0095e19a56af
 */

export const DECOY_UUID = "56e04d58-866f-45ac-a1b3-0095e19a56af";
export const REAL_UUID = "bdfdc743-8557-416a-87fe-732b08003cec";

export const MISSVAV_HTML = `<!DOCTYPE html><html><head>
<meta property="og:title" content="DLDSS-540 Sample Title">
<meta property="og:image" content="https://fourhoi.com/dldss-540/cover-n.jpg">
</head><body>
<script>
window.user_uuid = '${DECOY_UUID}';
</script>
<script>
let source
let isPreviewing = false

eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}('f=\\'8://7.6/5-4-3-2-1/e.0\\';d=\\'8://7.6/5-4-3-2-1/c/9.0\\';b=\\'8://7.6/5-4-3-2-1/a/9.0\\';',16,16,'m3u8|732b08003cec|87fe|416a|8557|bdfdc743|com|surrit|https|video|1080p|source1280|720p|source842|playlist|source'.split('|'),0,{}))
</script>
</body></html>`;
