# BTCA CLI + Server Smoke Test

Small pre-deploy gut check for `btca` CLI + server changes.

## 1. Quick repo checks

Run these from the repo root:

```bash
bun install
bun run check:cli
bun run check:server
bun run format:all
```

Optional if the server logic changed in a meaningful way:

```bash
bun run test:server
```

## 2. Start the local server

Terminal A:

```bash
bun run apps/cli/src/index.ts serve --port 8080
```

Terminal B:

```bash
export SERVER_URL=http://127.0.0.1:8080
export SMOKE_RESOURCE="smoke-local-$(date +%s)"
```

Expected: Terminal A prints `btca server running at http://localhost:8080`.

## 3. Basic health + status

```bash
curl -sS "$SERVER_URL/"
bun run apps/cli/src/index.ts --server "$SERVER_URL" status
bun run apps/cli/src/index.ts resources --server "$SERVER_URL"
```

Look for:

- health JSON includes `"ok":true`
- `status` prints provider, model, auth state, and version info
- `resources` succeeds even if it prints `No resources configured.`

## 4. Resource lifecycle

Use the repo itself as a disposable local resource:

```bash
bun run apps/cli/src/index.ts add . --name "$SMOKE_RESOURCE" --type local --server "$SERVER_URL"
bun run apps/cli/src/index.ts resources --server "$SERVER_URL"
```

Look for:

- add succeeds without weird prompts/errors
- the new resource shows up as `(local)` and points at this repo

## 5. Happy path ask

CLI path:

```bash
bun run apps/cli/src/index.ts ask --server "$SERVER_URL" -r "$SMOKE_RESOURCE" -q "What is the root package name in package.json?"
```

Raw server path:

```bash
curl -sS \
  -X POST "$SERVER_URL/question" \
  -H 'content-type: application/json' \
  -d "{\"question\":\"What is the root package name in package.json?\",\"resources\":[\"$SMOKE_RESOURCE\"]}"
```

Look for:

- both commands succeed
- the answer is grounded in the repo
- the response is sensible for this question, ideally mentioning `@btca/repo`

If `status` showed `Selected provider authed: no`, fix auth/config before treating ask failures as a release blocker.

## 6. Failure-path gut checks

Unknown command should be clean and helpful:

```bash
bun run apps/cli/src/index.ts remoev
```

Missing required flags should fail cleanly:

```bash
bun run apps/cli/src/index.ts ask --server "$SERVER_URL"
```

Missing resource should preserve a useful server error and hint:

```bash
bun run apps/cli/src/index.ts ask --server "$SERVER_URL" -r definitely-missing-resource -q "hello"
```

Bad server request should return structured JSON:

```bash
curl -sS \
  -X POST "$SERVER_URL/question" \
  -H 'content-type: application/json' \
  -d '{"question":""}'
```

Look for:

- no stack traces or Effect internals leaking to the terminal
- CLI errors are readable and actionable
- server errors come back as JSON with `error` and `tag`

## 7. Cleanup

```bash
bun run apps/cli/src/index.ts remove "$SMOKE_RESOURCE" --server "$SERVER_URL"
bun run apps/cli/src/index.ts resources --server "$SERVER_URL"
```

Then stop Terminal A with `Ctrl+C`.

## 8. Ship / no-ship read

Good enough to ship:

- server starts cleanly
- `status`, `resources`, `add`, and `ask` all work
- one intentional CLI failure and one intentional server failure both produce good messages

Pause before deploy:

- health or status is flaky
- resource add/remove behaves differently than expected
- ask fails after auth is confirmed
- error output is confusing, noisy, or missing hints
