import { AbsoluteFill } from "remotion";
import { sans, shell } from "./ShellmatesAnimatedDemo";

const TerminalCard = ({
  side,
  lines
}: {
  side: "left" | "right";
  lines: Array<{ text: string; color: string }>;
}) => {
  return (
    <div
      style={{
        position: "absolute",
        left: side === "left" ? 112 : undefined,
        right: side === "right" ? 112 : undefined,
        bottom: 88,
        width: 760,
        height: 292,
        borderRadius: 24,
        background: "rgba(6,9,13,0.94)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 30px 120px rgba(0,0,0,0.48)",
        overflow: "hidden",
        fontFamily: shell
      }}
    >
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.025))"
        }}
      >
        {["#ff6154", "#ffbd45", "#2de2c6"].map((color) => (
          <span key={color} style={{ width: 12, height: 12, borderRadius: 999, background: color }} />
        ))}
        <span style={{ marginLeft: 8, color: "#aeb7c0", fontSize: 15 }}>{side === "left" ? "Mina · Korea" : "Ken · United States"}</span>
      </div>
      <div style={{ padding: 28, fontSize: 25, lineHeight: 1.48 }}>
        {lines.map((line) => (
          <div key={line.text} style={{ color: line.color, whiteSpace: "nowrap" }}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
};

export const ShellmatesThumbnail = () => {
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 18% 28%, rgba(255,186,102,0.22), transparent 22%), radial-gradient(circle at 80% 36%, rgba(45,226,198,0.2), transparent 24%), linear-gradient(135deg, #05070a 0%, #0b1216 48%, #11100c 100%)",
        color: "#f8fafc",
        fontFamily: sans,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)",
          backgroundSize: "64px 64px"
        }}
      />
      <div style={{ position: "absolute", left: 90, top: 72, width: 1120 }}>
        <div style={{ fontSize: 82, lineHeight: 0.96, fontWeight: 860 }}>
          Two strangers.
          <br />
          One Claude Code relay.
        </div>
        <div style={{ marginTop: 24, color: "#9aa5af", fontSize: 30 }}>
          Korea sends 안녕하세요. The U.S. sees Hello.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 118,
          top: 96,
          padding: "16px 22px",
          borderRadius: 18,
          background: "rgba(6,9,13,0.92)",
          border: "1px solid rgba(45,226,198,0.32)",
          boxShadow: "0 0 42px rgba(45,226,198,0.18)",
          color: "#2de2c6",
          fontFamily: shell,
          fontSize: 24,
          fontWeight: 820
        }}
      >
        안녕하세요 -&gt; Hello
      </div>
      <TerminalCard
        side="left"
        lines={[
          { text: "Shellmates: matched with Ken", color: "#2de2c6" },
          { text: "You: 안녕하세요", color: "#e7eef5" },
          { text: "Relay: translated for Ken", color: "#2de2c6" },
          { text: "Claude: Keep it casual.", color: "#ffba66" }
        ]}
      />
      <TerminalCard
        side="right"
        lines={[
          { text: "Shellmates: incoming intro", color: "#2de2c6" },
          { text: "Letter: Hello", color: "#e7eef5" },
          { text: "Claude: Ask what Mina is building.", color: "#ffba66" },
          { text: "npx -y @taeyoung1005/shellmates start", color: "#2de2c6" }
        ]}
      />
    </AbsoluteFill>
  );
};
