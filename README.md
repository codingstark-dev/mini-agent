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
When OpenRouter is selected, press `Ctrl+P` to open the model picker. It fetches
tool-capable models on demand, supports search and arrow-key navigation, and accepts
a complete custom `provider/model` ID. The next prompt uses the selected model.

Type `/` to search commands and installed skills, use the arrow keys to choose, and
press `Tab` to complete. The interface stays inside the current terminal height and
keeps recent model, skill, tool, and subagent activity visible. Press `Escape` to
stop the current run without adding a partial turn to the session.

Interactive sessions are saved locally and can be resumed after restarting. Type
`/help` for the command list. The main commands are `/model`, `/history`, `/resume`,
`/rewind`, `/undo`, `/redo`, `/new`, `/skills`, `/tools`, `/status`, and `/activity`.
Rewind affects conversation context only and restores the removed prompt for editing;
it never claims to restore files.

The agent can list, search, read, write, and precisely edit files inside one workspace.
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
```

The direct Anthropic default is `claude-sonnet-5`.

The main model may delegate bounded, tool-free analysis tasks to isolated subagents.
The default limit is two per run; set it with `--subagents <n>` or
`MINI_AGENT_SUBAGENTS`. Set the limit to `0` to disable delegation.

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
      ├── workspace tools ─── list, rg search, read, write, edit
      └── activity events

  session store ─── history, resume, rewind, redo
```

```text
.skills/                 bundled assessment skills
src/agent/               model and tool loop
src/providers/           official SDK and lightweight API adapters
src/session/             atomic local history and rewind state
src/skills/              discovery, validation, activation, resources
src/tools/               workspace boundary and file tools
src/ui/                  React/Ink interface
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

`npm run check` runs the type checker, thirty-five behavior tests, both builds, and byte
budgets. The current arm64 macOS build measures:

| Artifact | Size |
| --- | ---: |
| Lite, headless CLI | 320,262 bytes |
| Full CLI, React UI, skills, and notices | 1,050,281 bytes |
| Compressed release tarball | 430,839 bytes |

The full build uses the official Anthropic SDK. The lite build uses Node's native
`fetch` for every provider, which keeps it well below 1 MB. Both require an installed
Node runtime; neither measurement hides an embedded standalone runtime. The release
tarball contains no production dependency declarations.

The deterministic suite exercises the complete selection loop without credentials.
A live Sonnet smoke test was not run in the build environment because provider
credentials were unavailable.

The terminal was also exercised at 80×24 for slash completion, model selection,
fixed-height rendering, session controls, persistent activity rows, the token bar,
workspace tool creation, and modal cancellation.

## Submission notes

I spent about three hours on specification review, implementation, tests, and
packaging.

The part I paid most attention to was proving that instructions are absent before
activation, rather than merely claiming they are loaded lazily. Resource-backed
skills also needed a narrow file boundary so `..`, absolute paths, and symlink escapes
cannot read outside the active skill. Workspace file tools use the same boundary and
do not expose an unrestricted shell. The lite and full builds use separate Claude
adapters so the React UI and SDK do not consume the headless size budget.

I kept the submission focused on the requested Node CLI, Sonnet, and Agent Skills
behavior. OpenRouter and Vercel AI Gateway are small provider adapters rather than a
plugin framework. I left out the marketplace, arbitrary plugin execution, and a
partial MCP client because they would distract from the code being assessed.

The bundled skills are pinned to their source commit; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
