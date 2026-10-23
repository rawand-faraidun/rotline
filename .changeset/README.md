# Changesets

Every change worth a release note gets a changeset: run `pnpm changeset`, pick the bump (patch, minor or major) and write one or two lines for the changelog. All `@rotline/*` packages share one version, which is the game's version.

When changesets reach `main` (and CI passes), the Version workflow does the rest on its own: it bumps the version and writes the changelogs in a "Version packages" commit on `main` (merged back into `dev`), tags it `vX.Y.Z`, publishes the images and the GitHub release, and deploys that version to the server. A push to `main` without changesets is deployed as it is, under its commit.
