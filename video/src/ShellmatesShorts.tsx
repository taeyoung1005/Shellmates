import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import landAtlas from "world-atlas/land-110m.json";
import { Soundtrack, WorldRelayScene, progressAt, sans, scanLine, shell } from "./ShellmatesAnimatedDemo";

const terminalTop = 304;
const verticalMap = {
  width: 972,
  height: 610,
  left: 54,
  top: 410
};
const verticalLand = feature(landAtlas as any, (landAtlas as any).objects.land) as any;
const verticalProjection = geoEqualEarth().fitSize([verticalMap.width - 82, verticalMap.height - 156], verticalLand);
const verticalWorldPath = geoPath(verticalProjection)(verticalLand) ?? "";

type VerticalPoint = "korea" | "relay" | "us";

const projectVertical = (coordinates: [number, number]) => {
  const point = verticalProjection(coordinates);
  return {
    x: (point?.[0] ?? 0) + 40,
    y: (point?.[1] ?? 0) + 92
  };
};

const verticalPoints: Record<VerticalPoint, { x: number; y: number; label: string; person?: string }> = {
  korea: { ...projectVertical([126.978, 37.5665]), label: "Korea", person: "Mina" },
  relay: { ...projectVertical([0, 24]), label: "Public relay" },
  us: { ...projectVertical([-122.4194, 37.7749]), label: "United States", person: "Ken" }
};

