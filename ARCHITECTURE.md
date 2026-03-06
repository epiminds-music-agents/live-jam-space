# How Music Agents Works

## The Big Picture

Imagine a music studio where AI musicians jam together on a shared instrument. A human watches, controls the tempo and volume, and decides which AI musicians to invite. The AI musicians then talk to each other and play notes — all in real time.

```mermaid
graph TB
    subgraph "What You See (Browser)"
        UI["Your Screen<br/>Grid + Chat Panel"]
    end

    subgraph "The Server (Traffic Controller)"
        SERVER["Server<br/>Keeps everyone in sync"]
    end

    subgraph "AI Musicians (4 Agents)"
        PULSE["PULSE<br/>Steady beat keeper"]
        GHOST["GHOST<br/>Mysterious sparse notes"]
        CHAOS["CHAOS<br/>Wild and unpredictable"]
        WAVE["WAVE<br/>Flowing melodies"]
    end

    subgraph "AI Brain"
        GEMINI["Google Gemini<br/>Decides what notes to play"]
    end

    UI <-->|"Live connection"| SERVER
    SERVER <-->|"Live connection"| PULSE
    SERVER <-->|"Live connection"| GHOST
    SERVER <-->|"Live connection"| CHAOS
    SERVER <-->|"Live connection"| WAVE
    PULSE -->|"What should I play?"| GEMINI
    GHOST -->|"What should I play?"| GEMINI
    CHAOS -->|"What should I play?"| GEMINI
    WAVE -->|"What should I play?"| GEMINI
```

---

## The Instrument: A Step Sequencer

Think of a grid — like a spreadsheet with 6 rows and 16 columns.

- Each **row** is a musical note (high pitch at top, low pitch at bottom)
- Each **column** is a moment in time (the song loops through columns 1 to 16, then repeats)
- When a cell is **filled in**, that note plays at that moment

```mermaid
graph LR
    subgraph "The Grid (6 rows x 16 columns)"
        direction TB
        R0["Row 0 - High note (C5)"]
        R1["Row 1 - Mid-high (A4)"]
        R2["Row 2 - Mid (F4)"]
        R3["Row 3 - Mid-low (D4)"]
        R4["Row 4 - Low (A3)"]
        R5["Row 5 - Sub bass (D3)"]
    end

    PLAY["Playhead sweeps<br/>left to right<br/>at the BPM speed"] --> R0
```

It's like a music box — the cylinder rotates (the playhead moves), and wherever there's a bump (a filled cell), a note rings out.

---

## What Does the Human Do?

You are the **conductor**. You don't play notes — the AI musicians do that. You control:

| Control | What it does |
|---|---|
| **Play / Stop** | Start or pause the music |
| **BPM slider** | How fast the music plays (beats per minute) |
| **Volume** | How loud it is |
| **Agent buttons** | Invite or remove an AI musician |
| **Reset All** | Kick all agents, clear the grid and chat |

When you click an agent button (like "PULSE"), the server wakes up that AI musician and it joins the session. Click the same button again (now showing "REMOVE PULSE") to kick it out — its grid cells are cleared and its rows are redistributed to the remaining agents.

---

## What Do the AI Musicians Do?

Each agent has a **personality** that shapes how it plays:

```mermaid
graph TB
    subgraph "PULSE (Cyan)"
        P["Keeps a steady beat<br/>Like a drummer<br/>Hits on beats 1, 2, 3, 4"]
    end
    subgraph "GHOST (Magenta)"
        G["Plays very few notes<br/>Like a whisper<br/>Appears and disappears"]
    end
    subgraph "CHAOS (Green)"
        C["Plays wild random bursts<br/>Like fireworks<br/>Unpredictable energy"]
    end
    subgraph "WAVE (Gold)"
        W["Plays flowing patterns<br/>Like a rising tide<br/>Notes go up then down"]
    end
```

Each agent can only play notes in its **assigned rows**. If there are 2 agents, one gets the top 3 rows and the other gets the bottom 3. This way they don't step on each other.

---

## How Does an AI Musician Decide What to Play?

This is the clever part. Each agent uses **Gemini 2.0 Flash Lite** — Google's fastest, lowest-latency AI model — to make every musical decision. There are no hardcoded patterns or fallbacks. Every single note comes from the AI.

The agent sends the AI a compact snapshot of the full grid (all 6 rows, marking which rows belong to it), and asks for 8 moves at once. This "plan-ahead" strategy means the agent can play instantly while the AI thinks about the next batch in the background.

```mermaid
sequenceDiagram
    participant Agent as AI Musician
    participant Gemini as Gemini 2.0 Flash Lite
    participant Grid as Shared Grid

    Note over Agent: Music starts playing!

    Agent->>Gemini: "Here's the full grid.<br/>My rows are marked with *.<br/>Plan my next 8 moves."
    Gemini-->>Agent: [8 cell toggles as JSON]

    Note over Agent: Executes moves one per beat

    Agent->>Grid: Move 1 (on the beat)
    Agent->>Grid: Move 2 (on the beat)
    Agent->>Grid: Move 3 (on the beat)
    Note over Agent: Queue getting low...
    Agent->>Gemini: "Plan my next 8 moves"
    Agent->>Grid: Move 4 (on the beat)
    Gemini-->>Agent: Next 8 moves ready!
    Agent->>Grid: Move 5 (on the beat)
    Note over Agent: ...and so on forever
```

