# `.forgejo/`

This directory is the **pre-cutover CI** for the self-hosted Forgejo mirror
of this repository. It is removed, or retired, at the GitHub cutover.
`.github/workflows/ci.yml` is the CI of record on GitHub.

Its board-reporting jobs (`ship`, `report-verdict`) need a secret and an
Actions variable configured on the Forgejo instance that hosts this mirror.
Nothing in this tree names that instance; the jobs read it from the
environment at run time.
