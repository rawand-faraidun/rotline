# Changesets

Every change worth a release note gets a changeset: run `pnpm changeset`, pick the bump (patch, minor or major) and write one or two lines for the changelog. All `@rotline/*` packages share one version, which is the game's version.

When changesets reach `main`, a "Version packages" pull request collects them. Merging it bumps the version, writes the changelogs, tags the commit `vX.Y.Z` and runs the release workflow.
