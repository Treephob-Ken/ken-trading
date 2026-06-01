# Jam Room art assets

Drop your pixel-art images here and the Jam Room page (`/room`) picks them up
automatically. If a file is missing, the page falls back to the built-in
code-drawn room / cats — so partial sets are fine.

## Files (exact names)

| File | What | Notes |
|------|------|-------|
| `room.png` | The isometric room background | Any size; ~2:1 wide looks best. Full opaque image is fine. |
| `cat-rock.png` | Cat playing guitar (used for WIN + waiting) | **Transparent background** required. |
| `cat-sad.png`  | Crying cat (used when a position is LOSING) | **Transparent background** required. |
| `cat-sleep.png`| Sleeping cat (used when the bot is STOPPED) | **Transparent background** required. |

`.gif` and `.webp` also work (e.g. `room.gif`, `cat-rock.gif`).

## Important
- Cat images **must have a transparent background**, or you'll see a dark
  square around each cat on the floor. Remove backgrounds free at
  remove.bg or photopea.com.
- Only use art you have the rights to (your own / commissioned / CC0).
