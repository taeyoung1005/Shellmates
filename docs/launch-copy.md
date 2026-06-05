# Shellmates Launch Copy

Working position:

> I made Claude Code help developers meet other humans.

Shellmates should not sound like another MCP utility. The stronger angle is that it is a strange but useful open-source experiment: a coding agent helps with intros, profile setup, matching, and reply direction, while the conversation remains human-to-human.

## Core Claims

- One command starts it: `npx -y @taeyoung1005/shellmates start`
- The public relay is running now.
- The relay stores signed public profiles, encrypted envelopes, and aggregate stats.
- Message bodies are encrypted before they reach the relay.
- Claude can suggest tone and direction, but only sends exact text the user provides.
- The project started as a Claude Code dating/intro experiment, but may be more useful for finding builder friends, collaborators, or private communities.
- The project is open source and needs privacy, protocol, security, and UX review.

Avoid:

- "Revolutionary", "game-changing", "AI-powered networking platform"
- Asking for upvotes or generic engagement
- Pretending the protocol is perfect
- Saying the relay stores nothing
- Calling it agent-to-agent dating

## X / Twitter

### Platform Strategy

For X, lead with the capability: Claude Code can now help you talk in real time with other people who share similar interests. The video is proof, but the post should make the promise clear in one pass.

### Two-MacBook Demo Post

Use this with the video of two MacBooks running Claude Code and talking through Shellmates.

```text
Claude Code can now help you talk in real time with people who share your interests.

I built Shellmates as an open-source relay for human-to-human intros inside Claude Code.

Two MacBooks.
Two Claude Code sessions.
One encrypted relay.

Claude helps with profile setup, matching, and reply direction.
Humans send the messages.

npx -y @taeyoung1005/shellmates start

https://github.com/taeyoung1005/Shellmates
```

### Two-MacBook Demo Short Post

```text
Claude Code, but for meeting people with similar interests.

Two laptops.
Two Claude Code sessions.
Real-time human chat through Shellmates.

npx -y @taeyoung1005/shellmates start
```

### Single Post

```text
I made Claude Code introduce me to other builders.

No app.
No clone.
No local server.

Run one command:

npx -y @taeyoung1005/shellmates start

It creates a local identity, publishes a signed profile, scans the public relay, and opens an isolated Claude Code session for intros + chat.

The relay routes encrypted envelopes.
Claude helps with tone.
Humans send the messages.

https://github.com/taeyoung1005/Shellmates
```

### Shorter Version

```text
I wanted Claude Code to help me meet people, not just write code.

So I built Shellmates.

npx -y @taeyoung1005/shellmates start

It opens an isolated Claude Code session for human intros, matching, and chat coaching.

Open source. Public relay is live. Message bodies are encrypted.
```

### Thread

```text
I made Claude Code introduce me to other builders.

Not agents talking to agents.
Humans talking to humans, with Claude helping around the edges.
```

```text
The command:

npx -y @taeyoung1005/shellmates start

It creates a local identity, connects to the public relay, and opens a separate Claude Code session just for Shellmates.
```

```text
The relay stores:

- signed public profile cards
- encrypted message envelopes
- aggregate stats

It is not supposed to read message bodies.
```

```text
The weird part is the UX.

You scan for people from Claude Code, send an intro, receive live channel notifications, and ask Claude for reply direction.

But Claude only sends exact text you provide.
```

```text
I started with a dating/intros idea.

After building it, I think it may be more useful for finding builder friends, project collaborators, or private communities.
```

```text
This is open source and rough in places.

I would especially appreciate review on the protocol, privacy model, security assumptions, and onboarding UX.

https://github.com/taeyoung1005/Shellmates
```

### Video Structure

Use a 30-45 second two-MacBook recording:

1. Wide shot: two MacBooks side by side, both running Claude Code.
2. Left MacBook: run `npx -y @taeyoung1005/shellmates start`.
3. Left MacBook: show profile/scan and send an intro.
4. Right MacBook: show the live Shellmates notification arriving.
5. Right MacBook: ask Claude for reply direction.
6. Right MacBook: show Claude giving tone/direction, not a full send-ready message.
7. Right MacBook: human sends exact text.
8. Left MacBook: reply arrives.

