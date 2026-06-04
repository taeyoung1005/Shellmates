import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { Audio } from "@remotion/media";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import landAtlas from "world-atlas/land-110m.json";

export const shell = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
export const sans = 'Avenir Next, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const fpsSeconds = (seconds: number, fps: number) => seconds * fps;

type Tone = "command" | "muted" | "success" | "agent" | "message" | "letter" | "coach";

type TerminalLine = {
  at: number;
  text: string;
  tone?: Tone;
};

const leftLines: TerminalLine[] = [
  { at: 4.0, text: "$ npx -y @taeyoung1005/shellmates start", tone: "command" },
  { at: 6.0, text: "Shellmates session configured", tone: "success" },
  { at: 7.0, text: "name : Mina", tone: "muted" },
  { at: 8.0, text: "interests : Claude Code, AI tools, indie hacking", tone: "letter" },
  { at: 9.4, text: "Looking for people with overlapping interests...", tone: "success" },
  { at: 13.8, text: "Incoming letter from Ken", tone: "success" },
  { at: 15.0, text: "Letter: Hey Mina, I also use Claude Code all day. What are you building?", tone: "letter" },
  { at: 18.2, text: "Claude: Ken sounds technical and curious.", tone: "agent" },
  { at: 19.7, text: "Claude draft: \"Sounds fun, Ken. What are you shipping this week?\"", tone: "coach" },
  { at: 22.0, text: "Claude: Keep it casual. Ask one concrete question.", tone: "agent" },
  { at: 24.0, text: "You: Sounds fun, Ken. What are you shipping this week?", tone: "message" },
  { at: 25.4, text: "Sent to Shellmates relay", tone: "success" },
  { at: 38.8, text: "Incoming letter from Ken", tone: "success" },
  { at: 40.0, text: "Letter: A tiny MCP tool for finding collaborators.", tone: "letter" },
  { at: 42.8, text: "Claude draft: \"Send me a demo. I can share Shellmates too.\"", tone: "coach" },
  { at: 45.0, text: "Claude: It asks for proof and offers something back.", tone: "agent" },
  { at: 47.0, text: "You: Send me a demo. I can share Shellmates too.", tone: "message" },
  { at: 48.8, text: "Sent to Shellmates relay", tone: "success" }
];

const rightLines: TerminalLine[] = [
  { at: 4.6, text: "$ npx -y @taeyoung1005/shellmates start", tone: "command" },
  { at: 6.6, text: "Shellmates session configured", tone: "success" },
  { at: 7.6, text: "name : Ken", tone: "muted" },
  { at: 8.6, text: "interests : AI tools, MCP, remote builders", tone: "letter" },
  { at: 10.0, text: "Claude: Match found with Mina.", tone: "agent" },
  { at: 11.8, text: "You: Hey Mina, I also use Claude Code all day. What are you building?", tone: "message" },
  { at: 13.0, text: "Sent to Shellmates relay", tone: "success" },
  { at: 26.2, text: "Incoming letter from Mina", tone: "success" },
  { at: 27.4, text: "Letter: Sounds fun, Ken. What are you shipping this week?", tone: "letter" },
  { at: 30.4, text: "Claude: Mina asked for the concrete thing.", tone: "agent" },
  { at: 31.8, text: "Claude draft: \"A tiny MCP tool for finding collaborators.\"", tone: "coach" },
  { at: 34.0, text: "You: A tiny MCP tool for finding collaborators.", tone: "message" },
  { at: 35.6, text: "Sent to Shellmates relay", tone: "success" },
  { at: 49.2, text: "Incoming letter from Mina", tone: "success" },
  { at: 50.4, text: "Letter: Send me a demo. I can share Shellmates too.", tone: "letter" }
];

