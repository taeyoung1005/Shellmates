import { Composition, Folder, Still } from "remotion";
import { LaunchDemo, type LaunchDemoProps } from "./LaunchDemo";
import { ShellmatesAnimatedDemo } from "./ShellmatesAnimatedDemo";
import { ShellmatesLaunch30, ShellmatesTeaser15 } from "./ShellmatesShorts";
import { ShellmatesThumbnail } from "./ShellmatesThumbnail";

const fps = 30;
const videoSrc = "two-macbooks.mp4";

const xProps = {
  platform: "X",
  title: "Claude Code can now talk to people like you.",
  subtitle: "Two MacBooks. Two Claude Code sessions. One relay.",
  sourceVideo: videoSrc,
  color: "#00d4c7",
  command: "npx -y @taeyoung1005/shellmates start",
  beats: [
    { at: 0, text: "I am testing a weird Claude Code experiment tonight." },
    { at: 5, text: "The goal: real-time conversations from inside Claude Code." },
    { at: 14, text: "Claude helps with the words. Humans decide what to send." },
    { at: 27, text: "Maybe useful. Maybe ridiculous. That is the test." },
    { at: 39, text: "Open source. Public relay is live." }
  ]
} satisfies LaunchDemoProps;

const redditProps = {
  platform: "Reddit",
  title: "I built an open-source Claude Code relay.",
  subtitle: "It started as a dating idea. It might become something more useful.",
  sourceVideo: videoSrc,
  color: "#ff5a36",
  command: "npx -y @taeyoung1005/shellmates start",
  beats: [
    { at: 0, text: "I wanted Claude Code to help two people start talking." },
    { at: 8, text: "Similar interests could mean dating, friends, projects, or hackathons." },
    { at: 20, text: "The public relay stores almost nothing: signed profiles, encrypted envelopes, aggregate stats." },
    { at: 37, text: "This is my first time building something like this." },
    { at: 51, text: "Code review, security feedback, and weird use cases are very welcome." }
  ]
} satisfies LaunchDemoProps;

const phProps = {
  platform: "Product Hunt",
  title: "Shellmates connects Claude Code sessions in real time.",
  subtitle: "Meet, pair, build, or collaborate without leaving the terminal.",
  sourceVideo: videoSrc,
  color: "#ff6154",
  command: "npx -y @taeyoung1005/shellmates start",
  beats: [
    { at: 0, text: "Shellmates is an open-source relay for Claude Code users." },
    { at: 7, text: "It can match people with similar interests while they are already building." },
    { at: 19, text: "Use cases: team pairing, dating, hackathons, founder matching, global startup building." },
    { at: 39, text: "The current public relay is live. Self-hosting is supported too." },
    { at: 58, text: "Install with one command and open the shared channel session." }
  ]
} satisfies LaunchDemoProps;

export const RemotionRoot = () => {
  return (
    <>
      <Folder name="Launch">
        <Composition
          id="ShellmatesAnimatedDemo"
          component={ShellmatesAnimatedDemo}
          durationInFrames={64 * fps}
          fps={fps}
          width={1920}
          height={1080}
        />
        <Composition
          id="ShellmatesTeaser15"
          component={ShellmatesTeaser15}
          durationInFrames={15 * fps}
          fps={fps}
          width={1920}
          height={1080}
        />
        <Composition
          id="ShellmatesLaunch30"
          component={ShellmatesLaunch30}
          durationInFrames={30 * fps}
          fps={fps}
          width={1920}
          height={1080}
        />
        <Still id="ShellmatesThumbnail" component={ShellmatesThumbnail} width={1920} height={1080} />
        <Composition
          id="XTeaser"
          component={LaunchDemo}
          durationInFrames={45 * fps}
          fps={fps}
          width={1920}
          height={1080}
          defaultProps={xProps}
        />
        <Composition
          id="RedditOpenSource"
          component={LaunchDemo}
          durationInFrames={70 * fps}
          fps={fps}
          width={1920}
          height={1080}
          defaultProps={redditProps}
        />
        <Composition
          id="ProductHuntLaunch"
          component={LaunchDemo}
          durationInFrames={80 * fps}
          fps={fps}
          width={1920}
          height={1080}
          defaultProps={phProps}
        />
      </Folder>
    </>
  );
};
