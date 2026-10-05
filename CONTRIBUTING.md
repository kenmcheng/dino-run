# Contributing

Thanks for your interest in Dino Run! This project is maintained largely by
automated agents with a single human maintainer, so the process below exists
to keep review fast and predictable for everyone.

## Running it locally

```bash
npm ci
npm start            # http://<host>:8090
./test.sh             # simulation tests plus a server integration test
```

Node >= 20 is required to run the project; CI runs on Node 22.

## Before you open a PR

- Add or update tests for any behaviour change.
- `./test.sh` passes locally.
- `bash .github/scripts/no-local-refs.sh` passes locally.

### Sign off every commit (DCO)

Every commit must carry a `Signed-off-by:` trailer certifying the
[Developer Certificate of Origin](https://developercertificate.org/). Add it
with:

```bash
git commit -s -m "..."
```

If you forgot on an existing commit:

```bash
git commit --amend -s --no-edit     # most recent commit
git rebase --signoff main           # every commit on the branch
```

### PR size

One concern per PR. Aim for at most 15 changed files and 400 changed lines.
Larger PRs, and any PR touching `.github/`, `.forgejo/`, build scripts,
`package.json`/`package-lock.json`, or the `Dockerfile`, are queued for the
maintainer and are not auto-reviewed.

### Review

An automated reviewer looks at every PR first. It may approve the change or
ask for changes — address feedback by pushing more commits to the same
branch. Workflow runs for first-time contributors need maintainer approval
before they execute.

## Questions and security

Questions and ideas go to [Discussions](https://github.com/kenmcheng/dino-run/discussions).
Security issues are never filed as a public issue — see [SECURITY.md](SECURITY.md).