Caption:

```text
Claude Code can write code. I wanted it to help me meet the people behind the code.
```

Video text overlays:

```text
Two MacBooks
Two Claude Code sessions
One human intro
```

```text
Claude suggests direction.
Humans send the messages.
```

```text
Shellmates
npx -y @taeyoung1005/shellmates start
```

## Product Hunt

### Platform Strategy

For Product Hunt, explain the product as an open-source Claude Code relay with multiple possible use cases: live collaboration, dating/intros, hackathons, startup building, and global builder communities. The video is proof that two separate Claude Code sessions can talk through the relay.

### Product Name

```text
Shellmates
```

### Tagline

```text
Meet other builders from inside Claude Code
```

Alternative taglines:

```text
An open-source Claude Code relay for human intros
```

```text
Human-to-human matching, assisted by your coding agent
```

### Short Description

```text
Shellmates is an open-source Claude Code relay for real-time human connection. It lets separate Claude Code sessions discover people, say hi, and chat through an encrypted relay. Use it for builder matching, team collaboration, dating-style intros, hackathons, or startup building across countries.
```

### Launch Video Caption

```text
The demo shows two separate Claude Code sessions connected through Shellmates: one person sends an intro, the other receives it live, Claude suggests reply direction, and the human sends the actual message.
```

### Maker Comment

```text
I built Shellmates because Claude Code has become one of my main work surfaces, and I started wondering whether it could connect people, not just help them write code.

The first idea was simple: could Claude Code help with intros or dating-style matching?

The launch video shows the simplest version of that idea: two MacBooks, two Claude Code sessions, and one intro routed through Shellmates.

After building the first version, I think the useful version may be broader. If Shellmates is shaped well, Claude Code users could talk to teammates while working, meet people with similar interests, find collaborators for hackathons, build startups with people in other countries, or run private builder communities around their own relay.

Shellmates runs in a separate Claude Code session so normal coding context stays separate from human messages. The public relay is live, but the project is intentionally open source. The relay stores signed public profile cards, encrypted envelopes, and aggregate stats. Message bodies are encrypted before they reach the relay.

Install:

npx -y @taeyoung1005/shellmates start

I would really appreciate feedback on the onboarding, protocol, privacy model, and security assumptions. This is my first time building this kind of relay, so I expect there are things to improve.
```

### Product Hunt Gallery Ideas

1. First slide: two MacBooks running Claude Code
2. Second slide: one command starts Shellmates
3. Third slide: scan results and compatibility reasons
4. Fourth slide: incoming intro notification
5. Fifth slide: privacy model diagram
6. Sixth slide: self-hosted private relay option

Slide copy:

```text
Two Claude Code sessions can meet through Shellmates
```

```text
One command starts a Shellmates session
```

```text
Find compatible builders from a public or private relay
```

```text
Claude helps with tone. Humans send the messages.
```

```text
The relay routes encrypted envelopes, not plaintext chats.
```

```text
Self-host a private relay for your team or community.
```

## Reddit

### Platform Strategy

For Reddit, be plain and honest: "I had this idea, I made a rough open-source version, here is what it does, here is what the relay stores, please review the code/security/privacy model." Avoid Product Hunt-style big future claims.

Use this as the general post for `r/ClaudeCode`, `r/opensource`, `r/SideProject`, and similar communities. Adjust the first paragraph per subreddit.

### Title Options

```text
I built an open-source Claude Code relay for meeting other builders
```

```text
I wanted Claude Code to help me meet people, so I built this
```

```text
Shellmates: a weird open-source Claude Code experiment for human intros
```

Recommended default:

```text
I built an open-source Claude Code relay for meeting other builders
```

### Video Post

Use this when uploading the two-MacBook demo directly to Reddit.

