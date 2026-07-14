# snapctx

![CI](https://github.com/YashPalav-26/snapctx/actions/workflows/ci.yml/badge.svg)

snapctx is a CLI that snapshots your current developer working context — working directory, environment variables, git branch, recent shell history, and optional tags — to a local JSON file. You can search, compare, export, import, and reload snapshots later to see what you were doing when you saved.

See the [full guide](docs/GUIDE.md) for a deeper walkthrough of how snapctx works and how to use it across multiple projects.

Snapshots are stored in `~/.snapctx/` as individual JSON files.

## Install

```bash
npm install
npm link
```

Alternatively, install globally from this directory:

```bash
npm install -g .
```

## Usage

### Save a snapshot

```bash
$ snapctx save my-feature -t backend -t urgent
Snapshot 'my-feature' saved.
```

### List snapshots

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

If you have no snapshots yet:

```bash
$ snapctx list
No snapshots saved yet.
```

### Load a snapshot

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
⚠ Branch mismatch: snapshot was on 'feature/auth', currently on 'main'
Tip: run `eval "$(snapctx restore my-feature)"` to apply this snapshot's cwd and env to your current shell.
```

If the snapshot does not exist:

```bash
$ snapctx load missing
No snapshot named 'missing'.
```

The environment variable set is stored in the JSON file under `~/.snapctx/` (with sensitive keys redacted by default) even though `load` only prints a count.

### Restore a snapshot into your shell

Because a Node.js child process cannot change its parent shell's working directory or environment variables, `restore` works by **printing** a shell script to stdout that your shell then evaluates. Nothing is injected automatically — you control when and whether to run it.

#### bash / zsh

```bash
eval "$(snapctx restore my-feature)"
```

#### PowerShell

```powershell
snapctx restore my-feature | Invoke-Expression
```

#### What the generated script looks like before eval

```bash
# bash/zsh output (safe to inspect before running)
cd '/Users/dev/project'
export NODE_ENV='production'
export PORT='3000'
export SAFE_VAR='hello world'
```

```powershell
# PowerShell output
Set-Location -LiteralPath 'C:\Users\dev\project'
$env:NODE_ENV = 'production'
$env:PORT = '3000'
$env:SAFE_VAR = 'hello world'
```

All values are single-quoted with internal single quotes properly escaped, so characters like `$`, `` ` ``, `"`, and `;` cannot inject commands into the evaluated output.

#### Partial restore

```bash
# Restore only the working directory, skip env vars
eval "$(snapctx restore my-feature --cwd-only)"

# Restore only environment variables, skip cwd
eval "$(snapctx restore my-feature --env-only)"
```

#### Shell override

```bash
# Force a specific shell syntax (auto-detected by default)
snapctx restore my-feature --shell bash
snapctx restore my-feature --shell zsh
snapctx restore my-feature --shell powershell
```

> [!NOTE]
> `cmd.exe` is not supported because its quoting rules make safe generation impractical. Use PowerShell (`--shell powershell`) on Windows.

#### Redaction and secrets

If the snapshot was saved with redaction active (the default), `restore` will not output any redacted variables — they were never stored to begin with. If the snapshot was saved with `--no-redact`, a warning is printed to stderr:

```
⚠ this snapshot was saved without redaction and may contain secrets
```

The warning goes to stderr so it doesn't corrupt the eval-able stdout stream.

#### Optional shell alias (set up yourself)

Power users can add a convenience alias to their shell config. This is **not installed automatically** — add it yourself if you want it:

```bash
# In ~/.bashrc or ~/.zshrc
alias snaprestore='eval "$(snapctx restore)"'

# Usage: snaprestore my-feature
```

```powershell
# In $PROFILE (PowerShell)
function snaprestore { snapctx restore $args | Invoke-Expression }
```

### Environment Variable Redaction

To prevent sensitive keys (like AWS access credentials or database passwords sitting in your shell environment) from being written to plaintext files on disk, `snapctx` redacts sensitive values by default. Redacted variables are stored as `[REDACTED]` rather than completely removed, ensuring that `diff` can still track whether those variables are present.

#### Default Denylist
By default, `snapctx` matches variable names case-insensitively against common patterns, including:
- Secrets, tokens, and passwords (`*_SECRET*`, `*_KEY*`, `*_TOKEN*`, `*PASSWORD*`, `*_PASS*`)
- Cloud provider & database credentials (`AWS_*`, `*_CREDENTIALS*`)
- API keys, private keys, and access keys (`*API_KEY*`, `*PRIVATE_KEY*`, `*ACCESS_KEY*`)

#### Custom Ignore Patterns (`.snapctxignore`)
You can add custom patterns to exclude other environment variables. `snapctx` reads ignore patterns from:
1. `~/.snapctx/.snapctxignore` (global user defaults)
2. `./.snapctxignore` (project-specific overrides)

Both lists are merged if both exist. The file format is one wildcard glob-style pattern per line (e.g. `MY_APP_*`), with `#` indicating comments:

```text
# Exclude my application runtime configs
MY_APP_CONF_*
STAGING_DB_*
```

#### CLI Exclusions and Opt-out
- Use `--exclude <pattern>` to add one-off exclusions:
  ```bash
  $ snapctx save debug-session --exclude DEBUG_LOGS
  Snapshot 'debug-session' saved.
  Redacted 3 environment variables (use --no-redact to disable).
  ```
- Use `--no-redact` to disable redaction entirely. This prints a visible security warning to ensure it's not run by mistake:
  ```bash
  $ snapctx save raw-session --no-redact
  ⚠ saving environment variables without redaction — this snapshot may contain secrets
  Snapshot 'raw-session' saved.
  ```

> [!NOTE]
> Environment variable redaction is a best-effort heuristic and does not guarantee complete security. Always handle highly sensitive secrets with care.

### Delete a snapshot

```bash
$ snapctx delete my-feature
Snapshot 'my-feature' deleted.
```

`rm` is an alias for `delete`.

### Search snapshots

```bash
$ snapctx search auth
my-feature [backend, urgent] — saved 3 hours ago
```

If nothing matches:

```bash
$ snapctx search missing-term
No snapshots match 'missing-term'.
```

### Compare two snapshots

```bash
$ snapctx diff before after
Comparing 'before' vs 'after'

cwd: /Users/dev/project -> /Users/dev/project-v2
git branch: main -> feature/auth
1 env var added: DEBUG
1 env var changed: NODE_ENV
recent commands: differ (8 vs 10 entries)
```

For privacy, `diff` reports env var key names only — never values.

### Export a snapshot

```bash
$ snapctx export my-feature
Snapshot 'my-feature' exported to ./my-feature.snapctx.json.
```

Custom output path:

```bash
$ snapctx export my-feature -o /tmp/handoff.snapctx.json
Snapshot 'my-feature' exported to /tmp/handoff.snapctx.json.
```

### Import a snapshot

```bash
$ snapctx import ./my-feature.snapctx.json --as shared-copy
Snapshot imported as 'shared-copy'.
```

If the target name already exists, import fails unless you pass `--force`:

```bash
$ snapctx import ./my-feature.snapctx.json --as shared-copy --force
Snapshot imported as 'shared-copy'.
```

Malformed files are rejected with a clear missing-fields error.

## Development

```bash
npm test
npm run lint
```

See [TESTING.md](TESTING.md) for details on test isolation.
