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
- What does a multi-agent pipeline feel like to build? <!-- .element: class="fragment" -->

Notes:
Zaga Code exists for one reason: to learn by building. [[slnc 400]]
[fragment]
I wanted to understand how L L M agents actually work — not just use them, but build one end to end.
[fragment]
That means implementing a ReAct loop from scratch: tool calls, state management, and all the edge cases.
[fragment]
I also wanted hands-on experience integrating M C P servers — the emerging standard for giving models access to external tools and documentation.
[fragment]
And finally, I wanted to feel what it is like to compose multiple agents into a pipeline, where each one has a specific responsibility.

---

<!-- .slide: data-background-color="#3858e9" -->

## How It Works

Notes:
Now let us look at how Zaga Code is built.

---

### Architecture overview

- **Web U I** — React, TanStack Router <!-- .element: class="fragment" -->
- **A P I** — Node.js + LangGraph agent pipeline <!-- .element: class="fragment" -->
- **Model** — Qwen 3 Coder running locally via L M Studio <!-- .element: class="fragment" -->
- **Tools** — File read, write, search, shell + M C P <!-- .element: class="fragment" -->

Notes:
At a high level, Zaga Code has three layers.
[fragment]
A web front end built with React and TanStack Router. It handles conversation threads and real-time streaming.
[fragment]
An A P I layer in Node dot J S, where the agent pipeline lives using LangGraph.
[fragment]
And a single model: Qwen 3 Coder, running entirely on my local machine through L M Studio. No cloud, no A P I keys.
[fragment]
The agent gets a set of tools: read and write files, search the codebase, run shell commands, and connect to M C P servers.

---

### The agent pipeline

```
router → planner → executor → critic
                      ↑            |
                      └── retry ───┘
```

Notes:
The core of the system is a four-phase pipeline built with LangGraph.

---

### Four agents, one pipeline

- **Router** — classifies the request: simple, medium, or complex <!-- .element: class="fragment" -->
- **Planner** — writes a step-by-step plan before any code is touched <!-- .element: class="fragment" -->
- **Executor** — runs the ReAct loop with full tool access <!-- .element: class="fragment" -->
- **Critic** — reviews the output and triggers a retry if needed <!-- .element: class="fragment" -->

Notes:
Each phase is a separate agent node with a focused responsibility.
[fragment]
The router reads the request and classifies its complexity. That classification drives how much planning happens.
[fragment]
The planner produces a structured plan — anywhere from two steps to a full decomposition with dependencies.
[fragment]
The executor runs the actual work: a ReAct loop that calls tools, reads files, writes code, and runs commands.
[fragment]
Finally, the critic reviews whether the task was actually completed. If not, it sends feedback back to the executor for another pass — up to two retries.

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

## Demo

Notes:
Let us see it in action.

---

<!-- .slide: data-background-color="#000000" -->

## Questions?

Notes:
That is the overview. [[slnc 400]] Happy to go deeper on any part of the pipeline, the M C P integration, or the model setup.
