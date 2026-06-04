import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

type Beat = {
  at: number;
  text: string;
};

export type LaunchDemoProps = {
  platform: "X" | "Reddit" | "Product Hunt";
  title: string;
  subtitle: string;
  sourceVideo: string;
  color: string;
  command: string;
  beats: Beat[];
};

const shell = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const sans = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const getActiveBeat = (beats: Beat[], seconds: number) => {
  return beats.reduce((active, beat) => (seconds >= beat.at ? beat : active), beats[0]);
};

const Caption = ({ text, color }: { text: string; color: string }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame % 150, [0, 10, 132, 150], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const translateY = interpolate(frame % 150, [0, 12], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        background: "rgba(7, 9, 11, 0.82)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 22,
        boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
        padding: "26px 32px",
        maxWidth: 1120
      }}
    >
      <div
        style={{
          width: 58,
          height: 5,
          background: color,
          borderRadius: 999,
          marginBottom: 18
        }}
      />
      <div style={{ color: "white", fontFamily: sans, fontSize: 52, lineHeight: 1.08, fontWeight: 760 }}>
        {text}
      </div>
    </div>
  );
};

export const LaunchDemo = ({ platform, title, subtitle, sourceVideo, color, command, beats }: LaunchDemoProps) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const activeBeat = getActiveBeat(beats, seconds);
  const introOpacity = interpolate(frame, [0, 18, 120, 150], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const videoOpacity = interpolate(frame, [90, 125], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const outroOpacity = interpolate(frame, [durationInFrames - 145, durationInFrames - 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill style={{ background: "#050607", color: "white", fontFamily: sans }}>
      <AbsoluteFill style={{ opacity: videoOpacity }}>
        <Video
          src={staticFile(sourceVideo)}
          style={{ width: "100%", height: "100%" }}
          objectFit="cover"
          volume={0.82}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(5,6,7,0.78) 0%, rgba(5,6,7,0.18) 42%, rgba(5,6,7,0.72) 100%)"
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 18% 8%, rgba(0,212,199,0.16), transparent 30%), radial-gradient(circle at 88% 92%, rgba(255,97,84,0.16), transparent 32%)",
          opacity: 0.82
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 84,
          top: 70,
          display: "flex",
          gap: 16,
          alignItems: "center",
          fontFamily: shell,
          color: "#d7dde4",
          fontSize: 28
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 24px ${color}`
          }}
        />
        Shellmates / {platform}
      </div>

      <Sequence durationInFrames={155}>
        <div
          style={{
            position: "absolute",
            left: 84,
            bottom: 110,
            width: 1280,
            opacity: introOpacity
          }}
        >
          <div style={{ fontSize: 86, lineHeight: 0.96, fontWeight: 830, letterSpacing: 0 }}>{title}</div>
          <div style={{ marginTop: 26, fontSize: 36, lineHeight: 1.28, color: "#aeb6bf", maxWidth: 1080 }}>
            {subtitle}
          </div>
        </div>
      </Sequence>

      <div style={{ position: "absolute", left: 84, bottom: 112 }}>
        <Caption text={activeBeat.text} color={color} />
      </div>

      <div
        style={{
          position: "absolute",
          right: 78,
          bottom: 78,
          opacity: outroOpacity,
          background: "rgba(7,9,11,0.9)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 20,
          padding: "24px 28px",
          minWidth: 700
        }}
      >
        <div style={{ fontFamily: shell, fontSize: 28, color, marginBottom: 12 }}>try it</div>
        <div style={{ fontFamily: shell, fontSize: 34, color: "#f5f7fa" }}>{command}</div>
      </div>
    </AbsoluteFill>
  );
};
