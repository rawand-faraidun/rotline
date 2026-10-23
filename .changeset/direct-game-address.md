---
"@rotline/web": patch
"@rotline/api": patch
---

Lower ping where the route through the site's CDN is slow: the game now connects straight to the game server's own address when the server offers one, and falls back to the usual path if that does not open within 5 seconds.
