# mini-agent

A small Claude-powered command-line agent that implements the core
[Agent Skills](https://agentskills.io/) lifecycle: discover, disclose, select, and
load.

The important behavior is progressive disclosure. Claude initially sees only each
skill's name and description. When a prompt matches, Claude calls `activate_skill`
and receives the full instructions. Referenced files are loaded separately and only
from inside the active skill directory.

## Try it

Requirements: Node.js 20.11 or newer and an Anthropic API key.

```bash
npm install
export ANTHROPIC_API_KEY="your-key"
npm run dev -- "I'm new to this project, what should I do?"
```

Running `npm run dev` without a prompt opens the React/Ink terminal interface.

There is also a deterministic demo that does not call an API:

```bash
npm run demo:mock
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

The default model is `claude-sonnet-5`; override it with `--model` or
`MINI_AGENT_MODEL`.

## How it is put together

```text
CLI or Ink UI
      │
  agent loop ─── Anthropic provider
      │
  skill catalog
      ├── activate_skill
      └── read_skill_resource
```

```text
.skills/                 bundled assessment skills
src/agent/               model and tool loop
src/providers/           official SDK and lightweight API adapters
src/skills/              discovery, validation, activation, resources
src/ui/                  React/Ink interface
tests/                   behavior at the public seams
scripts/                 build, size, and release checks
```

Skill discovery checks bundled skills, `~/.agents/skills`, `.agents/skills`, and the
assignment's `.skills` directory. Project skills take precedence. Invalid skills are
reported by `skills doctor` instead of breaking the session.

The production agent relies on Sonnet's judgment to choose a skill from its
description. The `--mock` option uses a tiny deterministic fixture solely so the
demo and tests work without credentials.

## Verification

```bash
npm run check
npm run pack:release
```

`npm run check` runs the type checker, thirteen behavior tests, both builds, and byte
budgets. The current arm64 macOS build measures:

| Artifact | Size |
| --- | ---: |
| Lite, headless CLI | 129,054 bytes |
| Full CLI, React UI, skills, and notices | 1,014,404 bytes |
| Compressed release tarball | 364 KB |

The full build uses the official Anthropic SDK. The lite build uses the same provider
interface with Node's native `fetch`, which puts it well below 1 MB. Both require
an installed Node runtime; neither measurement hides an embedded standalone runtime.
The release tarball contains no production dependency declarations.

The deterministic suite exercises the complete selection loop without credentials.
A live Sonnet smoke test was not run in the build environment because no
`ANTHROPIC_API_KEY` was available.

## Submission notes

I spent about three hours on specification review, implementation, tests, and
packaging.

The part I paid most attention to was proving that instructions are absent before
activation, rather than merely claiming they are loaded lazily. Resource-backed
skills also needed a narrow file boundary so `..`, absolute paths, and symlink escapes
cannot read outside the active skill. The lite and full builds use separate Claude
adapters so the React UI and SDK do not consume the headless size budget.

I kept the submission focused on the requested Node CLI, Sonnet, and Agent Skills
behavior. The provider boundary can accept another implementation later. I left out
the marketplace, arbitrary plugin execution, and a partial MCP client because they
would distract from the code being assessed.

The bundled skills are pinned to their source commit; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
