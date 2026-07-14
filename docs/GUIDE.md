# snapctx Guide

## What snapctx actually is

snapctx is a small command-line tool that saves a snapshot of your terminal's current state: your working directory, git branch, environment variables, and recent shell command history (plus optional tags). Think of it as a bookmark for your terminal session. Instead of trying to remember where you were and what you'd just been doing, you save it once and look it up later.


## Why you'd actually want this

1. **You got pulled into a meeting and now it's tomorrow.** You were elbow-deep in a feature branch, running tests, with specific env vars set. snapctx lets you save that exact setup, switch to something urgent, and resume later without skipping a beat.

2. **You're juggling two or more client projects.** Each one needs a different set of environment exports, a different folder, a different git branch. Snapshots keep them separate so you don't accidentally run a command in the wrong project.

3. **You took Friday off and Monday feels like starting over.** Instead of retracing your steps to figure out where you left off, you load the snapshot you saved on Friday and get right back into the same context.

4. **You're debugging "wait, what branch was I even testing this on?"** Instead of scrolling through your terminal history or guessing, a saved snapshot tells you exactly which branch, directory, and environment setup you had at a given point.

## How the project is put together

snapctx is a single-purpose Node.js CLI tool with a clean separation of concerns:

```
snapctx/
├── bin/
│   └── snapctx.js          # The CLI entrypoint that actually talks to the user.
├── lib/
│   ├── storage.js          # Persists snapshot JSON files under ~/.snapctx.
│   ├── colors.js           # Minimal ANSI color helpers, respects NO_COLOR.
│   └── redaction.js       # Heuristic env var redaction + .snapctxignore support.
├── test/
│   ├── cli.test.js         # End-to-end tests that run the CLI as a subprocess.
│   ├── storage.test.js     # Unit tests for the storage/redaction modules.
│   ├── fixtures/
│   │   └── old-format.json # Snapshots saved before the tags field existed.
│   └── helpers/
│       ├── run-cli.js      # Spawns the CLI with a temp home directory and env vars.
│       └── temp-home.js    # Creates a throwaway directory to act as a fake home.
├── .github/workflows/ci.yml
├── eslint.config.js
├── .gitignore
├── LICENSE
└── package.json
```


- **`bin/snapctx.js`** — This is the only file that prints to your terminal. It handles all command-line arguments, formats the output, and exits with the right status codes. It holds the logic for collecting the current context, building a snapshot object, and running the various commands.


- **`lib/storage.js`** — This module only knows how to persist and retrieve snapshot files. It has no idea what a terminal or a git branch is. The separation means you can change how snapshots are stored (flat files in `~/.snapctx` right now) without touching any CLI code. It also makes the module easy to test without involving the terminal at all.

- **`lib/colors.js`** — A tiny utility for adding ANSI color codes. It respects the `NO_COLOR` environment variable to avoid emitting color when it shouldn't. Keeping it in its own file makes it trivial to swap out or disable globally.

- **`test/`** — Tests are split into CLI tests and storage unit tests. They use a **fake temporary home directory** instead of touching your real `~/.snapctx`. This means you can run `npm test` without worrying about deleting your actual snapshots. The `run-cli.js` helper sets `NO_COLOR=1` so output is predictable during assertions.

- **`.github/workflows/ci.yml`** — Runs `npm run lint` and `npm test` on every push and pull request, testing against Node.js versions 18, 20, and 22.

- **`eslint.config.js`** — Lints the JavaScript to catch obvious bugs and style issues.

- **`.gitignore`** — Keeps `node_modules/` and macOS `. directory files out of version control.

- **`LICENSE`** — MIT licensed.

- **`package.json`** — Declares the `snapctx` binary, test script, dependencies (just `commander`), and dev dependencies.

## Every command, with real output

### `save` — Save the current working context

Save a named snapshot of your current terminal state.

```bash
$ snapctx save my-feature -t backend -t urgent
Snapshot 'my-feature' saved.
```

By default, sensitive environment variables (e.g. `AWS_*`, `*_SECRET*`, `*_KEY*`) are **redacted** — their values are stored as `[REDACTED]` rather than written to disk in plain text. Use `--exclude <pattern>` to add ad-hoc exclusions or `.snapctxignore` for persistent patterns (one glob pattern per line, `#` for comments). Use `--no-redact` to disable redaction entirely:

```bash
$ snapctx save raw-session --no-redact
⚠ saving environment variables without redaction — this snapshot may contain secrets
Snapshot 'raw-session' saved.
```

When redaction is active, `save` prints a count of redacted variables.

### `load` — Load and display a saved snapshot

View everything stored in a snapshot. This does not change your shell environment; it just prints the details so you can recreate the state yourself.

