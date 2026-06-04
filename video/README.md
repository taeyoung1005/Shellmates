# Shellmates Launch Video

Remotion project for turning the two-MacBook Claude Code recording into launch clips for X, Reddit, and Product Hunt.

## Source File

Put the raw recording here:

```bash
video/public/two-macbooks.mp4
```

If the recording is a `.mov`, either rename/export it as MP4 first or update `sourceVideo` in `src/Root.tsx`.

## Render

```bash
cd video
npm install
npm run studio
npm run render:x
npm run render:reddit
npm run render:ph
```

Outputs are written to `video/renders/`.

## Cuts

- `XTeaser`: 45 seconds, informal experiment framing.
- `RedditOpenSource`: 70 seconds, honest open-source story and contribution ask.
- `ProductHuntLaunch`: 80 seconds, broader use cases for collaboration, dating, hackathons, and global startup building.

The same raw footage is reused across all cuts with platform-specific overlays.
