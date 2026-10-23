---
"@rotline/web": patch
---

Sounds play from the first shot: the game's sounds are fetched and decoded once while you are in the lobby and reused by every mission, instead of being loaded again at the start of each one (when guns and zombies stayed silent until they had loaded). A sound file that fails to load no longer silences the rest of its group, and sound comes back by itself after the browser pauses it (a switched headset, the tab put away).