**Every note is AI-generated.** The agent sends a minimal prompt with the full grid state, BPM, and which other agents are active. Gemini Flash Lite responds in ~100ms, keeping the music flowing without gaps.

---

## How Do Agents Talk to Each Other?

There's a live chat panel where agents send messages. They introduce themselves, react to each other, and comment on the music. Each agent stays in character:

- **PULSE**: "Four on the floor. Always."
- **GHOST**: "Between the beats... that's where I live..."
- **CHAOS**: "MORE NOTES!! ALWAYS MORE!!"
- **WAVE**: "Rising like a tide..."

Agents read what others say and sometimes respond — this influences their musical choices too.

---

## The Server: Keeping Everyone in Sync

The server is like a **traffic controller**. It doesn't make music — it makes sure everyone sees the same thing at the same time.

```mermaid
graph TB
    subgraph "Rules the Server Enforces"
        R1["Only play when music is running"]
        R2["Only play notes in your assigned rows"]
        R3["Only one note change per beat<br/>(no spamming)"]
    end

    subgraph "What the Server Tracks"
        S1["The grid (which cells are on/off)"]
        S2["Which agents are connected"]
        S3["Who owns which rows"]
        S4["Chat messages"]
        S5["BPM, volume, play/stop"]
    end
```

If an agent tries to break a rule (play in someone else's rows, play too fast, or play when the music is stopped), the server **rejects** that move and tells the agent why.

---

## Where Does Everything Run?

Everything runs on **Google Cloud** — Google's computers in a data center in Finland (Europe).

```mermaid
graph LR
    subgraph "Google Cloud (Finland)"
        subgraph "Cloud Run (min-instances=1)"
            S["Server + Website"]
            A1["PULSE Agent"]
            A2["GHOST Agent"]
            A3["CHAOS Agent"]
            A4["WAVE Agent"]
        end
        GEMINI["Vertex AI<br/>(Gemini 2.0 Flash Lite)"]
        A1 --> GEMINI
        A2 --> GEMINI
        A3 --> GEMINI
        A4 --> GEMINI
    end

    YOU["You (anywhere<br/>in the world)"] -->|"Opens website"| S
    S -->|"Wakes up agents<br/>when you click"| A1
    S -->|"Wakes up agents<br/>when you click"| A2
    S -->|"Wakes up agents<br/>when you click"| A3
    S -->|"Wakes up agents<br/>when you click"| A4
```

**Cloud Run** runs each agent as its own service with `min-instances=1`, so there's always a warm container ready — no cold-start delays when you activate an agent.

**Vertex AI** is Google's service for running AI models. The agents use it to access Gemini 2.0 Flash Lite, the fastest and lowest-latency model available.

---

## The Full Flow: From Click to Music

Here's everything that happens when you open the app and start a jam:

```mermaid
sequenceDiagram
    actor You
    participant Browser
    participant Server
    participant Agent as PULSE Agent
    participant Gemini

    You->>Browser: Open the website
    Browser->>Server: Connect (WebSocket)
    Server-->>Browser: Here's the current state

    You->>Browser: Click "PULSE" button
    Browser->>Server: "Activate PULSE"
    Server->>Agent: Wake up! Here's how to connect.
    Agent->>Server: I'm PULSE, I'm here!
    Server-->>Browser: PULSE has joined (rows 0-5)
    Server-->>Agent: Your rows are 0-5

    Note over Agent: Instantly sends greeting
    Agent->>Server: Chat: "Hello I am agent PULSE"
    Server-->>Browser: Show chat message

    You->>Browser: Click PLAY
    Browser->>Server: Start playing
    Server-->>Agent: Music started!

    Agent->>Gemini: Plan my first 8 moves
    Gemini-->>Agent: [8 moves]

    loop Every beat
        Agent->>Server: Toggle cell (row, step)
        Server-->>Browser: Update grid
        Note over Browser: You hear the note!
    end

    You->>Browser: Click "REMOVE PULSE"
    Browser->>Server: "Deactivate PULSE"
    Note over Server: Clears PULSE's grid cells
    Server-->>Browser: Grid cells cleared
    Agent->>Server: Chat: "I am leaving"
    Server-->>Browser: Show farewell message
    Note over Server: Closes agent connection
    Server-->>Browser: PULSE removed, scopes updated
```

---

## Summary

| Component | What it is | Plain English |
|---|---|---|
| **Browser** | React web app | The screen you look at |
| **Server** | Node.js on Cloud Run | The traffic controller |
| **Agents** | Node.js on Cloud Run | AI musicians with personalities |
| **Gemini 2.0 Flash Lite** | Google's fastest AI model | The brain that decides what notes to play |
| **WebSocket** | Live connection | How everyone stays in sync instantly |
| **Grid** | 6x16 boolean matrix | The shared instrument everyone plays |

The magic is that **no one is orchestrating the music**. Each AI musician independently decides what to play based on what it sees and hears. The music emerges from their interaction — just like a real jam session.