```bash
$ snapctx load my-feature
Snapshot: my-feature
Saved: Jul 2, 2026, 10:30 AM
Directory: /Users/dev/project
Git branch: feature/auth
Environment variables: 42 saved (redacted)
Tags: backend, urgent
Recent commands:
  npm test
  git checkout -b feature/auth
  npm install

Tip: run `eval "$(snapctx restore my-feature)"` to apply this snapshot's cwd and env to your current shell.
```

If the snapshot was saved on a different branch than your current one, you'll see this additional warning at the end:

```bash
⚠ Branch mismatch: snapshot was on 'feature/auth', currently on 'main'
```

If the snapshot doesn't exist:

```bash
$ snapctx load missing
No snapshot named 'missing'.
```

### `restore` — Re-apply a snapshot to your live shell

Because a Node.js child process cannot change its parent shell's working directory or environment variables, `restore` works by **printing** a shell script to stdout that your shell then evaluates. Nothing is injected automatically — you control when and whether to run it.

**bash / zsh:**

```bash
eval "$(snapctx restore my-feature)"
```

**PowerShell:**

```powershell
snapctx restore my-feature | Invoke-Expression
```

Under the hood, `restore` generates `cd`/`Set-Location` and `export`/`$env:` lines with proper escaping to prevent command injection. All values are single-quoted with internal single quotes properly escaped, so characters like `$`, `` ` ``, `"`, and `;` are safe.

#### Partial restore

```bash
# Restore only the working directory, skip env vars
eval "$(snapctx restore my-feature --cwd-only)"

# Restore only environment variables, skip cwd
eval "$(snapctx restore my-feature --env-only)"
```

#### Shell override

By default `restore` auto-detects your shell from `$SHELL` or shell history files. You can override:

```bash
snapctx restore my-feature --shell bash
snapctx restore my-feature --shell zsh
snapctx restore my-feature --shell powershell
```

> [!NOTE]
> `cmd.exe` is not supported because its quoting rules make safe generation impractical. Use PowerShell (`--shell powershell`) on Windows.

#### Redaction and secrets

If the snapshot was saved with redaction active (the default), `restore` skips any redacted variables. If the snapshot was saved with `--no-redact`, a warning is printed to stderr so it doesn't corrupt the eval-able stdout:

```
⚠ this snapshot was saved without redaction and may contain secrets
```

### `list` — List all saved snapshots

```bash
$ snapctx list
my-feature [backend, urgent] — saved 3 hours ago
debug-session — saved 2 days ago
```

Filter by tag:

```bash
$ snapctx list --tag backend
my-feature [backend, urgent] — saved 3 hours ago
```

If there are no snapshots yet:

```bash
$ snapctx list
No snapshots saved yet.
```

### `delete` / `rm` — Delete a saved snapshot

```bash
$ snapctx delete my-feature
Snapshot 'my-feature' deleted.
```

`rm` is an alias for `delete`.

### `search` — Search snapshots by name, tag, cwd, or branch

```bash
$ snapctx search auth
my-feature [backend, urgent] — saved 3 hours ago
```

If nothing matches:

```bash
$ snapctx search does-not-exist
No snapshots match 'does-not-exist'.
```

### `diff` — Compare two snapshots

Compare two saved snapshots side by side. Works directory, git branch, environment variable keys, and recent command history. For privacy, only environment variable *keys* are compared, never actual values.

```bash
$ snapctx diff before after
Comparing 'before' vs 'after'

cwd: /Users/dev/project -> /Users/dev/project-v2
git branch: main -> feature/auth
1 env var added: DEBUG
1 env var changed: NODE_ENV
recent commands: differ (8 vs 10 entries)
```

If either snapshot is missing, the command exits with a clear error.

### `export` — Export a snapshot to a portable JSON file

```bash
$ snapctx export my-feature
Snapshot 'my-feature' exported to ./my-feature.snapctx.json.
```

Specify a custom output path:

```bash
$ snapctx export my-feature -o /tmp/handoff.snapctx.json
Snapshot 'my-feature' exported to /tmp/handoff.snapctx.json.
```

### `import` — Import a snapshot file into ~/.snapctx

```bash
$ snapctx import ./my-feature.snapctx.json --as shared-copy
Snapshot imported as 'shared-copy'.
```

If the target name already exists, the import will fail unless you add `--force`:

```bash
$ snapctx import ./my-feature.snapctx.json --as shared-copy --force
Snapshot imported as 'shared-copy'.
```

Malformed or incomplete snapshot files are rejected with a clear error listing the missing fields.

## Using snapctx across multiple projects

Snapshots live in a single shared folder at `~/.snapctx`. The CLI persists each snapshot as an individual JSON file there.

They are not tied to any single project directory. This is by design, but it means you need to name your snapshots carefully or they will collide.


### Naming snapshots so they don't collide

Prefix the snapshot name with the project or client:

