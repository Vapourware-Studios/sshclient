# Linux package repository design

Status: the repository exists at
[`Vapourware-Studios/linux-packages`](https://github.com/Vapourware-Studios/linux-packages)
and the release workflow publishes to it. Nothing has been signed and served
yet: that needs the signing key and GitHub Pages. This file is the design
record; the user-facing instructions live in that repository's README.

It is a separate public distribution repository, following the separation used
by the Homebrew tap. Application source, feature tests, and binary builds stay
in `Vapourware-Studios/sshclient`.

The repository contains:

- Signed APT metadata for Ubuntu/Debian.
- A signed pacman repository for Arch/Manjaro.
- Signed RPM packages and repository metadata for Fedora/openSUSE.
- The public signing key and package-manager setup instructions.
- Automation that imports a completed application release, verifies its
  checksums, signs packages/metadata, and publishes the repository.

Private signing keys belong in GitHub Actions secrets, never in Git history.
Publish package indexes over HTTPS and keep versioned binary assets in GitHub
Releases. A GitHub Pages deployment can serve the indexes without changing the
project's product website. Each repository must use native metadata and
signatures validated by its package manager; do not disable signature checks.

After a one-time signing-key/repository setup, installation would use:

| Distribution | Proposed command after setup |
| --- | --- |
| Arch/Manjaro | `sudo pacman -Syu sshclient` |
| Ubuntu/Debian | `sudo apt install sshclient` |
| Fedora | `sudo dnf install sshclient` |
| openSUSE | `sudo zypper install sshclient` |

Normal system upgrades would then update SSH Client. The application updater
must recognize repository-managed installations and use that repository's
upgrade path. AUR submission can be added separately for users who prefer an
AUR helper, but it does not automatically add the app to Arch's official
repositories.

Official distribution inclusion is a separate submission and review process.
Alpine's `apk` requires a native musl-compatible build and tests against Alpine's
Electron package; the current glibc release files cannot establish that support.

Before publication, validate repository install, upgrade, uninstall, signatures,
desktop launch, and protocol handling in clean instances of each supported
distribution, then run the Linux feature smoke suite. Do not advertise universal
Linux support based solely on package generation or the Arch development machine.
