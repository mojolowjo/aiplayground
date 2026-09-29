# aiplayground

A single repository that holds several unrelated projects. Each project lives in
its own folder under `projects/` and does not touch the others.

## Projects

| Folder | What it is | Status |
|---|---|---|
| [`projects/minecraft-optimization`](projects/minecraft-optimization/) | Cloudly, a performance mod for Minecraft: Java Edition, with its benchmark harness | Phase 1 done |

## Adding a new project

1. Create a new folder: `projects/<short-name-with-dashes>/`.
2. Put a `README.md` inside it that says what the project is.
3. Add a row to the table above.

Keep everything for a project inside its folder: code, docs, build files, and
its own `.gitignore` if it needs one. Nothing at the top level should belong to a
single project.

The one exception is automation: GitHub only reads workflows from
`.github/workflows/`. Give each project its own workflow file named after the project,
and limit it to that project's folder with a `paths:` filter, as
`minecraft-optimization.yml` does.

## How GitHub is organized here (short version)

- **Repository (repo):** this whole collection of files and its history.
- **Commit:** a saved snapshot of changes, with a message saying what changed.
- **Branch:** a separate line of commits. Work happens on a branch so it can be
  reviewed before it lands in the main line.
- **Pull request (PR):** a request to merge one branch into another. GitHub shows
  the changes side by side so you can read them before accepting.
- **Folders are the "sections".** Because each project has its own folder, work
  on one project never changes files belonging to another.
