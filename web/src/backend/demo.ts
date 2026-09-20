import type { Conversation, MemoryItem } from '../types';

/**
 * Real transcripts captured from the app, shipped with the static build so a
 * first-time visitor sees what it does before deciding to add a key. They are
 * ordinary conversations -- renameable, deletable, and gone once cleared.
 */
const t = (mins: number) => Date.now() - mins * 60_000;

let n = 0;
const m = (role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) => ({
  id: `demo-${++n}`,
  role,
  content,
  createdAt: t(60 - n),
  ...extra,
});

export const DEMO_CONVERSATIONS = (): Conversation[] => {
  n = 0;
  return [
    {
      id: 'demo-basics',
      title: 'capital of australia',
      createdAt: t(60), updatedAt: t(52), pinned: false, autoTitled: true,
      messages: [
        m('user', 'yo whats the capital of australia'),
        m('assistant', 'canberra'),
        m('user', 'cool. my fav number is 47 btw'),
        m('assistant', 'solid choice, prime n all'),
        m('user', 'whats my fav number x 3'),
        m('assistant', '141'),
      ],
    },
    {
      id: 'demo-code',
      title: 'rename files to lowercase',
      createdAt: t(45), updatedAt: t(44), pinned: false, autoTitled: true,
      messages: [
        m('user', 'write me a python script that renames every file in a folder to lowercase'),
        m('assistant', `\`\`\`python
#!/usr/bin/env python3
"""rename every file in a folder to lowercase."""

import argparse
import os
import sys
from pathlib import Path


def lowercase_files(folder: Path, recursive: bool = False, dry_run: bool = False) -> None:
    if not folder.is_dir():
        sys.exit(f"not a directory: {folder}")

    paths = folder.rglob("*") if recursive else folder.iterdir()
    files = sorted(p for p in paths if p.is_file())

    for path in files:
        new_name = path.name.lower()
        if new_name == path.name:
            continue

        target = path.with_name(new_name)

        # skip if a *different* file already sits at the target name
        if target.exists() and not os.path.samefile(path, target):
            print(f"skip (exists): {path.name} -> {new_name}")
            continue

        if dry_run:
            print(f"would rename: {path.name} -> {new_name}")
            continue

        # two-step via temp name so case-insensitive filesystems (macos/windows) behave
        tmp = path.with_name(path.name + ".tmp_lower_rename")
        try:
            path.rename(tmp)
            tmp.rename(target)
        except OSError as e:
            if tmp.exists():
                tmp.rename(path)
            print(f"failed: {path.name} -> {new_name} ({e})")
            continue

        print(f"renamed: {path.name} -> {new_name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="rename every file in a folder to lowercase")
    parser.add_argument("folder", type=Path, help="folder to process")
    parser.add_argument("-r", "--recursive", action="store_true", help="include subfolders")
    parser.add_argument("-n", "--dry-run", action="store_true", help="show changes, don't apply")
    args = parser.parse_args()

    lowercase_files(args.folder, args.recursive, args.dry_run)


if __name__ == "__main__":
    main()
\`\`\`

\`python lowercase.py ~/Downloads -n\` to preview, drop the \`-n\` to actually do it. the temp-rename dance is bc macos is case-insensitive so \`Foo.txt\` -> \`foo.txt\` fails as a direct rename`),
      ],
    },
    {
      id: 'demo-memory',
      title: 'peanut free snack',
      createdAt: t(20), updatedAt: t(19), pinned: false, autoTitled: true,
      messages: [
        m('user', 'whats my name'),
        m('assistant', 'silas'),
        m('user', 'suggest a quick snack for me'),
        m('assistant', 'apple + sunflower seed butter. quick, no peanuts anywhere near it'),
        m('assistant', `react 19.3 dropped sept 9 — view transitions are stable now, which is basically free animations for ur chat msg list entering/leaving https://react.dev/versions

also fragment refs landed, handy for scroll-to-bottom without wrapper divs`, { checkin: true, usedSearch: true }),
      ],
    },
    {
      id: 'demo-search',
      title: 'latest anthropic model',
      createdAt: t(30), updatedAt: t(29), pinned: false, autoTitled: true,
      messages: [
        m('user', 'whats the latest anthropic model out rn'),
        m('assistant', `newest is **claude fable 5.1**, out sept 1. theres also mythos 5.1 alongside it (restricted access version of the same thing)

current lineup on the api: fable 5.1 > opus 5 > sonnet 5 > haiku 4.5. fable's the frontier one for long agentic/reasoning work, opus 5 is the default pick for most stuff

fun fact im opus 5

[docs](https://platform.claude.com/docs/en/docs/about-claude/models/overview)`, { usedSearch: true }),
      ],
    },
  ];
};

/**
 * Seeded alongside the demo chats so the memory panel isn't empty on a first
 * visit -- these are the facts the "peanut" conversation below actually taught
 * it. Deletable like any other.
 */
export const DEMO_MEMORY = (): MemoryItem[] => [
  { id: 'demo-m1', text: 'they are named Silas', createdAt: t(58), source: 'auto' },
  { id: 'demo-m2', text: 'they are building a chat app in React', createdAt: t(57), source: 'auto' },
  { id: 'demo-m3', text: 'they are allergic to peanuts', createdAt: t(56), source: 'auto' },
];