const MiniTerminal = ({
  side,
  title,
  lines,
  delay = 0
}: {
  side: "left" | "right";
  title: string;
  lines: string[];
  delay?: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - (side === "left" ? 12 : 18),
    fps,
    config: { damping: 180 },
    durationInFrames: 20
  });
  const x = interpolate(enter, [0, 1], [side === "left" ? -56 : 56, 0]);

  return (
    <div
      style={{
        position: "absolute",
        top: terminalTop,
        left: side === "left" ? 104 : 1080,
        width: 736,
        height: 382,
        opacity: enter,
        transform: `translateX(${x}px)`,
        borderRadius: 22,
        overflow: "hidden",
        background: "rgba(6,9,13,0.94)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 32px 100px rgba(0,0,0,0.48)"
      }}
    >
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 22px",
          background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.025))",
          borderBottom: "1px solid rgba(255,255,255,0.1)"
        }}
      >
        {["#ff6154", "#ffbd45", "#2de2c6"].map((color) => (
          <span key={color} style={{ width: 13, height: 13, borderRadius: 999, background: color }} />
        ))}
        <span style={{ marginLeft: 10, color: "#d7dde4", fontFamily: shell, fontSize: 18 }}>{title}</span>
      </div>
      <div style={{ padding: "24px", fontFamily: shell, fontSize: 21, lineHeight: 1.55 }}>
        {lines.map((line, index) => {
          const lineFrame = frame - delay * fps;
          const opacity = interpolate(lineFrame, [30 + index * 18, 42 + index * 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp"
          });

          return (
            <div
              key={line}
              style={{
                color: line.startsWith("Claude")
                  ? "#ffba66"
                  : line.startsWith("Shellmates") || line.startsWith("Relay")
                    ? "#2de2c6"
                    : "#e7eef5",
                opacity,
                textShadow: opacity > 0.8 ? "0 0 18px currentColor" : "none"
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Hook = ({ title, subtitle }: { title: string; subtitle: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = progressAt(frame, fps, 0.25, 0.55);

  return (
    <div style={{ position: "absolute", left: 82, top: 70, right: 82, opacity }}>
      <div style={{ fontFamily: sans, fontSize: 68, lineHeight: 0.98, color: "#f8fafc", fontWeight: 840 }}>
        {title}
      </div>
      <div style={{ marginTop: 18, fontFamily: sans, fontSize: 28, color: "#99a4af" }}>{subtitle}</div>
    </div>
  );
};

const VerticalHook = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = progressAt(frame, fps, 0.15, 0.45);

  return (
    <div style={{ position: "absolute", left: 54, top: 82, right: 54, opacity }}>
      <div
        style={{
          display: "inline-block",
          padding: "0 10px 4px",
          marginLeft: -10,
          background: "rgba(93,112,255,0.2)",
          color: "#dfe6ff",
          fontFamily: sans,
          fontSize: 70,
          lineHeight: 0.94,
          fontWeight: 860
        }}
      >
        Claude Code
      </div>
      <div style={{ marginTop: 8, fontFamily: sans, fontSize: 62, lineHeight: 0.96, color: "#f8fafc", fontWeight: 860 }}>
        can introduce
        <br />
        two strangers.
      </div>
      <div style={{ marginTop: 22, fontFamily: sans, fontSize: 27, color: "#9aa5b1" }}>
        Same interests. Different countries. One relay.
      </div>
    </div>
  );
};

const VerticalInterestChips = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = progressAt(frame, fps, 1.0, 0.45);
  const chips = ["Claude Code", "AI tools", "indie hacking"];

  return (
    <div
      style={{
        position: "absolute",
        left: 54,
        right: 54,
        top: 354,
        display: "flex",
        gap: 12,
        opacity
      }}
    >
      {chips.map((chip, index) => (
        <div
          key={chip}
          style={{
            padding: "10px 16px",
            borderRadius: 999,
            color: index === 0 ? "#05100e" : "#cbd5df",
            background: index === 0 ? "#2de2c6" : "rgba(255,255,255,0.075)",
            border: "1px solid rgba(255,255,255,0.12)",
            fontFamily: sans,
            fontSize: 21,
            fontWeight: 760
          }}
        >
          {chip}
        </div>
      ))}
    </div>
  );
};

const VerticalMapScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = progressAt(frame, fps, 1.25, 0.55);
  const pulse = 0.5 + Math.sin(frame / 11) * 0.5;
  const signal = progressAt(frame, fps, 4.0, 1.15);
  const translation = progressAt(frame, fps, 5.6, 0.45);
  const pointStyle = (point: VerticalPoint) => ({ left: verticalPoints[point].x, top: verticalPoints[point].y });
  const kr = pointStyle("korea");
  const relay = pointStyle("relay");
  const us = pointStyle("us");
  const signalX = interpolate(signal, [0, 0.5, 1], [kr.left, relay.left, us.left], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const signalY = interpolate(signal, [0, 0.5, 1], [kr.top, relay.top, us.top], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        position: "absolute",
        left: verticalMap.left,
        top: verticalMap.top,
        width: verticalMap.width,
        height: verticalMap.height,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [34, 0])}px)`,
        borderRadius: 30,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 23% 34%, rgba(45,226,198,0.16), transparent 27%), radial-gradient(circle at 78% 34%, rgba(255,186,102,0.13), transparent 25%), linear-gradient(180deg, rgba(9,14,18,0.98), rgba(4,7,10,0.96))",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 36px 130px rgba(0,0,0,0.55), inset 0 0 90px rgba(45,226,198,0.06)"
      }}
    >
      <svg width={verticalMap.width} height={verticalMap.height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="verticalWorldArc" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#2de2c6" stopOpacity="0.95" />
            <stop offset="50%" stopColor="#9af5e7" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#ffba66" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        {Array.from({ length: 8 }).map((_, index) => (
          <line key={`v-lat-${index}`} x1="0" x2={verticalMap.width} y1={70 + index * 64} y2={70 + index * 64} stroke="rgba(255,255,255,0.045)" />
        ))}
        {Array.from({ length: 10 }).map((_, index) => (
          <line key={`v-lon-${index}`} x1={70 + index * 96} x2={70 + index * 96} y1="0" y2={verticalMap.height} stroke="rgba(255,255,255,0.04)" />
        ))}
        <path
          d={verticalWorldPath}
          transform="translate(40, 92)"
          fill="rgba(223,232,241,0.14)"
          stroke="rgba(223,232,241,0.24)"
          strokeWidth="0.9"
        />
        <path
          d={`M${kr.left} ${kr.top} C ${kr.left - 170} ${kr.top - 150}, ${relay.left - 160} ${relay.top - 70}, ${relay.left} ${relay.top} C ${relay.left + 160} ${relay.top + 70}, ${us.left - 80} ${us.top + 90}, ${us.left} ${us.top}`}
          fill="none"
          stroke="url(#verticalWorldArc)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray="10 12"
          opacity="0.74"
        />
        <circle cx={signalX} cy={signalY} r={12 + pulse * 4} fill="#f8fafc" opacity={signal} />
        <circle cx={signalX} cy={signalY} r={26 + pulse * 10} fill="none" stroke="#2de2c6" strokeWidth="2" opacity={signal * 0.5} />
      </svg>
      <div style={{ position: "absolute", left: 34, top: 28, fontFamily: shell, color: "#2de2c6", fontSize: 21, fontWeight: 840 }}>
        LIVE PUBLIC RELAY
      </div>
      <div style={{ position: "absolute", left: 34, top: 62, fontFamily: sans, color: "#edf4fb", fontSize: 36, fontWeight: 820 }}>
        Mina sends 안녕하세요
      </div>
      <div style={{ position: "absolute", left: 34, top: 110, fontFamily: sans, color: "#98a3af", fontSize: 22 }}>
        Ken receives it as Hello.
      </div>
      {(Object.keys(verticalPoints) as VerticalPoint[]).map((key) => {
        const point = verticalPoints[key];
        return (
          <div key={key} style={{ position: "absolute", left: point.x - 12, top: point.y - 12 }}>
            <div
              style={{
                width: key === "relay" ? 26 : 23,
                height: key === "relay" ? 26 : 23,
                borderRadius: 999,
                background: key === "korea" ? "#2de2c6" : key === "us" ? "#ffba66" : "#f8fafc",
                boxShadow: `0 0 ${key === "relay" ? 36 : 26}px ${key === "korea" ? "rgba(45,226,198,0.55)" : key === "us" ? "rgba(255,186,102,0.55)" : "rgba(255,255,255,0.44)"}`
              }}
            />
            <div
              style={{
                marginTop: 8,
                transform: "translateX(-42%)",
                width: 154,
                textAlign: "center",
                fontFamily: sans,
                fontSize: 16,
                color: "#dce6ef",
                textShadow: "0 2px 14px rgba(0,0,0,0.9)"
              }}
            >
              {point.person ? `${point.person} · ${point.label}` : point.label}
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          right: 30,
          bottom: 28,
          padding: "14px 17px",
          opacity: translation,
          transform: `translateY(${interpolate(translation, [0, 1], [18, 0])}px)`,
          borderRadius: 18,
          background: "rgba(5,8,12,0.95)",
          border: "1px solid rgba(45,226,198,0.35)",
          boxShadow: "0 0 42px rgba(45,226,198,0.2)",
          fontFamily: shell,
          textAlign: "center"
        }}
      >
        <div style={{ color: "#2de2c6", fontSize: 15, fontWeight: 820 }}>translated for Ken</div>
        <div style={{ marginTop: 6, color: "#f8fafc", fontSize: 25, fontWeight: 840 }}>안녕하세요 -&gt; Hello</div>
      </div>
    </div>
  );
};

type VerticalTerminalLine = {
  text: string;
  tone?: "success" | "agent" | "letter" | "message";
};

const VerticalTerminal = ({
  top,
  title,
  lines,
  delay
}: {
  top: number;
  title: string;
  lines: VerticalTerminalLine[];
  delay: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = progressAt(frame, fps, delay, 0.45);

  return (
    <div
      style={{
        position: "absolute",
        left: 54,
        top,
        width: 972,
        height: 258,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [34, 0])}px)`,
        borderRadius: 24,
        overflow: "hidden",
        background: "rgba(6,9,13,0.96)",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 30px 100px rgba(0,0,0,0.5)"
      }}
    >
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 20px",
          background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.025))",
          borderBottom: "1px solid rgba(255,255,255,0.1)"
        }}
      >
        {["#ff6154", "#ffbd45", "#2de2c6"].map((color) => (
          <span key={color} style={{ width: 13, height: 13, borderRadius: 999, background: color }} />
        ))}
        <span style={{ marginLeft: 10, color: "#d7dde4", fontFamily: shell, fontSize: 22, fontWeight: 760 }}>{title}</span>
      </div>
      <div style={{ padding: "21px 24px", fontFamily: shell, fontSize: 27, lineHeight: 1.45 }}>
        {lines.map((line, index) => {
          const lineOpacity = interpolate(frame - fps * delay, [12 + index * 16, 24 + index * 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp"
          });
          const color =
            line.tone === "agent"
              ? "#ffba66"
              : line.tone === "success"
                ? "#2de2c6"
                : line.tone === "letter"
                  ? "#f6f8fb"
                  : "#e7eef5";

          return (
            <div key={line.text} style={{ color, opacity: lineOpacity, textShadow: lineOpacity > 0.8 ? "0 0 18px currentColor" : "none" }}>
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const VerticalCommandCta = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = progressAt(frame, fps, 12.0, 0.65);

  return (
    <div
      style={{
        position: "absolute",
        left: 54,
        right: 54,
        bottom: 86,
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [42, 0])}px)`,
        borderRadius: 24,
        padding: "24px 26px",
        background: "rgba(5,8,12,0.96)",
        border: "1px solid rgba(45,226,198,0.35)",
        boxShadow: "0 28px 100px rgba(0,0,0,0.55)",
        textAlign: "center"
      }}
    >
      <div style={{ fontFamily: sans, fontSize: 31, color: "#f8fafc", fontWeight: 820 }}>Start from your terminal</div>
      <div style={{ marginTop: 16, fontFamily: shell, fontSize: 28, color: "#2de2c6" }}>
        npx -y @taeyoung1005/shellmates start
      </div>
    </div>
  );
};

const TranslationBadge = ({ at }: { at: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - at * fps;
  const opacity = interpolate(local, [0, 12, 104, 128], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const y = interpolate(local, [0, 12], [14, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 740,
        top: 792 + y,
        width: 440,
        padding: "15px 18px",
        opacity,
        borderRadius: 18,
        background: "rgba(6,9,13,0.95)",
        border: "1px solid rgba(45,226,198,0.36)",
        boxShadow: "0 0 42px rgba(45,226,198,0.22)",
        textAlign: "center",
        fontFamily: shell
      }}
    >
      <div style={{ color: "#2de2c6", fontSize: 14, fontWeight: 800 }}>translated for Ken</div>
      <div style={{ marginTop: 6, color: "#f4f8fb", fontSize: 24, fontWeight: 820 }}>안녕하세요 -&gt; Hello</div>
    </div>
  );
};

const CommandCta = ({ at, compact = false }: { at: number; compact?: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = progressAt(frame, fps, at, 0.7);

  if (compact) {
    return (
      <div
        style={{
          position: "absolute",
          left: 490,
          right: 490,
          bottom: 76,
          height: 78,
          opacity: progress,
          transform: `translateY(${interpolate(progress, [0, 1], [38, 0])}px)`,
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(5,8,12,0.94)",
          border: "1px solid rgba(45,226,198,0.34)",
          color: "#2de2c6",
          fontFamily: shell,
          fontSize: 28,
          boxShadow: "0 24px 90px rgba(0,0,0,0.45)"
        }}
      >
        npx -y @taeyoung1005/shellmates start
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 270,
        right: 270,
        bottom: 58,
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [60, 0])}px)`,
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
          Real-time intros and Claude-assisted replies from your terminal.
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

const BaseScene = ({ children, fadeOutFrom }: { children: React.ReactNode; fadeOutFrom: number }) => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [fadeOutFrom, fadeOutFrom + 30], [1, 0], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill style={{ background: "#05070a", color: "#f7fafc", fontFamily: sans, opacity: fadeOut, overflow: "hidden" }}>
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
      {children}
    </AbsoluteFill>
  );
};

export const ShellmatesTeaser15 = () => {
  return (
    <BaseScene fadeOutFrom={420}>
      <VerticalHook />
      <VerticalInterestChips />
      <VerticalMapScene />
      <VerticalTerminal
        top={1040}
        title="Mina · Korea"
        delay={6.2}
        lines={[
          { text: "Shellmates: matched with Ken", tone: "success" },
          { text: "You: 안녕하세요", tone: "message" },
          { text: "Relay: translated for Ken", tone: "success" }
        ]}
      />
      <VerticalTerminal
        top={1332}
        title="Ken · United States"
        delay={8.1}
        lines={[
          { text: "Shellmates: incoming intro", tone: "success" },
          { text: "Letter: Hello", tone: "letter" },
          { text: "Claude: Ask one simple question.", tone: "agent" }
        ]}
      />
      <VerticalCommandCta />
    </BaseScene>
  );
};

export const ShellmatesLaunch30 = () => {
  return (
    <BaseScene fadeOutFrom={870}>
      <Hook
        title="Meet people from inside Claude Code."
        subtitle="Friends, dates, collaborators, and teams. A tiny relay connects the sessions."
      />
      <WorldRelayScene />
      <MiniTerminal
        side="left"
        title="Mina · Korea"
        lines={[
          "Shellmates: interests set",
          "You: 안녕하세요",
          "Relay: translated for Ken",
          "Claude draft: Ask what Ken is building",
          "You: What are you shipping this week?"
        ]}
      />
      <MiniTerminal
        side="right"
        title="Ken · United States"
        lines={[
          "Shellmates: match found",
          "Letter: Hello",
          "Claude: Keep it casual",
          "Letter: What are you shipping this week?"
        ]}
      />
      <TranslationBadge at={13.1} />
      <CommandCta at={25.5} />
    </BaseScene>
  );
};
