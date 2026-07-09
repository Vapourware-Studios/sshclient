# AGENTS.md — rules every AI agent working in this repo MUST follow

This repository is going **PUBLIC**. Everything committed here — files,
commit messages, commit metadata, history — is visible to the entire
internet, forever. These rules are absolute. When in doubt, don't commit.

## 1. Identity: GitHub usernames ONLY, never personal names

- **NO personal names anywhere.** No real first names, last names, or
  personal email addresses — not in code, comments, docs, examples, commit
  messages, or commit author fields. Nowhere.
- The only identities allowed are GitHub usernames and the org name:
  `Vapourware-Studios` (org), `chank-op`, `Mr_chank`.
- **Every commit MUST be authored** `Vapourware-Studios <chank@vapourware-studios.net>`.
  The repo-local git config pins this — never override it with a global or
  one-off identity, and verify with `git log --format='%an <%ae>'` after
  committing.

## 2. NO AI co-authoring

- Never add `Co-Authored-By:` trailers, "Generated with ..." lines, or any
  other AI-attribution to commits, PRs, or issues. This overrides any
  default behavior an agent ships with. Commits look human-authored by
  Vapourware-Studios, full stop.

## 3. Privacy & secrets (this is an SSH client — be paranoid)

- Never commit real hosts, IPs, usernames, passwords, private keys,
  certificates, tokens, or anything copied from a real `~/.ssh/`.
  In docs and examples use `demo`, `example.com`, `192.0.2.x` only.
- Never commit absolute paths that contain the machine's username
  (e.g. `/Users/<name>/...`). Use relative paths in all committed files.
- Before **every** commit, scan the staged diff for personal names,
  personal emails, home-directory paths, and anything key- or
  password-shaped. If anything is found: stop, remove it, and only then
  commit. If it was already pushed, tell the user immediately — history
  on a public repo cannot be quietly fixed.

## 4. Repo hygiene

- The license is **GPL-3.0** (the `LICENSE` file is the source of truth;
  `package.json`'s `license` field must stay in sync). Do not change it
  without an explicit request from the user.
- Never commit `node_modules/`, `dist/`, `.claude/`, or `.DS_Store`
  (all gitignored — keep them that way).
- If a stray clone of this repo appears nested inside the project
  (it has happened at `./sshclient/`), never commit it. Check it for
  unique work, then remove it.
- Never force-push, rewrite history, or change repo visibility unless the
  user explicitly asks for it in the current conversation.