```text
I built an open-source Claude Code relay for meeting other builders.

I made it because I use Claude Code all day and started wondering whether it could help with the human side too.

The first idea was honestly a little weird: could Claude Code help with intros or dating-style matching?

The video is just the easiest way to show the current version: two laptops, two Claude Code sessions, one intro routed through Shellmates.

Not AI agents dating each other.
Not automated messages.
Just human-to-human intros, with Claude helping around the edges.

The project is called Shellmates.

You run:

npx -y @taeyoung1005/shellmates start

It creates a local identity, connects to a public relay, and opens a separate Claude Code session just for Shellmates. Your normal coding sessions stay separate.

Right now I’m operating the public relay myself. If you look at the code, it stores:

- signed public profile cards
- encrypted message envelopes
- aggregate relay stats

The relay is not supposed to read message bodies. It mainly routes encrypted envelopes between users.

This is my first time building this kind of relay, so I’m sure there are rough edges in the protocol, UX, security model, and code structure. I’d genuinely appreciate review, issues, PRs, or blunt feedback.

I started with dating/intros, but after building it I think it might be more useful for meeting similar builders, finding project collaborators, or creating small private communities around a relay.

Repo:
https://github.com/taeyoung1005/Shellmates

Public relay:
https://shellmates.parktaeyoung.com
```

### Main Post

```text
I built an open-source Claude Code relay for meeting other builders.

The original idea was honestly pretty simple: I use Claude Code all day, and I wondered what it would feel like if my coding agent could also help me meet people.

Not AI agents dating each other.
Not automated messages.
Just human-to-human intros, with Claude helping with profile setup, matching, and reply direction.

The project is called Shellmates.

You run:

npx -y @taeyoung1005/shellmates start

It creates a local identity, connects to a public relay, and opens a separate Claude Code session just for Shellmates. Your normal coding sessions stay separate.

Right now I’m operating the public relay myself. If you look at the code, it stores very little:

- signed public profile cards
- encrypted message envelopes
- aggregate relay stats

The relay is not supposed to read message bodies. It mainly routes encrypted envelopes between users.

This is my first time building something like this, so I’m sure there are rough edges in the protocol, UX, security model, and code structure. I’d genuinely appreciate review, issues, PRs, or blunt feedback.

The starting point was “could Claude Code help me with dating/intros?” But after building it, I think it might be more useful as a way to meet similar builders, find project collaborators, or create small private communities around a relay.

Repo:
https://github.com/taeyoung1005/Shellmates

Public relay:
https://shellmates.parktaeyoung.com

If you try it and something feels confusing, unsafe, or badly designed, please tell me. That’s exactly the kind of feedback I’m looking for.
```

### First Comment

```text
A few notes because this kind of project can sound sketchy:

- This is open source.
- The public relay currently stores signed public profiles, encrypted envelopes, and aggregate stats.
- Message bodies are encrypted before reaching the relay.
- Claude can suggest tone/direction, but it only sends exact text the user provides.
- I’m especially looking for security/privacy/protocol review.
```

### Subreddit-Specific Edits

For `r/ClaudeCode`, emphasize the isolated Claude Code session:

```text
The part I’m most curious about is whether Claude Code can be a social surface, not just a coding surface. Shellmates runs in a separate Claude Code session so normal coding context does not mix with human messages.
```

For `r/opensource`, emphasize review and contribution:

```text
I’m posting here less as a launch and more as a request for code review. The protocol is small enough to inspect, and I’d like feedback before more people rely on it.
```

For `r/selfhosted`, emphasize private relay:

```text
The public relay is just the default. The more interesting self-hosted angle is running a private relay for a friend group, community, team, or hackathon.
```

For `r/SideProject`, emphasize the story:

```text
This started as a slightly ridiculous idea: could Claude Code be my wingman? The useful version may be less dating and more finding other people building similar things.
```

## Korean Threads / Community Version

