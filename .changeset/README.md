# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets) and tracks pending version bumps for the `@anby/*` SDK packages.

## Adding a changeset

When you make a change to any package under `packages/*`, run:

```bash
npm run changeset
```

The CLI will ask which packages changed, what kind of bump (patch/minor/major), and a short summary. It writes a markdown file in this folder. Commit it together with your code changes.

## Releasing

A push to `main` triggers `.github/workflows/release.yml`, which:

1. If pending changesets exist → opens (or updates) a "Version Packages" PR that bumps versions and updates CHANGELOGs.
2. When that PR is merged → publishes the new versions to npm under the `@anby` scope.

The four packages are **linked**, meaning they version and publish together.