const moments = [
  { at: 0, title: "Pick your interests. Meet across borders.", body: "Mina is in Korea. Ken is in the United States. Their Claude Code sessions share lightweight profiles." },
  { at: 10, title: "Two strangers meet on the map", body: "A hello leaves the United States, crosses the relay, and lands in Korea." },
  { at: 18, title: "Claude drafts a reply Mina can edit", body: "It suggests a sentence and explains the intent. Mina still chooses what to send." },
  { at: 26, title: "Mina's reply appears on Ken's terminal", body: "The conversation stays human-to-human, with Claude helping both sides." },
  { at: 39, title: "The loop keeps going", body: "Letter, coaching, reply. Useful for friends, dates, collaborators, and teams." },
  { at: 53, title: "For friends, dates, and teams.", body: "Use it for similar-interest intros, or inside a company, group, or team." }
];

const palette: Record<Tone, string> = {
  command: "#f3f6f8",
  muted: "#7c8793",
  success: "#2de2c6",
  agent: "#ffba66",
  message: "#dfe8f2",
  letter: "#e8f1fb",
  coach: "#ffcf86"
};

const soundEvents = [
  { at: 4.0, src: "sfx-ping.wav", volume: 0.1 },
  { at: 4.6, src: "sfx-ping.wav", volume: 0.1 },
  { at: 8.6, src: "sfx-ping.wav", volume: 0.15 },
  { at: 9.0, src: "sfx-ping.wav", volume: 0.15 },
  { at: 12.8, src: "sfx-ping.wav", volume: 0.18 },
  { at: 13.7, src: "sfx-ping.wav", volume: 0.18 },
  { at: 19.7, src: "sfx-coach.wav", volume: 0.2 },
  { at: 24.9, src: "sfx-ping.wav", volume: 0.18 },
  { at: 25.8, src: "sfx-ping.wav", volume: 0.18 },
  { at: 31.8, src: "sfx-coach.wav", volume: 0.2 },
  { at: 34.9, src: "sfx-ping.wav", volume: 0.18 },
  { at: 38.6, src: "sfx-ping.wav", volume: 0.18 },
  { at: 42.8, src: "sfx-coach.wav", volume: 0.2 },
  { at: 48.0, src: "sfx-ping.wav", volume: 0.18 },
  { at: 49.0, src: "sfx-ping.wav", volume: 0.18 },
  { at: 54.0, src: "sfx-cta.wav", volume: 0.24 }
] as const;

const typingSoundEvents = [...leftLines, ...rightLines].map((line) => ({
  at: line.at,
  duration: Math.max(0.35, Math.min(1.65, line.text.length / (line.tone === "letter" || line.tone === "coach" ? 72 : 46))),
  volume: line.tone === "letter" || line.tone === "coach" ? 0.038 : 0.032
}));

const voiceoverEvents = [
  { at: 0.8, duration: 4.09, src: "voiceover/shellmates-animated-demo/scene-01-intro.mp3" },
  { at: 7.2, duration: 2.56, src: "voiceover/shellmates-animated-demo/scene-02-profile.mp3" },
  { at: 13.7, duration: 3.35, src: "voiceover/shellmates-animated-demo/scene-03-letter.mp3" },
  { at: 18.6, duration: 3.26, src: "voiceover/shellmates-animated-demo/scene-04-coaching.mp3" },
  { at: 26.2, duration: 4.7, src: "voiceover/shellmates-animated-demo/scene-05-reply.mp3" },
  { at: 39.2, duration: 3.07, src: "voiceover/shellmates-animated-demo/scene-06-use-cases.mp3" },
  { at: 54.2, duration: 2.19, src: "voiceover/shellmates-animated-demo/scene-07-cta.mp3" }
] as const;

const voiceoverDuck = (frame: number, fps: number) => {
  const seconds = frame / fps;
  const isSpeaking = voiceoverEvents.some((event) => seconds >= event.at - 0.18 && seconds <= event.at + event.duration + 0.24);

  return isSpeaking ? 0.54 : 1;
};

const terminal = {
  top: 274,
  width: 735,
  height: 466,
  leftX: 80,
  rightX: 1105,
  relayCenterX: 960,
  relayCenterY: 520
};

