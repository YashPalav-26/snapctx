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
Environment variables: 42 saved
Tags: backend, urgent
Recent commands:
  npm test
  git checkout -b feature/auth
  npm install
⚠ Branch mismatch: snapshot was on 'feature/auth', currently on 'main'
```

If the snapshot does not exist:

```bash
$ snapctx load missing
No snapshot named 'missing'.
```

The full environment variable set is stored in the JSON file under `~/.snapctx/` even though `load` only prints a count.

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
