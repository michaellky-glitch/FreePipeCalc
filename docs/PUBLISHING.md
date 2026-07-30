# Publishing FreePipeCalc to GitHub

Written for someone who has not published a repository before. **Nothing here is
irreversible except making the repository public** — and the plan below keeps it
private until you decide otherwise.

---

## What GitHub actually is, in one paragraph

Git is a program on your machine that records snapshots ("commits") of a folder.
GitHub is a website that hosts a copy of those snapshots. Publishing means:
commit locally, create a repository on github.com, then push your commits to it.
The code stays on your machine either way — GitHub is a mirror, not a move. A
**private** repository is visible only to you until you change that.

---

## The one thing to settle BEFORE the first push

**Your email address is inside every commit.** Git records an author name and
email on each one, and that metadata is permanent — it is part of what makes the
commit that commit. When a repository goes public, so does every address in its
history, and GitHub cannot scrub it retroactively.

Fixing it before anything is pushed is one local rewrite. Fixing it afterwards
means rewriting history that other people may already have cloned.

GitHub gives you a free alias for exactly this. On the website:
**Settings → Emails → Keep my email addresses private**. You are then shown an
address of the form:

```
1234567+yourusername@users.noreply.github.com
```

Commits made with it still link to your GitHub account; your real address never
appears.

### Rewriting the commits that already exist

This project's history was committed with a personal address. To replace it
across all commits — safe here because there is a single branch, linear history,
no tags, and nothing has been pushed:

```bash
cd ~/Documents/FreePipeCalc

NEW_NAME="Your Name"
NEW_EMAIL="1234567+yourusername@users.noreply.github.com"

git filter-branch -f --env-filter "
  export GIT_AUTHOR_NAME='$NEW_NAME'
  export GIT_AUTHOR_EMAIL='$NEW_EMAIL'
  export GIT_COMMITTER_NAME='$NEW_NAME'
  export GIT_COMMITTER_EMAIL='$NEW_EMAIL'
" -- --all

git log --format='%an <%ae>' | sort -u     # verify: one line, the new address

# discard the backup filter-branch leaves behind
rm -rf .git/refs/original
git reflog expire --expire=now --all && git gc --prune=now
```

`filter-branch` prints a warning about "a glut of gotchas". Those concern merge
commits, tags, and history that has already been shared — this repository has
none of them.

Then set the identity for future commits:

```bash
git config --global user.name  "Your Name"
git config --global user.email "1234567+yourusername@users.noreply.github.com"
```

Until now this project's commits were made by passing the identity per-commit,
because no global identity was set on this machine.

---

## Step by step

### 1. Make a GitHub account

github.com → Sign up. Note your **username** — it becomes part of every URL.
Turn on two-factor authentication while you are there.

### 2. Install the GitHub CLI

On CachyOS / Arch:

```bash
sudo pacman -S github-cli
```

### 3. Log in, once

```bash
gh auth login
```

Answer **GitHub.com** → **HTTPS** → **Login with a web browser**. It shows a
one-time code, opens your browser, and you approve. That stores a credential so
git never asks for a password again. (The older route — a Personal Access Token
pasted in as a password — is fiddlier and easy to get wrong.)

### 4. Check what is about to be uploaded

```bash
cd ~/Documents/FreePipeCalc
git status              # must say "working tree clean"
git ls-files            # the exact list of files that will be uploaded
```

Worth the ten seconds. `.gitignore` already excludes `Previous Version/`,
`.claude/` and editor noise. As of v0.7.0-dev that is 53 files, no credentials,
nothing large.

### 5. Create the private repository and push

One command creates the repo, adds the remote, and uploads:

```bash
gh repo create FreePipeCalc --private --source=. --remote=origin --push
```

* `--private` — only you can see it.
* `--source=.` — build it from this folder rather than making an empty repo.
* `--push` — upload the commits now.

Do **not** create the repository on the website first with a README or licence
ticked. That gives the GitHub side a commit your local history does not share,
and the first push is rejected with a confusing error. `--source` avoids it.

### 6. Confirm

```bash
gh repo view --web
```

You should see the files, the history, and a **Private** badge.

---

## Working with it from then on

```bash
git status                     # what changed
git add -A                     # stage everything
git commit -m "What changed and why"
git push                       # send it to GitHub
```

Plain `git push` works after the first one, because `--push` set the upstream.

**Read `git status` and `git diff` before committing.** This project has one
specific trap: `test/testrun-*.js` are *generators*, not tests — running one
rewrites files in `examples/`. That has already caused one bad commit; see
`KNOWN-ISSUES.md`.

---

## When you are ready to go public

Check first:

* `LICENSE.txt` carries the right name. **Done** — Lew Kwong Yick (Michael).
* The commit history carries the address you want public (see above).
* `docs/Human-Test.md` is honest about what has and has not been verified. It
  currently records many ⬜. That is a feature, not an embarrassment: this is a
  calculation tool, and saying plainly what is unchecked is what makes it
  trustworthy.
* The README says results must be verified by a qualified engineer. It does.

Then either:

```bash
gh repo edit --visibility public --accept-visibility-change-consequences
```

or on the website: **Settings → General → Danger Zone → Change visibility**.

You can switch back to private, but anything cloned or forked while it was
public stays out there. Treat it as a one-way door in practice.

### Optional: `master` → `main`

This repository's branch is `master`; GitHub's default for new repositories is
`main`. Nothing breaks either way. To rename:

```bash
git branch -m master main
git push -u origin main
gh repo edit --default-branch main
git push origin --delete master
```

### Optional: tag a release

A tag is a permanent name for one commit, and GitHub turns tags into a Releases
page people can download from. Engineers generally prefer a numbered release
over "whatever was on main that day", and it makes a printed calculation
traceable to a specific version.

```bash
git tag -a v0.7.0 -m "FreePipeCalc v0.7.0"
git push origin v0.7.0
```

### Optional: GitHub Pages

The app is static files with no build step, so **Settings → Pages → deploy from
main** gives a live URL where anyone can run it without downloading. The
offline-from-disk design keeps working exactly as before; this is an addition.
Note that Pages is public even if the repository is private.

---

## Things that trip people up

**"Support for password authentication was removed."** You are being asked for a
Personal Access Token, not your account password. `gh auth login` avoids this.

**"Updates were rejected because the remote contains work that you do not have
locally."** The GitHub side has a commit you do not — usually a README added at
creation time. `git pull --rebase origin main`, then push again.

**A file you did not want is already committed.** Deleting it in a later commit
leaves it in the history; it has to be rewritten out. That is why step 4 exists.

**None of this is urgent.** A private repository with the work safely in it is
already the main win — it is a backup and a record. Public can wait until the
verification `Human-Test.md` asks for has actually been done.
