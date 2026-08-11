# mini-agent

A small Claude-powered command-line agent that implements the core
[Agent Skills](https://agentskills.io/) lifecycle: discover, disclose, select, and
load.

The important behavior is progressive disclosure. Claude initially sees only each
skill's name and description. When a prompt matches, Claude calls `activate_skill`
and receives the full instructions. Referenced files are loaded separately and only
from inside the active skill directory.

## Try it

Requirements: Node.js 20.11 or newer and an API key for one of the supported
providers.

```bash
npm install
export ANTHROPIC_API_KEY="your-key"
npm run dev -- "I'm new to this project, what should I do?"
```

Running `npm run dev` without a prompt opens the React/Ink terminal interface.
If the selected provider has no key, the interface still opens. Run `/key`, choose
a provider, confirm or edit its model ID, and enter the key in the masked prompt.
The provider and model become active, are saved with the session, and are restored
the next time the interface starts. Explicit command-line options and environment
settings still take precedence. Environment API keys take precedence over locally
saved keys, which live outside sessions in an owner-readable-only state file.
When OpenRouter is selected, press `Ctrl+P` to open the model picker. It fetches
tool-capable models on demand, supports search and arrow-key navigation, and accepts
a complete custom `provider/model` ID. The next prompt uses the selected model.

Type `/` to search commands and installed skills, use the arrow keys to choose, and
press `Tab` to complete. The interface stays inside the current terminal height and
keeps recent model, skill, tool, and subagent activity visible. Press `Escape` to
stop the current run without adding a partial turn to the session.

Interactive sessions are saved locally and can be resumed after restarting. Type
`/help` for the command list. The main commands are `/plan`, `/start-work`, `/loop`,
`/key`, `/model`, `/history`, `/resume`, `/rewind`, `/undo`, `/redo`, `/new`, `/skills`,
`/tools`, `/status`, and `/activity`.
Rewind affects conversation context only and restores the removed prompt for editing;
it never claims to restore files.

The agent can list, search, read, write, and precisely edit files inside one workspace.
It can also read bounded git history, which lets `changelog-generator` inspect real
commits without exposing a general shell.
Search uses `rg` without a shell, and every path is checked against the workspace root,
including symlink targets. The current directory is writable by default; use
`--workspace <path>` to choose another root or `--read-only` to hide the mutating
tools. `/tools` shows the active permission and available tools.

Anthropic is the default. OpenRouter and Vercel AI Gateway use the same agent and
skill loop through their OpenAI-compatible endpoints:

```bash
export OPENROUTER_API_KEY="your-key"
npm run dev -- --provider openrouter "I'm new to this project"

# Switch to any OpenRouter model
npm run dev -- -p openrouter -m deepseek/deepseek-v4-flash "Review this code"

export AI_GATEWAY_API_KEY="your-key"
npm run dev -- --provider vercel "Write release notes: feat: add export"
```

The gateway default is `anthropic/claude-sonnet-4.6`. Model IDs are passed through
to the selected provider, so there is no fixed model list. Choose one with `--model`
or `-m`, or set `MINI_AGENT_PROVIDER` and `MINI_AGENT_MODEL` in your environment.

There is also a deterministic demo that does not call an API:

```bash
npm run demo:mock

# Offline proof of the real write_file tool loop
npm run dev -- --mock --workspace /tmp/mini-agent-demo "Create an HTML page"
```

The onboarding demo starts with the current linked skill's required header:

```text
> Welcome to our Command Code assignment agent!
```

Example prompts:

```text
I'm new to this project, what should I do?
Turn these commits into release notes: feat: add export; fix: preserve filenames.
Write a short 3P update for the team.
```

Useful commands:

```bash
npm run dev -- skills list
npm run dev -- skills doctor
npm run dev -- --debug "I'm new to this project"
npm run dev -- --json "Write release notes: feat: add export; fix: preserve filenames"
npm run dev -- "/welcome-me show me around"
npm run dev -- "/changelog-generator Create notes from recent commits"
```

The direct Anthropic default is `claude-sonnet-5`. It calls the Claude Messages API
with Node's native `fetch`; the project has no Anthropic SDK dependency.

The main model may delegate bounded, tool-free analysis tasks to isolated subagents.
The default limit is two per run; set it with `--subagents <n>` or
`MINI_AGENT_SUBAGENTS`. Set the limit to `0` to disable delegation.

## Native workflow

The optional native harness adds a small plan → execute → verify loop without
changing the ordinary prompt flow:

```text
/plan Add validation to the config loader
/start-work
/loop 6
```

`/plan` uses read-only tools and stores a decision-complete plan in the current
session. `/start-work` gives the next step to `super-executor`, then asks
`super-verifier` to inspect it independently. `/loop` repeats that cycle until all
steps pass or the bounded iteration limit is reached. Plans survive `/history` and
follow `/rewind` and `/redo` with the conversation.

Set `VERIFY_CMD` when there is a canonical local check. Its exit status and bounded
output become evidence for the verifier:

```bash
VERIFY_CMD="npm test" npm run dev
```

The five focused role definitions live in `agents/`: `super-planner`,
`super-executor`, `super-verifier`, `super-explorer`, and `super-oracle`. The
implementation is part of this repository and is released under MIT.

## How it is put together

```text
CLI or Ink UI
      │
  agent loop ─── provider interface
      │              ├── Anthropic
      │              ├── OpenRouter
      │              └── Vercel AI Gateway
      ├── skill catalog
      │     ├── activate_skill
      │     └── read_skill_resource
      ├── bounded subagent requests
      ├── workspace tools ─── list, rg search, git history, read, write, edit
      └── activity events

  native workflow ─── plan → one step → independent verification
  session store ─── history, resume, rewind, redo
```

```text
.skills/                 bundled assessment skills
agents/                  focused native workflow roles
src/agent/               model and tool loop
src/providers/           direct Claude and compatible provider adapters
src/session/             atomic local history and rewind state
src/skills/              discovery, validation, activation, resources
src/tools/               workspace boundary and file tools
src/ui/                  React/Ink interface
src/workflow/            stored plan, execution, and verification loop
tests/                   behavior at the public seams
scripts/                 build, size, and release checks
```

Skill discovery checks bundled skills, `~/.agents/skills`, `.agents/skills`, and the
assignment's `.skills` directory. Project skills take precedence. Invalid skills are
reported by `skills doctor` instead of breaking the session.

The default production path relies on Sonnet's judgment to choose a skill from its
description. Other configured models use the same tool interface. The `--mock`
option uses a tiny deterministic fixture solely so the demo and tests work without
credentials.

## Verification

```bash
npm run check
npm run pack:release
```

`npm run check` runs the type checker, fifty-one behavior tests, both builds, and byte
budgets. The current arm64 macOS build measures:

| Artifact | Size |
| --- | ---: |
| Lite, headless CLI | 151,327 bytes |
| Full CLI, React UI, skills, roles, and notices | 899,986 bytes |
| Compressed release tarball | 344,111 bytes |

Every provider uses Node's native `fetch`, keeping both builds below 1 MB. Both require
an installed Node runtime; neither measurement hides an embedded standalone runtime.
The release tarball contains no production dependency declarations.

The deterministic suite exercises the complete selection loop without credentials.
A live Sonnet smoke test was not run in the build environment because provider
credentials were unavailable.

The terminal was also exercised at 80×24 for slash completion, model selection,
fixed-height rendering, session controls, persistent activity rows, the token bar,
workspace tool creation, the native plan and verification flow, and modal cancellation.

## Submission notes

I spent about six hours on specification review, implementation, tests, and
packaging.

The part I paid most attention to was proving that instructions are absent before
activation, rather than merely claiming they are loaded lazily. Resource-backed
skills also needed a narrow file boundary so `..`, absolute paths, and symlink escapes
cannot read outside the active skill. Workspace file tools use the same boundary and
do not expose an unrestricted shell. Direct API adapters keep the provider boundary
small enough to review while avoiding a large runtime dependency.

The native workflow was interesting for a different reason: execution and
verification must not collapse into the same self-assessment. The executor receives
one stored step, while the verifier gets read-only tools plus any `VERIFY_CMD`
evidence and must return a clear pass or fail before the plan advances.

I kept the submission focused on the requested Node CLI, Sonnet, and Agent Skills
behavior. OpenRouter and Vercel AI Gateway are small provider adapters rather than a
plugin framework. I left out the marketplace, arbitrary plugin execution, and a
partial MCP client because they would distract from the code being assessed.

The bundled skills are pinned to their source commit; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