export const Soundtrack = () => {
  const { fps } = useVideoConfig();

  return (
    <>
      <Audio
        src={staticFile("shellmates-bed.wav")}
        volume={(frame) => {
          const bed = interpolate(frame, [0, fps * 2, fps * 56, fps * 64], [0, 0.18, 0.18, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp"
          });

          return bed * voiceoverDuck(frame, fps);
        }}
      />
      {voiceoverEvents.map((event) => (
        <Sequence key={event.src} from={Math.round(event.at * fps)}>
          <Audio src={staticFile(event.src)} volume={0.88} />
        </Sequence>
      ))}
      {soundEvents.map((event) => (
        <Sequence key={`${event.src}-${event.at}`} from={Math.round(event.at * fps)}>
          <Audio src={staticFile(event.src)} volume={event.volume} />
        </Sequence>
      ))}
      {typingSoundEvents.map((event) => (
        <Sequence
          key={`typing-${event.at}`}
          from={Math.round(event.at * fps)}
          durationInFrames={Math.round(event.duration * fps)}
        >
          <Audio src={staticFile("sfx-key.wav")} volume={event.volume} loop />
        </Sequence>
      ))}
    </>
  );
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const progressAt = (frame: number, fps: number, start: number, duration: number) =>
  interpolate(frame, [fpsSeconds(start, fps), fpsSeconds(start + duration, fps)], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

const revealText = (text: string, frame: number, fps: number, charsPerSecond = 40) => {
  const chars = Math.floor((frame / fps) * charsPerSecond);
  return text.slice(0, clamp(chars, 0, text.length));
};

export const scanLine = (frame: number) => {
  const y = (frame * 5) % 1080;
  return `linear-gradient(180deg, transparent ${Math.max(0, y - 2)}px, rgba(45,226,198,0.1) ${y}px, transparent ${y + 2}px)`;
};

const lineTransform = (local: number) => {
  const opacity = interpolate(local, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const y = interpolate(local, [0, 10], [8, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  return { opacity, transform: `translateY(${y}px)` };
};

const estimatedLineHeight = (line: TerminalLine) => {
  if (line.tone === "letter" || line.tone === "coach") {
    const wrappedLines = Math.ceil(line.text.length / 62);
    return wrappedLines * 21 + 30;
  }

  return Math.ceil(line.text.length / 70) * 23 + 10;
};

const Terminal = ({
  title,
  label,
  side,
  lines
}: {
  title: string;
  label: string;
  side: "left" | "right";
  lines: TerminalLine[];
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startDelay = side === "left" ? 72 : 88;
  const enter = spring({
    frame: frame - startDelay,
    fps,
    config: { damping: 200 },
    durationInFrames: 24
  });
  const x = interpolate(enter, [0, 1], [side === "left" ? -72 : 72, 0]);
  const visibleLines = lines.filter((line) => frame >= line.at * fps);
  const left = side === "left" ? terminal.leftX : terminal.rightX;
  const contentHeight = visibleLines.reduce((height, line) => height + estimatedLineHeight(line), 0);
  const scrollY = Math.max(0, contentHeight - 346);

  return (
    <div
      style={{
        position: "absolute",
        top: terminal.top,
        left,
        width: terminal.width,
        height: terminal.height,
        opacity: enter,
        transform: `translateX(${x}px)`,
        borderRadius: 22,
        overflow: "hidden",
        background: "rgba(7, 10, 13, 0.94)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 34px 120px rgba(0,0,0,0.48)"
      }}
    >
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "0 22px",
          background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.025))",
          borderBottom: "1px solid rgba(255,255,255,0.1)"
        }}
      >
        {["#ff6154", "#ffbd45", "#2de2c6"].map((color) => (
          <span key={color} style={{ width: 13, height: 13, borderRadius: 999, background: color }} />
        ))}
        <span style={{ marginLeft: 12, color: "#cfd5dc", fontFamily: shell, fontSize: 18 }}>{title}</span>
        <span style={{ marginLeft: "auto", color: "#69727d", fontFamily: shell, fontSize: 16 }}>{label}</span>
      </div>
      <div
        style={{
          position: "absolute",
          inset: "56px 0 0 0",
          padding: "20px 24px",
          overflow: "hidden",
          backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "100% 31px"
        }}
      >
        <div style={{ paddingBottom: 32, transform: `translateY(${-scrollY}px)` }}>
          {visibleLines.map((line) => {
            const local = frame - line.at * fps;
            const tone = line.tone ?? "muted";
            const isActive = local < 58;
            const text = revealText(line.text, local, fps, tone === "letter" ? 72 : 46);
            const transform = lineTransform(local);

            if (tone === "letter" || tone === "coach") {
              const isCoach = tone === "coach";
              return (
                <div
                  key={`${line.at}-${line.text}`}
                  style={{
                    ...transform,
                    marginBottom: 8,
                    padding: "10px 13px",
                    borderRadius: 13,
                    background: isCoach ? "rgba(255, 186, 102, 0.1)" : "rgba(222, 232, 242, 0.075)",
                    border: isCoach
                      ? "1px solid rgba(255, 186, 102, 0.22)"
                      : "1px solid rgba(222, 232, 242, 0.14)",
                    color: palette[tone],
                    fontFamily: shell,
                    fontSize: 17,
                    lineHeight: 1.25,
                    letterSpacing: 0,
                    boxShadow: isActive
                      ? isCoach
                        ? "0 0 22px rgba(255,186,102,0.18)"
                        : "0 0 20px rgba(222,232,242,0.14)"
                      : "none"
                  }}
                >
                  {text}
                  {isActive ? <span style={{ color: "#e8edf2" }}>_</span> : null}
                </div>
              );
            }

            return (
              <div
                key={`${line.at}-${line.text}`}
                style={{
                  ...transform,
                  minHeight: 29,
                  marginBottom: 4,
                  color: palette[tone],
                  fontFamily: shell,
                  fontSize: 18,
                  lineHeight: 1.28,
                  letterSpacing: 0,
                  textShadow: isActive ? `0 0 16px ${palette[tone]}55` : "none"
                }}
              >
                {text}
                {isActive ? <span style={{ color: "#e8edf2" }}>_</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ActiveMoment = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const activeIndex = moments.reduce((current, moment, index) => (seconds >= moment.at ? index : current), 0);
  const active = moments[activeIndex];
  const next = moments[activeIndex + 1];
  const localFrame = frame - active.at * fps;
  const fadeIn = interpolate(localFrame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const fadeOut = next
    ? interpolate(frame, [next.at * fps - 12, next.at * fps], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp"
      })
    : 1;
  const opacity = fadeIn * fadeOut;
  const y = interpolate(localFrame, [0, 18], [16, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        right: 80,
        top: 70,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        opacity,
        transform: `translateY(${y}px)`
      }}
    >
      <div style={{ maxWidth: 1000 }}>
        <div style={{ fontFamily: sans, fontSize: 62, lineHeight: 0.98, color: "#f8fafc", fontWeight: 820 }}>
          {active.title}
        </div>
        <div style={{ marginTop: 16, fontFamily: sans, fontSize: 26, lineHeight: 1.32, color: "#9aa4ae" }}>
          {active.body}
        </div>
      </div>
      <div
        style={{
          fontFamily: shell,
          fontSize: 21,
          color: "#2de2c6",
          border: "1px solid rgba(45,226,198,0.34)",
          borderRadius: 999,
          padding: "12px 18px",
          background: "rgba(45,226,198,0.08)"
        }}
      >
        shellmates.parktaeyoung.com/relay
      </div>
    </div>
  );
};

const Packet = ({
  start,
  from,
  to,
  color,
  label
}: {
  start: number;
  from: "left" | "relay" | "right";
  to: "relay" | "left" | "right";
  color: string;
  label: string;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = progressAt(frame, fps, start, 1.3);
  const visible = interpolate(progress, [0, 0.08, 0.92, 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const points = {
    left: { x: terminal.leftX + terminal.width, y: terminal.relayCenterY },
    relay: { x: terminal.relayCenterX, y: terminal.relayCenterY },
    right: { x: terminal.rightX, y: terminal.relayCenterY }
  };
  const startPoint = points[from];
  const endPoint = points[to];
  const x = interpolate(progress, [0, 1], [startPoint.x, endPoint.x]);
  const y = interpolate(progress, [0, 1], [startPoint.y, endPoint.y]);

  return (
    <div
      style={{
        position: "absolute",
        left: x - 56,
        top: y - 23,
        width: 112,
        height: 46,
        borderRadius: 999,
        opacity: visible,
        background: "rgba(9,12,16,0.94)",
        border: `1px solid ${color}`,
        color,
        fontFamily: shell,
        fontSize: 17,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 28px ${color}66`
      }}
    >
      {label}
    </div>
  );
};

const mapWidth = 1260;
const mapHeight = 560;
const worldLand = feature(landAtlas as any, (landAtlas as any).objects.land) as any;
const worldProjection = geoEqualEarth().fitSize([mapWidth, mapHeight], worldLand);
const worldPath = geoPath(worldProjection)(worldLand) ?? "";

type WorldPoint = "us" | "relay" | "kr";

const projectGeo = (coordinates: [number, number]) => {
  const point = worldProjection(coordinates);
  return { x: point?.[0] ?? 0, y: point?.[1] ?? 0 };
};

const worldPoints: Record<WorldPoint, { x: number; y: number; label: string; person?: string; caption: string }> = {
  us: { ...projectGeo([-122.4194, 37.7749]), label: "United States", person: "Ken", caption: "never met Mina" },
  relay: { ...projectGeo([0, 24]), label: "Public relay", caption: "matching channel" },
  kr: { ...projectGeo([126.978, 37.5665]), label: "Korea", person: "Mina", caption: "never met Ken" }
};

const worldSignals = [
  { start: 12.1, from: "us", to: "relay", text: "Hello", color: "#ffba66" },
  { start: 13.35, from: "relay", to: "kr", text: "Hello", color: "#ffba66" },
  { start: 24.45, from: "kr", to: "relay", text: "안녕하세요", color: "#2de2c6" },
  { start: 25.7, from: "relay", to: "us", text: "Hello", color: "#2de2c6" }
] as const satisfies ReadonlyArray<{ start: number; from: WorldPoint; to: WorldPoint; text: string; color: string }>;

const worldBubbles = [
  { at: 11.55, point: "us", text: "Hello", color: "#ffba66" },
  { at: 14.0, point: "kr", text: "Hello", color: "#ffba66" },
  { at: 23.95, point: "kr", text: "안녕하세요", color: "#2de2c6" },
  { at: 26.05, point: "us", text: "Hello", color: "#2de2c6" }
] as const satisfies ReadonlyArray<{ at: number; point: WorldPoint; text: string; color: string }>;

export const WorldRelayScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const firstWindow = Math.min(
    progressAt(frame, fps, 10.15, 0.65),
    interpolate(frame, [fpsSeconds(15.25, fps), fpsSeconds(15.95, fps)], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    })
  );
  const secondWindow = Math.min(
    progressAt(frame, fps, 23.2, 0.65),
    interpolate(frame, [fpsSeconds(27.95, fps), fpsSeconds(28.75, fps)], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    })
  );
  const activeWindow = Math.max(firstWindow, secondWindow);
  const opacity = activeWindow * 0.96;
  const y = interpolate(activeWindow, [0, 1], [34, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const mapLeft = 80;
  const mapTop = 96;
  const translationLocal = frame - fpsSeconds(25.35, fps);
  const translationOpacity = interpolate(translationLocal, [0, 8, 52, 68], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const translationY = interpolate(translationLocal, [0, 10], [8, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  const pointStyle = (point: WorldPoint) => {
    const item = worldPoints[point];
    return { left: mapLeft + item.x, top: mapTop + item.y };
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 250,
        top: 208,
        width: 1420,
        height: 648,
        opacity,
        transform: `translateY(${y}px)`,
        borderRadius: 34,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 18% 34%, rgba(255,186,102,0.12), transparent 24%), radial-gradient(circle at 82% 38%, rgba(45,226,198,0.13), transparent 25%), linear-gradient(180deg, rgba(7,11,15,0.98), rgba(5,8,12,0.96))",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 44px 160px rgba(0,0,0,0.62), inset 0 0 80px rgba(45,226,198,0.045)"
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.18)",
          backdropFilter: "blur(1px)"
        }}
      />
      <svg width="1420" height="648" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="worldSceneGlow" cx="50%" cy="46%" r="66%">
            <stop offset="0%" stopColor="#2de2c6" stopOpacity="0.13" />
            <stop offset="100%" stopColor="#2de2c6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="worldArc" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffba66" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#2de2c6" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#2de2c6" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <rect width="1420" height="648" fill="url(#worldSceneGlow)" />
        {Array.from({ length: 9 }).map((_, index) => (
          <line key={`scene-lat-${index}`} x1="0" x2="1420" y1={64 + index * 58} y2={64 + index * 58} stroke="rgba(255,255,255,0.04)" />
        ))}
        {Array.from({ length: 15 }).map((_, index) => (
          <line key={`scene-lon-${index}`} x1={70 + index * 90} x2={70 + index * 90} y1="0" y2="648" stroke="rgba(255,255,255,0.035)" />
        ))}
        <path
          d={worldPath}
          transform={`translate(${mapLeft}, ${mapTop})`}
          fill="rgba(223,232,241,0.13)"
          stroke="rgba(223,232,241,0.23)"
          strokeWidth="0.9"
        />
        <path
          d={`M${pointStyle("us").left} ${pointStyle("us").top} C 610 206, 690 200, ${pointStyle("relay").left} ${pointStyle("relay").top} C 864 204, 1010 208, ${pointStyle("kr").left} ${pointStyle("kr").top}`}
          fill="none"
          stroke="url(#worldArc)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray="9 11"
          opacity="0.64"
        />
      </svg>
      <div style={{ position: "absolute", left: 54, top: 42, fontFamily: shell, color: "#2de2c6", fontSize: 18, fontWeight: 800 }}>
        REAL WORLD MAP
      </div>
      <div style={{ position: "absolute", left: 54, top: 75, fontFamily: sans, color: "#eef5fb", fontSize: 38, fontWeight: 780 }}>
        Two strangers matched by interests
      </div>
      <div style={{ position: "absolute", left: 56, top: 123, fontFamily: sans, color: "#8f9ba8", fontSize: 21 }}>
        They have never met. Shellmates only knows enough to route a lightweight intro.
      </div>
      {(Object.keys(worldPoints) as WorldPoint[]).map((key) => {
        const point = worldPoints[key];
        const isRelay = key === "relay";
        const marker = pointStyle(key);
        const color = key === "us" ? "#ffba66" : "#2de2c6";
        return (
          <div key={key}>
            <div
              style={{
                position: "absolute",
                left: marker.left - (isRelay ? 15 : 11),
                top: marker.top - (isRelay ? 15 : 11),
                width: isRelay ? 30 : 22,
                height: isRelay ? 30 : 22,
                borderRadius: 999,
                background: color,
                boxShadow: `0 0 ${isRelay ? 46 : 34}px ${color}99`,
                border: "2px solid rgba(255,255,255,0.75)"
              }}
            />
            <div
              style={{
                position: "absolute",
                left: marker.left + (key === "kr" ? -186 : isRelay ? -82 : 22),
                top: marker.top + (isRelay ? 24 : -58),
                width: isRelay ? 164 : 190,
                padding: "10px 12px",
                borderRadius: 14,
                background: "rgba(5,8,12,0.9)",
                border: `1px solid ${color}44`,
                boxShadow: `0 0 28px ${color}22`,
                textAlign: "center",
                fontFamily: shell,
                color: "#eff6fb",
                fontSize: 15,
                lineHeight: 1.25
              }}
            >
              <div style={{ color, fontWeight: 800 }}>{point.person ? point.person : point.label}</div>
              <div style={{ marginTop: 3, color: "#a1acb8", fontSize: 12 }}>{point.person ? point.label : point.caption}</div>
              {point.person ? <div style={{ marginTop: 2, color: "#687380", fontSize: 11 }}>{point.caption}</div> : null}
            </div>
          </div>
        );
      })}
      {worldSignals.map((signal) => {
        const progress = progressAt(frame, fps, signal.start, 1.05);
        const visible = interpolate(progress, [0, 0.1, 0.9, 1], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp"
        });
        const from = pointStyle(signal.from);
        const to = pointStyle(signal.to);
        const x = interpolate(progress, [0, 1], [from.left, to.left]);
        const y = interpolate(progress, [0, 1], [from.top, to.top]);

        return (
          <div
            key={`${signal.start}-${signal.text}`}
            style={{
              position: "absolute",
              left: x - 56,
              top: y - 22,
              minWidth: 112,
              height: 44,
              padding: "0 14px",
              borderRadius: 999,
              opacity: visible,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(5,8,11,0.95)",
              border: `1px solid ${signal.color}88`,
              boxShadow: `0 0 32px ${signal.color}66`,
              color: signal.color,
              fontFamily: shell,
              fontSize: signal.text === "안녕하세요" ? 17 : 18,
              fontWeight: 800,
              whiteSpace: "nowrap"
            }}
          >
            {signal.text}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: pointStyle("relay").left - 120,
          top: pointStyle("relay").top + 76 + translationY,
          width: 240,
          padding: "12px 14px",
          borderRadius: 16,
          opacity: translationOpacity,
          background: "rgba(6,9,13,0.96)",
          border: "1px solid rgba(45,226,198,0.34)",
          boxShadow: "0 0 34px rgba(45,226,198,0.2)",
          textAlign: "center",
          fontFamily: shell
        }}
      >
        <div style={{ color: "#2de2c6", fontSize: 13, fontWeight: 800 }}>translated for Ken</div>
        <div style={{ marginTop: 5, color: "#eff6fb", fontSize: 17, fontWeight: 780 }}>안녕하세요 -&gt; Hello</div>
      </div>
      {worldBubbles.map((bubble) => {
        const point = pointStyle(bubble.point);
        const local = frame - bubble.at * fps;
        const opacity = interpolate(local, [0, 8, 60, 75], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp"
        });
        const y = interpolate(local, [0, 10], [8, 0], {
          easing: Easing.out(Easing.cubic),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp"
        });
        const alignLeft = bubble.point === "us";
        const bubbleTop = alignLeft ? point.top + 26 : point.top - 104;

        return (
          <div
            key={`${bubble.at}-${bubble.text}`}
            style={{
              position: "absolute",
              left: point.left + (alignLeft ? 26 : -178),
              top: bubbleTop + y,
              minWidth: 150,
              maxWidth: 190,
              padding: "12px 16px",
              borderRadius: 17,
              opacity,
              background: "rgba(6,9,13,0.96)",
              border: `1px solid ${bubble.color}66`,
              boxShadow: `0 0 32px ${bubble.color}3d`,
              color: "#f6fafc",
              fontFamily: shell,
              fontSize: bubble.text === "안녕하세요" ? 20 : 21,
              fontWeight: 780,
              textAlign: "center",
              whiteSpace: "nowrap"
            }}
          >
            {bubble.text}
          </div>
        );
      })}
    </div>
  );
};

const RelayCore = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = 0.72 + Math.sin(frame / 12) * 0.12;
  const appear = spring({ frame: frame - 136, fps, config: { damping: 200 }, durationInFrames: 30 });

  return (
    <div style={{ position: "absolute", inset: 0, opacity: appear }}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#2de2c6" stopOpacity="0.08" />
            <stop offset="50%" stopColor="#2de2c6" stopOpacity="0.68" />
            <stop offset="100%" stopColor="#ffba66" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <line x1="815" y1="520" x2="838" y2="520" stroke="url(#line)" strokeWidth="2" />
        <line x1="1082" y1="520" x2="1105" y2="520" stroke="url(#line)" strokeWidth="2" />
        <line x1="960" y1="560" x2="960" y2="650" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeDasharray="6 10" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 838,
          top: 438,
          width: 244,
          height: 164,
          borderRadius: 28,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, rgba(17,24,30,0.96), rgba(8,11,15,0.96))",
          border: "1px solid rgba(45,226,198,0.42)",
          boxShadow: `0 0 ${60 * pulse}px rgba(45,226,198,0.26), inset 0 0 28px rgba(45,226,198,0.06)`
        }}
      >
        <div style={{ fontFamily: shell, color: "#2de2c6", fontSize: 18, marginBottom: 10 }}>PUBLIC RELAY</div>
        <div style={{ fontFamily: sans, color: "#f7fafc", fontSize: 34, fontWeight: 760 }}>Live</div>
        <div style={{ marginTop: 9, fontFamily: shell, color: "#8b98a6", fontSize: 15 }}>encrypted letters</div>
      </div>
    </div>
  );
};

const Cta = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = progressAt(frame, fps, 54, 1.1);
  const y = interpolate(progress, [0, 1], [70, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: 270,
        right: 270,
        bottom: 58,
        opacity: progress,
        transform: `translateY(${y}px)`,
        borderRadius: 26,
        padding: "24px 32px",
        background: "rgba(5,7,10,0.94)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 26px 90px rgba(0,0,0,0.45)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 24
      }}
    >
      <div>
        <div style={{ fontFamily: sans, fontSize: 34, color: "#f9fbfd", fontWeight: 760 }}>Try Shellmates</div>
        <div style={{ marginTop: 7, fontFamily: sans, fontSize: 20, color: "#8d98a5" }}>
          Meet a friend, a date, or a teammate from inside Claude Code.
        </div>
      </div>
      <div
        style={{
          fontFamily: shell,
          fontSize: 27,
          color: "#2de2c6",
          padding: "18px 24px",
          borderRadius: 16,
          background: "rgba(45,226,198,0.08)",
          border: "1px solid rgba(45,226,198,0.24)"
        }}
      >
        npx -y @taeyoung1005/shellmates start
      </div>
    </div>
  );
};

export const ShellmatesAnimatedDemo = () => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [1830, 1920], [1, 0], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill
      style={{
        background: "#05070a",
        color: "#f7fafc",
        fontFamily: sans,
        overflow: "hidden",
        opacity: fadeOut
      }}
    >
      <Soundtrack />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, #05070a 0%, #0b1216 42%, #11100c 100%), linear-gradient(90deg, rgba(45,226,198,0.12), rgba(255,186,102,0.08))"
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)",
          backgroundSize: "64px 64px"
        }}
      />
      <AbsoluteFill style={{ background: scanLine(frame), opacity: 0.09 }} />
      <ActiveMoment />
      <Terminal title="MacBook A / Claude Code" label="Mina · Korea" side="left" lines={leftLines} />
      <Terminal title="MacBook B / Claude Code" label="Ken · United States" side="right" lines={rightLines} />
      <RelayCore />
      <Packet start={8.6} from="left" to="relay" color="#2de2c6" label="profile" />
      <Packet start={9.0} from="right" to="relay" color="#ffba66" label="profile" />
      <Packet start={12.8} from="right" to="relay" color="#dfe8f2" label="letter" />
      <Packet start={13.7} from="relay" to="left" color="#dfe8f2" label="letter" />
      <Packet start={24.9} from="left" to="relay" color="#2de2c6" label="reply" />
      <Packet start={25.8} from="relay" to="right" color="#2de2c6" label="reply" />
      <Packet start={34.9} from="right" to="relay" color="#ffba66" label="letter" />
      <Packet start={38.6} from="relay" to="left" color="#ffba66" label="letter" />
      <Packet start={48.0} from="left" to="relay" color="#2de2c6" label="reply" />
      <Packet start={49.0} from="relay" to="right" color="#2de2c6" label="reply" />
      <WorldRelayScene />
      <Cta />
    </AbsoluteFill>
  );
};
