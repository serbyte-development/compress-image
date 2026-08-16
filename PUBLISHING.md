# Publishing Compress Image

Public release is a manual gate. Build and validation can be automated, but do not publish a Marketplace/Open VSX version until the release commit and all five platform packages have passed CI.

## Distribution targets

Publish the same version and extension identity to both registries:

- Visual Studio Marketplace: `serbytedevelopment.compress-image` for VS Code.
- Open VSX: namespace `serbytedevelopment`, extension `compress-image`. Cursor uses an Open VSX-backed extension gallery, so this is the distribution path for Cursor.

v0.1.0 ships five platform-specific VSIX packages:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-x64`

Do not publish an unqualified fallback VSIX. Unsupported platforms should remain unsupported instead of receiving a package with incompatible native binaries.

## One-time account setup

### Visual Studio Marketplace

1. Create or confirm a Visual Studio Marketplace publisher whose immutable ID is `serbytedevelopment`.
2. Authorize the publishing identity for that publisher.
3. For an initial manual release, a Marketplace PAT with `Marketplace (Manage)` can be used by `vsce`. Microsoft is retiring global Azure DevOps PATs on December 1, 2026, so move automated publishing to Microsoft Entra ID before relying on long-lived automation.

### Open VSX

1. Create an Eclipse account and link it to the GitHub account used for Open VSX.
2. Sign the Open VSX Publisher Agreement.
3. Generate an Open VSX access token.
4. Create the namespace once, if it does not already exist:

```sh
npx ovsx create-namespace serbytedevelopment -p "$OVSX_PAT"
```

5. Claim namespace ownership separately if the publisher should show as verified.

## Release flow

1. Confirm `package.json` contains the intended version.
2. Commit the release state on `main`.
3. Push `main` and wait for the full five-platform CI matrix to pass.
4. Create and push the matching version tag, for example `v0.1.0`.
5. The release workflow builds and audits all five target-specific VSIX packages and attaches them to a GitHub Release.
6. Download the five VSIX files from that release.
7. Publish every target-specific VSIX to the Visual Studio Marketplace.
8. Publish the same five VSIX files to Open VSX.
9. Verify the listing, screenshots, README, changelog, icon, supported platforms, and install behavior from a clean VS Code profile.
10. Verify the Open VSX listing and then confirm the extension appears in Cursor. Cursor synchronization can lag behind Open VSX publication.
11. Once both listings are live, uncomment the Marketplace/Open VSX badges near the top of `README.md` and ship that as the next repository-only documentation change or next patch release.

## Publishing commands

Authenticate without writing tokens into the repository or shell history. Then publish each package explicitly so there is no accidental generic package.

Visual Studio Marketplace:

```sh
npx vsce publish --packagePath compress-image-darwin-arm64-0.1.0.vsix
npx vsce publish --packagePath compress-image-darwin-x64-0.1.0.vsix
npx vsce publish --packagePath compress-image-linux-arm64-0.1.0.vsix
npx vsce publish --packagePath compress-image-linux-x64-0.1.0.vsix
npx vsce publish --packagePath compress-image-win32-x64-0.1.0.vsix
```

Open VSX:

```sh
npx ovsx publish compress-image-darwin-arm64-0.1.0.vsix -p "$OVSX_PAT"
npx ovsx publish compress-image-darwin-x64-0.1.0.vsix -p "$OVSX_PAT"
npx ovsx publish compress-image-linux-arm64-0.1.0.vsix -p "$OVSX_PAT"
npx ovsx publish compress-image-linux-x64-0.1.0.vsix -p "$OVSX_PAT"
npx ovsx publish compress-image-win32-x64-0.1.0.vsix -p "$OVSX_PAT"
```

## v0.1.0 listing copy

**Name:** Compress Image

**Short description:** Lossless image compression + simple resizing in VS Code and Cursor.

**Primary promise:** Right-click an image to compress it in place or resize it to 256, 512, or 1080 px. No uploads, configuration, or quality sliders.

The full Marketplace body comes from `README.md`; release notes come from `CHANGELOG.md`.
