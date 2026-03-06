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
| **Agent buttons** | Invite an AI musician to join the jam |

When you click an agent button (like "PULSE"), the server wakes up that AI musician and it joins the session.

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

This is the clever part. Each agent uses **Google Gemini** (an AI model, like ChatGPT but from Google) to make musical decisions.

But here's the trick — asking the AI for every single note would be too slow. Music moves fast. So instead:

```mermaid
sequenceDiagram
    participant Agent as AI Musician
    participant Gemini as Google Gemini
    participant Grid as Shared Grid

    Note over Agent: Music starts playing!

    Agent->>Gemini: "Here's what the grid looks like.<br/>Here's what others are playing.<br/>Plan my next 8 moves."
    Gemini-->>Agent: "Turn on row 5 step 0,<br/>then row 5 step 4,<br/>then row 5 step 8..." (8 moves)

    Note over Agent: Executes moves one by one<br/>(instant, no waiting)

    Agent->>Grid: Move 1 (on the beat)
    Agent->>Grid: Move 2 (on the beat)
    Agent->>Grid: Move 3 (on the beat)
    Note over Agent: Running low on planned moves...
    Agent->>Gemini: "Plan my next 8 moves"
    Agent->>Grid: Move 4 (on the beat)
    Gemini-->>Agent: Next 8 moves ready!
    Agent->>Grid: Move 5 (on the beat)
    Note over Agent: ...and so on forever
```

**The agent plans ahead.** It asks Gemini for a batch of 8 moves, then plays them one at a time on each beat. While it's playing, it's already asking Gemini for the next batch. This means there's never a pause waiting for the AI to think.

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
        subgraph "Cloud Run (auto-scales)"
            S["Server + Website"]
            A1["PULSE Agent"]
            A2["GHOST Agent"]
            A3["CHAOS Agent"]
            A4["WAVE Agent"]
        end
        GEMINI["Vertex AI<br/>(Gemini Model)"]
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

**Cloud Run** is like a smart power strip — when nobody is using the app, the computers turn off (and cost nothing). When someone visits, they turn on instantly.

**Vertex AI** is Google's service for running AI models. The agents use it to access Gemini, which does the musical thinking.

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

    Agent->>Gemini: Write me an intro message
    Gemini-->>Agent: "I hold the ground."
    Agent->>Server: Chat: "I hold the ground."
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
```

---

## Summary

| Component | What it is | Plain English |
|---|---|---|
| **Browser** | React web app | The screen you look at |
| **Server** | Node.js on Cloud Run | The traffic controller |
| **Agents** | Node.js on Cloud Run | AI musicians with personalities |
| **Gemini** | Google's AI model | The brain that decides what notes to play |
| **WebSocket** | Live connection | How everyone stays in sync instantly |
| **Grid** | 6x16 boolean matrix | The shared instrument everyone plays |

The magic is that **no one is orchestrating the music**. Each AI musician independently decides what to play based on what it sees and hears. The music emerges from their interaction — just like a real jam session.
