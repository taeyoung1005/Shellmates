import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Soundtrack, WorldRelayScene, progressAt, sans, scanLine, shell } from "./ShellmatesAnimatedDemo";

const terminalTop = 304;

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
      <Hook
        title="Claude Code can introduce two strangers."
        subtitle="Same interests. Different countries. One relay."
      />
      <WorldRelayScene />
      <MiniTerminal
        side="left"
        title="Mina · Korea"
        lines={["Shellmates: matched with Ken", "You: 안녕하세요", "Relay: translated for Ken"]}
      />
      <MiniTerminal
        side="right"
        title="Ken · United States"
        lines={["Shellmates: incoming intro", "Letter: Hello", "Claude: Ask one simple question."]}
      />
      <TranslationBadge at={8.7} />
      <CommandCta at={12.2} compact />
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
