# Publishing FreePipeCalc to GitHub

Written for someone who has not published a repository before. Nothing here is
irreversible except making the repository public, and even that can be undone.

---

## What GitHub actually is, in one paragraph

Git is a program on your machine that records snapshots ("commits") of a
folder. GitHub is a website that hosts a copy of those snapshots so other
people can see and download them. Publishing means: commit locally, create an
empty repository on github.com, then push your commits to it. The code stays on
your machine either way — GitHub is a mirror, not a move.

---

## Before you push: three decisions

### 1. Your name on the licence

`LICENSE.txt` currently reads `Copyright (c) 2026 Michael`. The MIT licence is
what delivers the "no liability" requirement, and it should carry the name you
want attached to it — your full name, a company name, or a GitHub handle. This
is a legal-ish text; it should be your choice, not a placeholder.

### 2. The repository name

The app is **FreePipeCalc**. The folder on disk is `Friction_Drop`, from before
the rename. The GitHub repository name is what appears in the URL
(`github.com/<you>/<name>`) and does not have to match the folder, but matching
avoids confusion later.

### 3. Whether `Previous Version/` goes public

It holds a full copy of the v0.2.0-dev build (204 KB). Once the project is in
git, history serves that purpose better — every old version is recoverable from
any commit. Keeping the folder is harmless but it is the kind of thing that
confuses a newcomer ("which one do I run?").

---

## Step by step

### 1. Set your git identity (once per machine)

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

The email becomes part of every commit and is public. If you would rather not
publish a personal address, GitHub can give you a `@users.noreply.github.com`
one — see Settings → Emails on the website — and you use that here instead.

### 2. Make the first commit

```bash
cd ~/Documents/Friction_Drop
git add .
git status          # read this — it lists exactly what will be committed
git commit -m "FreePipeCalc v0.3.0-dev — initial public release"
```

`git status` before committing is worth the ten seconds. It is the last point
at which something unintended is easy to leave out.

### 3. Create the repository on github.com

On the website: **New repository**. Then:

* Name: whatever you chose above.
* Description: something like *"Piping friction loss calculator for building
  services engineers. Runs offline from a single folder."*
* **Public**.
* **Do not** tick "Add a README", "Add .gitignore" or "Choose a licence" —
  you already have all three, and letting GitHub create them causes a conflict
  on the first push that is annoying to untangle.

### 4. Connect and push

GitHub will show you the exact commands. They will look like:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

It will ask for authentication. GitHub no longer accepts account passwords
here — use a **Personal Access Token** (Settings → Developer settings →
Personal access tokens → Fine-grained tokens, with "Contents: read and write"
on this repository) and paste that as the password. Alternatively install the
GitHub CLI (`gh`) and run `gh auth login`, which handles it for you.

### 5. Check it looks right

Open the repository page. The README renders as the front page, so that is what
most visitors will read. Confirm the licence is detected (GitHub shows "MIT"
in the sidebar) and that no file is there that you did not intend.

---

## Making it easy for people to use

Right now, downloading means clicking **Code → Download ZIP**, unzipping, and
opening `index.html`. That works, and it suits the "no install" design.

Two optional improvements, in order of value:

**Releases.** Tag a version and GitHub produces a permanent, citable ZIP:

```bash
git tag -a v0.3.0 -m "FreePipeCalc v0.3.0"
git push origin v0.3.0
```

Then on the website: Releases → Draft a new release → pick the tag. Engineers
downloading a calculation tool generally prefer a numbered release over
"whatever was on main that day", and it makes a printed calculation traceable
to a specific version.

**GitHub Pages.** Because the app is static files with no build step, Settings
→ Pages → deploy from `main` gives you a live URL where anyone can run it
without downloading anything. The offline-from-disk design still works exactly
as before; this is an addition, not a replacement.

---

## A note on liability

The MIT licence's warranty disclaimer is the thing doing the legal work, and it
only functions if it stays attached. It is already in `LICENSE.txt`, and the
disclaimer line is repeated on every calculation sheet, CSV export and printed
plan. Keep both.

Publishing does not increase your exposure relative to handing someone a ZIP —
if anything it decreases it, because the licence and the disclaimer travel with
the code automatically.

---

## Things you will probably want later

* **Issues** — on by default. This is where users report bugs; it is also a
  perfectly good private to-do list.
* **A CHANGELOG** — worth starting once other people are using it, so they can
  tell what changed between the version they have and the current one.
* **CONTRIBUTING notes** — only needed if people start sending patches. The
  three constraints in `docs/ARCHITECTURE.md` §2 are what a contributor most
  needs to know, since breaking any of them breaks the whole design.