```bash
snapctx save acme-auth-fix -t acme
snapctx save client-b-onboarding -t client-b -t urgent
```

This keeps your snapshots globally unique and makes them easy to find later.

### Grouping snapshots with tags

Tags are project-agnostic and work across any directory. Use them to group related snapshots:

```bash
snapctx save acme-db-mig -t acme -t backend
snapctx save acme-stripe-fix -t acme -t frontend -t urgent
snapctx save personal-blog-rework -t personal -t side-project
```

Then filter when you only want to see one project's snapshots:

```bash
$ snapctx list --tag acme
acme-auth-fix [acme] — saved 2 hours ago
acme-db-mig [acme, backend] — saved 1 day ago
acme-stripe-fix [acme, frontend, urgent] — saved 3 days ago
```

### A realistic multi-project walkthrough

You're working on three things today:

1. A backend API for a client (`acme`)
2. A frontend bug for a different client (`globo`)
3. Your own side project (`personal`)

Before jumping to each one, save your current snapshot with a project prefix, work on the other thing, and come back later:

```bash
# On the acme feature branch
snapctx save acme-oauth-fix -t acme

# Urgent request comes in for Globo
cd ~/work/globo-app
snapctx save globo-before-urgent -t globo
# Do the urgent work...

# Come back to acme work
snapctx load acme-oauth-fix
Snapshot: acme-oauth-fix
Saved: Jul 2, 2026, 10:30 AM
Directory: /Users/dev/work/acme-api
Git branch: feature/oauth-scope-fix
...

# End of day, save everything
snapctx save globo-before-urgent -t globo --force
snapctx save personal-idea-2 -t personal -t weekend
```

When you come back after the weekend, you don't need to remember which folder or branch anything was in. Just search:

```bash
$ snapctx search acme
acme-auth-fix [acme] — saved 2 hours ago
acme-oauth-fix [acme] — saved 3 days ago

$ snapctx list --tag personal
personal-idea-2 [personal, weekend] — saved 4 days ago
```
Because everything lives in one place, you can switch between projects quickly without worrying about where each snapshot belongs.

## Fitting it into your actual workflow

Save before switching contexts. Before you `git checkout` to investigate a bug or jump to a different task, snap your current state:

```bash
snapctx save feature-x-in-progress -t myproject -t before-hotfix
```

Before you run an experiment you might abandon. If you're about to try a risky upgrade or a large refactor, save first so you can compare the environment before and after if things go sideways:

```bash
snapctx save before-dependency-upgrade -t myproject
# Run the upgrade...
snapctx diff before-dependency-upgrade current-state
```

Use `diff` before resuming old work. If a snapshot is a few days old, diff it against the current state to spot environment drift (e.g., someone added a new env var to `.env` since you last touched this branch):

```bash
snapctx diff last-week-ticket-123 current-context
```

Save before a long weekend, load on Monday. It sounds obvious, but it's the difference between a five-minute ramp and an hour of retracing your steps.

## Quick reference

| Command | What it does | Example |
| ------- | ------------ | ------- |
| `save <name>` | Save current context snapshot | `snapctx save fix-422 -t backend` |
| `save --no-redact` | Disable env var redaction | `snapctx save raw --no-redact` |
| `save --exclude <pat>` | Exclude env vars matching a pattern | `snapctx save debug --exclude DEBUG_*` |
| `load <name>` | Display a saved snapshot | `snapctx load fix-422` |
| `restore <name>` | Print eval-able shell script to re-apply snapshot | `eval "$(snapctx restore fix-422)"` |
| `restore --cwd-only` | Restore only the working directory | `snapctx restore fix-422 --cwd-only` |
| `restore --env-only` | Restore only environment variables | `snapctx restore fix-422 --env-only` |
| `restore --shell <s>` | Force a specific shell syntax | `snapctx restore fix-422 --shell powershell` |
| `list` | List all saved snapshots | `snapctx list` |
| `list --tag <tag>` | List snapshots with a specific tag | `snapctx list --tag urgent` |
| `delete <name>` | Delete a saved snapshot | `snapctx delete fix-422` |
| `rm <name>` | Alias for `delete` | `snapctx rm fix-422` |
| `search <query>` | Search by name, tag, cwd, or branch | `snapctx search auth` |
| `diff <a> <b>` | Compare two snapshots | `snapctx diff before after` |
| `export <name>` | Export a snapshot to JSON | `snapctx export fix-422` |
| `export -o <path>` | Export to a custom path | `snapctx export fix-422 -o /tmp/out.json` |
| `import <file>` | Import a snapshot JSON file | `snapctx import ./fix-422.snapctx.json --as copy` |
| `import --force` | Overwrite an existing snapshot on import | `snapctx import ./fix-422.snapctx.json --as copy --force` |