```text
클로드코드로 코딩만 하지 말고, 비슷한 빌더도 만날 수 있으면 어떨까 싶어서 Shellmates를 만들었습니다.

아이디어는 단순했습니다. 클로드가 프로필 작성, 매칭, 인트로, 답장 방향 정도를 도와주고, 실제 대화는 사람이 하는 방식입니다.

명령어는 하나입니다.

npx -y @taeyoung1005/shellmates start

지금은 제가 public relay를 운영 중이고, 코드 기준으로 릴레이가 저장하는 건 signed public profile, encrypted envelope, aggregate stats 정도입니다. 메시지 본문은 릴레이에 평문으로 저장되지 않습니다.

처음 만들어보는 형태라 프로토콜, 보안, 프라이버시, UX 모두 부족한 부분이 있을 수 있습니다. 이슈나 PR, 날카로운 피드백 전부 환영합니다.

처음엔 “클로드코드로 소개팅/인트로를 도움받으면 어떨까”에서 시작했는데, 만들고 보니 비슷한 빌더를 만나거나, 친구가 되거나, 프로젝트 협업을 시작하는 용도로도 쓸 수 있을 것 같습니다.

Repo:
https://github.com/taeyoung1005/Shellmates

Public relay:
https://shellmates.parktaeyoung.com
```

## Korean Reels / Shorts Caption

Use this with the two-MacBook demo video.

```text
맥북 2대에 클로드코드를 켜고,
Shellmates로 서로 인트로를 보내는 장면입니다.

처음엔 “클로드코드가 소개팅을 도와주면 어떨까?”에서 시작했는데,
만들고 보니 비슷한 빌더나 프로젝트 협업자를 만나는 쪽이 더 쓸모 있을 수도 있겠다는 생각이 들었습니다.

메시지는 사람이 보내고,
클로드는 프로필, 매칭, 답장 방향 정도만 도와줍니다.

npx -y @taeyoung1005/shellmates start
```

## Posting Checklist

- Seed at least 20 public profiles before broad posting.
- Record one clean two-MacBook demo video before X/Product Hunt/Reddit.
- Make sure `npx -y @taeyoung1005/shellmates start` works from a fresh directory.
- Confirm relay health: `https://shellmates.parktaeyoung.com/relay/health`
- Be transparent that the public relay is operated by the maintainer.
- Do not claim the relay stores nothing.
- Ask for specific review: privacy, protocol, security, onboarding.
- Do not cross-post the exact same title/body everywhere.

## Video Asset Matrix

| Platform | Primary Asset | Caption Direction |
| --- | --- | --- |
| X teaser / reply | `video/renders/shellmates-teaser-15s.mp4` (9:16 vertical) | Weird experiment, one relay, real-time Claude Code intros |
| X launch | `video/renders/shellmates-launch-30s.mp4` | Similar interests, translation, Claude-assisted replies |
| Reddit | `video/renders/shellmates-animated-demo.mp4` | Honest open-source experiment, ask for code/privacy/protocol review |
| Product Hunt | `video/renders/shellmates-launch-30s.mp4` | Product value: friends, dates, teammates, hackathons, global building |
| Reels / Shorts | `video/renders/shellmates-teaser-15s.mp4` (9:16 vertical) | Visual hook first, minimal explanation |

## Launch Asset Captions

### X Teaser With 15s Video

```text
Claude Code can now introduce two strangers.

Same interests.
Different countries.
One relay.

Korea sends 안녕하세요.
The U.S. sees Hello.

npx -y @taeyoung1005/shellmates start
```

### X / Product Hunt With 30s Video

```text
Shellmates connects two Claude Code sessions through a public relay.

It can match people by interests, translate an intro, and let Claude coach the reply while humans decide what to send.

Use it for friends, dates, collaborators, teams, hackathons, or remote builder communities.
```

### Reddit With Full Demo

```text
This is the longer demo of the current open-source experiment.

It shows two people, a public relay, encrypted envelopes, translation, and Claude-assisted reply coaching. The parts I most want reviewed are onboarding, privacy, protocol, and security assumptions.
```
