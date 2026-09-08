<p align="center">
  <a href="https://github.com/vapourware-studios/sshclient/releases"><img alt="release" src="https://shieldcn.dev/github/vapourware-studios/sshclient/release.svg?variant=ghost&amp;split=true" /></a>
  <a href="https://github.com/vapourware-studios/sshclient/issues"><img alt="issues" src="https://shieldcn.dev/github/vapourware-studios/sshclient/issues.svg" /></a>
  <a href="https://github.com/vapourware-studios/sshclient/graphs/contributors"><img alt="contributors" src="https://shieldcn.dev/github/vapourware-studios/sshclient/contributors.svg" /></a>
  <a href="https://github.com/vapourware-studios/sshclient"><img alt="license" src="https://shieldcn.dev/github/vapourware-studios/sshclient/license.svg?theme=green&amp;logo=github" /></a>
</p>

<p align="center">
  <img alt="badge" src="build/icon.png" />
</p>

## Overview

**SSH Client** is a fast, reliable and open source ssh client. It allows you to use **remote access clients**, store and generate **ssh keys**, save **command snippets**, **port forward** connections from your hosts and allow you to use inbuilt **SFTP**

## FREE FOREVER CLOUD SYNC

We provide a free forever **secure** cloud storage for all your **hosts**, **keys**, and **code snippets**.

If you dont trust us with our data. Well thats fair... that's why we open source our backend. You want to host it yourself, sure go for it!  

## SHARE A TERMINAL

Working on something with someone? Hit **Share** on any terminal tab — SSH, local shell or serial — and you get a link. Send it to whoever should see it. They open it, the app opens with them, and they're watching your terminal live.

They **watch only**. Nobody types in your shell until you hand them the keyboard, one person at a time, and you can take it back with one click. You see who is watching the whole time, and you can remove anyone.

It is sealed the same way everything else here is: the terminal is encrypted on your machine and the key lives inside the link itself, so the relay passes along bytes it cannot read. Two things to know before you send one:

- **The link is the key.** Anyone who opens it starts watching — nobody has to be approved first. Send it the way you'd send the shell.
- Both of you need to be on the same server, so a self-hosted setup shares within its own team.

## Why us?

Well why NOT? We are free, open source, we dont take your money. And if you dont like something, your wish is just a **PR** away!

## Getting started

- Install the app

Windows

[![downloads](https://shieldcn.dev/github/vapourware-studios/sshclient/downloads.svg?theme=green)](https://github.com/vapourware-studios/sshclient/releases)

Linux — grab the package your distro speaks from the same releases page:

| Format | Install |
| --- | --- |
| `.AppImage` | `chmod +x SSH*.AppImage && ./SSH*.AppImage` — updates itself in place |
| `.deb` (Debian/Ubuntu) | `sudo dpkg -i sshclient_*.deb` |
| `.rpm` (Fedora/RHEL) | `sudo rpm -i sshclient-*.rpm` |
| `.pacman` (Arch/Manjaro) | `sudo pacman -U sshclient-*.pacman` |

See **Staying up to date** below for how each of these upgrades itself.

Mac OS

```bash
brew install --cask vapourware-studios/tap/sshclient
```

or

[![downloads](https://shieldcn.dev/github/vapourware-studios/sshclient/downloads.svg?theme=green)](https://github.com/vapourware-studios/sshclient/releases)

- You are done!

## Staying up to date

The app checks GitHub for a new release when you unlock the vault, and every few
hours after that. You can also ask it yourself any time: **Settings → Updates**
shows the version you are on, which mechanism this particular install updates
through, the changelog for the newest release, and a **Check for updates**
button.

How the update is applied depends on how you installed it — the app works that
out for itself:

| Install | What "Update now" does |
| --- | --- |
| `.AppImage`, Windows installer | Downloads the new build and swaps it in, then offers a restart |
| Homebrew cask | Runs `brew upgrade` for you in the background, then offers a restart |
| AUR (`yay` / `paru` / `pamac`) | Opens an in-app terminal with the helper's upgrade command |
| `.deb` / `.rpm` / `.pacman` | Downloads the matching package and hands you the install command (asks for root) |
| Anything else | Opens the release page |

Nothing installs behind your back — every path starts with a prompt you agree
to and ends with a restart you agree to.

## Settings

Settings is split into its own sections, reachable from the rail on the left of
the Settings tab:

- **Account** — sign in, link devices, run a sync now
- **Appearance** — themes, custom CSS, and the macOS Liquid Glass material
- **Security & Privacy** — change the master password, blur host IPs for screen sharing
- **Import** — pull hosts and keys in from Termius
- **Updates** — the panel described above
- **About** — version, build, licence, feedback. There may or may not be something hidden in it.

## Contributing

Contributions are welcome — open an issue or PR and help make SSH Client better.

### Getting started

1. Fork the repo and clone your fork
2. Install dependencies: `npm install`
3. Run the app in dev mode: `npm run dev`
4. Create a branch for your change: `git checkout -b feat/my-change`

### Before you open a PR

- Keep changes focused — one feature or fix per PR
- Follow the existing code style
- Test that the app builds and runs: `npm run build`
- Reference any related issue in your PR description

### Reporting bugs

Found something broken? [Open an issue](https://github.com/Vapourware-Studios/sshclient/issues) with steps to reproduce, your OS, and the app version.

<p align="center">
  <a href="https://github.com/vapourware-studios/sshclient/graphs/contributors"><img alt="contributors" src="https://shieldcn.dev/contributors/vapourware-studios/sshclient.svg?title=Our+Contributors&amp;bots=true&amp;mode=dark" /></a>
</p>

## contact

feedback: please fill in the form in the settings tab of your application

contact us: [website](https://vapourware-studios.net/contact/) or email us at hello@vapourware-studios.net

## Roadmap

| Feature | Status |
|---|---|
| SSH terminal — multi-tab, xterm.js, scrollback | ![Done][done] |
| Dual-pane SFTP with drag-and-drop | ![Done][done] |
| Encrypted vault (scrypt + AES-256-GCM) | ![Done][done] |
| In-app key generation (RSA / ECDSA / Ed25519) | ![Done][done] |
| Local port forwarding (`-L`) | ![Done][done] |
| Serial terminal + session recording | ![Done][done] |
| Termius host/key import | ![Done][done] |
| Encrypted cross-device sync | ![Done][done] |
| In-app update checker (all platforms/formats) | ![Done][done] |
| Terminal sharing with handover of control | ![Done][done] |
| Remote & dynamic forwarding (`-R` / SOCKS) | ![In Progress][wip] |
| `known_hosts` import (UI stubbed) | ![In Progress][wip] |
| Intel (x64) Mac builds | ![In Progress][wip] |
| Hardware-tested Windows / Linux builds | ![In Progress][wip] |
| Code-signed & notarized builds | ![In Progress][wip] |
| OpenSSH `~/.ssh/config` + PuTTY import | ![Planned][plan] |
| ProxyJump / bastion chains | ![Planned][plan] |

<!-- status badges -->
[done]: https://shieldcn.dev/badge/Done-green.svg
[wip]:  https://shieldcn.dev/badge/In_Progress-yellow.svg
[plan]: https://shieldcn.dev/badge/Planned-blue.svg
[idea]: https://shieldcn.dev/badge/Idea-slate.svg?variant=outline
