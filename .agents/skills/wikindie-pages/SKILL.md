---
name: wikindie-pages
description: >-
  Creates and moves Wikindie pages as Markdown files under SPACE_DIR, including
  leaf pages, index pages, nesting, and stable page ids. Use when adding,
  nesting, renaming, or moving a wiki page, _Index.md, page frontmatter, or
  Markdown files in the workspace.
---

# Wikindie pages on disk

Write pages as Markdown under `SPACE_DIR`. A page the app will list and open has the shape below.

## Page id

The only frontmatter a new page needs is its id:

```yaml
---
id: pg_0123456789abcdef0123456789abcdef
---
```

Build it as `pg_` plus 32 lowercase hex digits: `crypto.randomUUID()` with the dashes removed. The pattern is `^pg_[a-f0-9]{32}$`.

- Write the id yourself so the page is addressable before the app touches the file.
- A missing id is filled in on the first tree or page read, and the file is rewritten. You do not know the id until that happens.
- A short, uppercase, or otherwise invalid id is discarded on that read and replaced.
- Keep the id when the file moves. Attachments live at `.wikindie/attachments/<id>/` and follow the id. The API rejects an id change. A hand edit that swaps one valid id for another is stored as-is and leaves the old attachment directory behind.
- Two pages with the same id both appear in the tree, and lookup by id fails with a conflict. A copy needs a new id.

The first read may reorder frontmatter and insert a blank line. Leave that rewrite in place.

`title` is optional. The sidebar uses it when set, and otherwise the last path segment. A heading in the body is the body, not the title.

Other frontmatter the app reads: `icon` (an emoji, or a legacy name such as `project`), `order` (a number; lower values come first, then title), `hidden: true` (omitted from the tree, still opened by path). `_AGENT.md` is always hidden. Set `kanban: true` only on a board.

Frontmatter is valid YAML at the top of the file. Broken YAML is not metadata: the page still appears under its filename, and a later read can prepend a new id and leave the broken block in the body.

## Leaf and index

The page path is the slash path without `.md` and without a trailing `/_Index`.

| Kind | File | Page path |
| --- | --- | --- |
| Leaf | `Notes.md` | `Notes` |
| Index | `Guide/_Index.md` | `Guide` |

The index filename is exactly `_Index.md`. A directory without that file is not a page. On a case-insensitive disk the wrong case is the same file and also shows up as an extra child, so use this spelling.

There is no page for the space root. Do not put `_Index.md` at the root of `SPACE_DIR`.

A leaf with no children:

```markdown
---
id: pg_0123456789abcdef0123456789abcdef
title: Notes
---

# Notes

Body.
```

An index is the same file, stored at `Guide/_Index.md`. Its children are siblings of `_Index.md`.

## Nesting

A directory is a parent only when it contains `_Index.md`. Without that file, its Markdown children are lifted to the nearest real parent, often the space root, and the directory path itself does not open.

`Loose/Orphan.md` is the page `Loose/Orphan`. `Loose` is not a page, and the tree does not nest Orphan under it.

Every ancestor that should appear as a parent has its own index:

```text
Guide/_Index.md
Guide/Start.md
Guide/Deep/_Index.md
Guide/Deep/Topic.md
```

`Guide/Start` is a leaf. `Guide/Deep` is an index because it has a child.

Keep one storage file per page. `Page.md` and `Page/_Index.md` together produce two tree nodes with the same path; opening the path loads the index.

To add the first child under a leaf, convert the leaf, then write the child. The rename keeps the parent's bytes and id:

```bash
mkdir Parent
mv Parent.md Parent/_Index.md
```

Then write `Parent/Child.md` with a new id. A child written while `Parent.md` still exists is not nested under Parent.

## Sections

Sections are not pages. Reference them from the page that owns them:

```yaml
sections:
  - title: Notes
    path: _sections/notes.md
```

The section path is relative to the page path. The `_sections` directory is skipped by the tree.

- On an index, the file is inside the page directory: `Guide/_sections/notes.md`.
- On a leaf, it is a sibling of the page file: `Sectioned.md` next to `Sectioned/_sections/notes.md`.

## Move

The id stays. The path changes. A relative link inside a directory that moves as a whole still points at the same files. Update a link when the file it names is renamed, or when it reaches into or out of the moved page. Leave `.wikindie/attachments/<id>/` where it is.

Stay inside `SPACE_DIR`. A path that escapes it is rejected.

- Leaf with no sibling directory: rename the file. `Notes.md` can become `Renamed.md`, or `Guide/Notes.md` when `Guide/_Index.md` already exists.
- Leaf with a section directory: move the file and that directory together, to the same new stem. Renaming only `Sectioned.md` leaves `Sectioned/_sections/` behind, and the next read creates empty section files at the new path.
- Index: rename the whole directory. Children and sections move with it. Renaming only `_Index.md` turns the folder into a non-page, flattens its children, and makes the old index a leaf.
- The new parent is an existing index page, or the space root. A missing parent is not a page. Convert a leaf parent before moving a page under it.
- The destination path is free. Do not move a page into its own descendant.
- Do not copy a page file. Mint a new id when a second page is required.

Spaces in a segment are fine: `My Notes.md` is the page `My Notes`.

## Check

The tree lists the page under its index ancestors. Opening the page path returns the same id, `index: false` for a leaf and `index: true` for an index, and the path without `.md` or `/_Index`.
