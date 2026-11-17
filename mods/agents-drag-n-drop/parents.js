// Which main space each space belongs to, for the agents list's "Grouped by main
// space": the open space whose checkout is the repository's main one, else the
// repository's folder name. Herdr's spaces carry no repository, so this asks Git,
// read-only (`git rev-parse`), one folder at a time, only when the list asks.
import { exec, spaces, panes } from "herdr";

// A space's checkout is its first terminal's live folder, as Herdr names spaces.
function spaceFolder(space, paneList) {
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  return paneList.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

export class SpaceParents {
  constructor() {
    this.value = {}; // space id -> { key, label }
    this.busy = false;
  }

  read(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const paneList = panes();
        const found = [];
        for (const space of spaces()) {
          const folder = spaceFolder(space, paneList);
          if (!folder) continue;
          let result;
          try {
            result = await exec(
              "git",
              ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"],
              { cwd: folder, on: space.machine ?? undefined, timeout: 5000 },
            );
          } catch {
            continue; // the machine is away or Git is missing: no group for it
          }
          if (result.code !== 0) continue;
          const [common, top] = result.stdout.trim().split(/\r?\n/);
          if (!common || !top) continue;
          found.push({
            space,
            key: JSON.stringify([space.machine ?? null, common]),
            main: common === `${top}/.git`,
            folder: common.replace(/\/\.git\/?$/, "").replace(/\.git$/, "").split("/").pop(),
          });
        }
        const value = {};
        for (const f of found) {
          const main = found.find((g) => g.key === f.key && g.main);
          value[f.space.id] = { key: f.key, label: main?.space.name || f.folder };
        }
        this.value = value;
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }
}
