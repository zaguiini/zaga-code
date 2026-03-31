<!-- .slide: class="title-slide has-logo" data-background-color="#3858e9" -->

# Zaga Code

Building a local AI coding assistant from scratch

<p class="author">@zaguini</p>

Notes:
Welcome. Today I want to walk you through Zaga Code — a local A I coding assistant I built from scratch. [[slnc 400]] We will cover why I built it, how it works, and I will show a live demo of the agent in action.

---

<!-- .slide: data-background-color="#3858e9" -->

## The Why

Notes:
Let us start with the motivation.

---

### Built to learn

- How do L L M agents actually work? <!-- .element: class="fragment" -->
- What goes into a ReAct loop? <!-- .element: class="fragment" -->
- How do M C P servers integrate? <!-- .element: class="fragment" -->

Notes:
Zaga Code exists for one reason: to learn by building. [[slnc 400]]
[fragment]
I wanted to understand how L L M agents actually work — not just use them, but build one end to end.
[fragment]
That means implementing a ReAct loop from scratch: tool calls, state management, etc.
[fragment]
I also wanted hands-on experience integrating M C P servers — the standard for giving models access to external tools and documentation.

---

<!-- .slide: data-background-color="#3858e9" -->

## How It Works

Notes:
Now let us look at how Zaga Code is built.

---

### Architecture overview

- **Web U I** — React, TanStack Router <!-- .element: class="fragment" -->
- **A P I** — Node.js + LangGraph agent pipeline <!-- .element: class="fragment" -->
- **Model** — Qwen 3.5 running locally via L M Studio <!-- .element: class="fragment" -->
- **Tools** — File read, write, search, shell + M C P <!-- .element: class="fragment" -->

Notes:
At a high level, Zaga Code has a few distinct layers.
[fragment]
A web front end built with React and TanStack Router. It handles conversation threads and real-time streaming.
[fragment]
An A P I layer in Node dot J S, where the agent pipeline lives using LangGraph.
[fragment]
A single model: Qwen 3.5, running entirely on my local machine through L M Studio. No cloud, no A P I keys.
[fragment]
And a focused tool set: read and write files, search the codebase, run shell commands, and connect to M C P servers.

---

### The agent pipeline

```
`system-prompt` -> `executor` <-> `tools`
```

Notes:
The core of the system is a focused ReAct loop built with LangGraph.

---

### The pipeline

- **System prompt** — injects workspace context before execution begins <!-- .element: class="fragment" -->
- **Executor** — runs the ReAct loop: reason, call tools, observe, repeat <!-- .element: class="fragment" -->
- **Tools** — file read, write, search, shell, and M C P servers <!-- .element: class="fragment" -->

Notes:
The pipeline is intentionally simple.
[fragment]
Before the executor runs, a system prompt node injects context about the current workspace — what the project is, what tools are available, and how to behave.
[fragment]
The executor is the heart of the agent: a ReAct loop that reasons about the task, calls tools, observes results, and keeps going until the work is done.
[fragment]
The tool set covers everything needed to work inside a codebase: reading and writing files, searching, running shell commands, and connecting to M C P servers for live documentation.

---

### M C P: connecting to the outside world

- All agents connect via the **Model Context Protocol** <!-- .element: class="fragment" -->
- Executor uses **Context 7** M C P for live documentation <!-- .element: class="fragment" -->
- Any M C P server can be added — databases, A P Is, internal tools <!-- .element: class="fragment" -->

Notes:
M C P — the Model Context Protocol — is what lets agents reach beyond the local filesystem.
[fragment]
All agent nodes in the pipeline are wired through a shared M C P client.
[fragment]
Right now the executor connects to Context 7, which gives it access to live, up-to-date library documentation. No more hallucinated A P Is.
[fragment]
But M C P is pluggable. Any server can be dropped in: a database, an internal A P I, a design system. The agent picks up new tools automatically.

---

<!-- .slide: data-background-color="#3858e9" -->

## Demo 1: Using an M C P

Notes:
Let us start with the simpler demo — using an M C P server the agent already knows about.

---

### Simple demo — live docs via Context 7

Ask the agent about a library.

> "What are the text styling possibilities in Tailwind?"

---

<!-- .slide: data-background-color="#3858e9" -->

## Demo 2: Adding a New Tool

---

### Complex demo — extending the agent

Add a new tool and register it.

> "Let's add a new Hello World tool and expose it to the agent."

---

<!-- .slide: data-background-color="#000000" -->

## Questions?

Notes:
That is the overview. [[slnc 400]] Happy to go deeper on any part of the pipeline, the M C P integration, or the model setup.
