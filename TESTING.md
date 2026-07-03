# Testing snapctx

Tests use Node's built-in `node:test` runner and isolate storage from your real home directory.

## Isolation strategy

Each test creates a temporary directory and sets both `HOME` and `USERPROFILE` to that path before calling storage functions or spawning the CLI. Snapshots therefore land in `<temp>/.snapctx/` instead of your actual `~/.snapctx/`.

CLI subprocess tests also set `NO_COLOR=1` so output assertions stay stable.

## Running tests

```bash
npm test
```

## Linting

```bash
npm run lint
npm run lint:fix
```

## Fixtures

- `test/fixtures/old-format.json` — snapshot saved before the `tags` field existed; used to verify backward compatibility.
