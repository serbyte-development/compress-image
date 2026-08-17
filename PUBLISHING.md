# Publishing Compress Image

Compress Image releases are orchestrated by the workspace `oss-release` tool. Publishing remains a hard manual gate: checks and dry runs are safe, but do not create the release tag or submit v0.1.0 to either registry without Austin's explicit approval immediately before the real publish command.

## Distribution targets

The same `0.1.0` extension identity is released to:

- GitHub Releases — durable source of the exact platform VSIX files.
- Visual Studio Marketplace — `serbytedevelopment.compress-images` for VS Code.
- Open VSX — `serbytedevelopment/compress-images` for Cursor and other Open VSX consumers.

v0.1.0 has no universal fallback package. It ships exactly five platform-specific VSIX files:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-x64`

## Exact artifact flow

`.oss-release.yaml` defines `release.yml` as the project's artifact workflow. When the release tag is pushed, that workflow builds, validates, packages, and uploads one GitHub Actions artifact for each supported platform. It does **not** create the GitHub Release itself.

`oss-release` then:

1. Waits for the tagged five-platform artifact workflow to succeed.
2. Downloads the exact five VSIX outputs.
3. Creates the GitHub Release with those VSIX files.
4. Publishes those same local files to Open VSX, one at a time.
5. Dispatches the trusted Marketplace workflow, which downloads the same VSIX files from the GitHub Release and publishes them one at a time with the `VSCE_PAT` GitHub Actions secret.
6. Verifies the configured registries after publishing.

No registry should independently rebuild the extension when artifact mode is configured.

## One-time account setup

### Visual Studio Marketplace

1. Confirm the publisher ID is `serbytedevelopment`.
2. Configure the organization-level `VSCE_PAT` GitHub Actions secret for repositories that publish extensions.
3. Keep the generated trusted workflow current with `oss-release setup`.

The release workflow uses stable `vsce` with `VSCE_PAT` until Marketplace OIDC publishing is available in production.

### Open VSX

1. Sign in with the Eclipse/Open VSX account and accept the publisher agreement if still required.
2. Confirm namespace `serbytedevelopment` exists and is controlled by Serbyte Development.
3. Put the Open VSX token in `OVSX_PAT` or the git-ignored `projects/oss-release/.secrets` file used by the workspace release tool.

Never commit or print the token.

## Before the real release

The release commit must already contain version `0.1.0`, be on `main`, have a clean working tree, and be pushed to the private/public destination repo as appropriate for the launch stage.

Run the ordinary extension validation first:

```sh
npm run package:vsix
```

Then exercise the release orchestrator without publishing:

```sh
/Users/austinserb/Desktop/agent-workspace/tools/oss-release/run check \
  --repo /Users/austinserb/Desktop/agent-workspace/projects/compress-image \
  --version 0.1.0

/Users/austinserb/Desktop/agent-workspace/tools/oss-release/run publish \
  --repo /Users/austinserb/Desktop/agent-workspace/projects/compress-image \
  --version 0.1.0 \
  --dry-run
```

The dry run should show one tag operation, a GitHub Release using collected `*.vsix` artifacts, Open VSX publishing from collected `*.vsix` artifacts, and a Marketplace trusted-workflow dispatch carrying `release_tag=v0.1.0` plus `vscode_artifact_names=<exact-vsix-names>`.

## Real release

Only after the final explicit publish approval:

```sh
/Users/austinserb/Desktop/agent-workspace/tools/oss-release/run publish \
  --repo /Users/austinserb/Desktop/agent-workspace/projects/compress-image \
  --version 0.1.0
```

Observe every stage. If any registry or workflow fails, stop and inspect the exact failure rather than blindly retrying or rebuilding different artifacts.

## Post-release checks

After both registries report the version live:

1. Confirm all intended platform packages are represented and there is no unqualified fallback VSIX.
2. Check the Marketplace/Open VSX icon, README screenshots, changelog, links, publisher, version, and install controls.
3. Install from a clean VS Code profile on a supported platform.
4. Confirm the Open VSX version appears in Cursor.
5. Uncomment the Marketplace/Open VSX badges in `README.md` only after the listings exist.

## v0.1.0 listing copy

**Name:** Compress Image

**Short description:** Lossless image compression + simple resizing in VS Code and Cursor.

**Primary promise:** Right-click an image to compress it in place or resize it to 256, 512, or 1080 px. No uploads, configuration, or quality sliders.

The full Marketplace body comes from `README.md`; release notes come from `CHANGELOG.md`.
