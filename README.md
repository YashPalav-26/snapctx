# snapctx

snapctx is a CLI that snapshots your current developer working context — working directory, environment variables, git branch, and recent shell history — to a local JSON file. You can list saved snapshots and reload them later to see what you were doing when you saved.

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
$ snapctx save my-feature
Snapshot 'my-feature' saved.
```

### List snapshots

```bash
$ snapctx list
my-feature    3 hours ago
debug-session 2 days ago
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
Recent commands:
  npm test
  git checkout -b feature/auth
  npm install
  ...
⚠ Branch mismatch: snapshot was on 'feature/auth', currently on 'main'
```

If the snapshot does not exist:

```bash
$ snapctx load missing
No snapshot named 'missing'.
```

The full environment variable set is stored in the JSON file under `~/.snapctx/` even though `load` only prints a count.
