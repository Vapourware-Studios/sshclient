# AGENTS.md — rules every AI agent working in this repo MUST follow

This repository is going **PUBLIC**. Everything committed here — files,
commit messages, commit metadata, history — is visible to the entire
internet, forever. These rules are absolute. When in doubt, don't commit.

## 1. Identity: GitHub usernames ONLY, never personal names

- **NO personal names anywhere.** No real first names, last names, or
  personal email addresses — not in code, comments, docs, examples, commit
  messages, or commit author fields. Nowhere.
- The only identities allowed are GitHub usernames and the org name:
  `Vapourware-Studios` (org), `chank-op`, `Mr_chank`, and any other
  contributor's GitHub username.
- **Every commit MUST be authored with the contributor's GitHub username and
  their GitHub-provided private noreply email**
  (`<id>+<username>@users.noreply.github.com`, found under GitHub Settings →
  Emails), never a real name or personal address. The repo-local git config
  pins this per contributor — never override it with a global or one-off
  identity, and verify with `git log --format='%an <%ae>'` after committing.

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

## 5. Styling: ONE stylesheet

- **All hand-written CSS lives in `src/renderer/index.css`** — theme
  tokens, `@keyframes`, animation utilities, everything. Never create
  another `.css` file, never write `<style>` blocks, and never import CSS
  from a `.js`/`.jsx` file. Third-party CSS (e.g. xterm's) is `@import`-ed
  from `index.css` too.
- Components are styled with Tailwind utility classes in JSX. Reach for
  custom CSS in `index.css` only for things utilities can't express
  (keyframes, gradients-as-text, etc.), and add it under the marked
  "Custom animations" section at the bottom of the file.
