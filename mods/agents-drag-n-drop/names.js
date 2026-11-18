// What a pane is called, the same in its header and on the drop map: a named
// terminal (a sub-agent such as route-export) by its name, else an agent by its
// session's title ("Ship trip export"), else its program. A named agent also says
// what it's working on: its session's title, shown after its name.
import { terminals } from "herdr";

// An agent's title as its program set it, without the status mark in front
// (Claude Code's "✳"), or null when it's only a path or the program's own name.
// `p`: a pane from panes() or a terminal from terminals(); both carry title and program.
function sessionTitle(p) {
  if (!p.program?.agent) return null;
  // A path is a folder, not a title: look past the mark but keep a leading ~ or /.
  const path = (p.title ?? "").replace(/^[^\p{L}\p{N}~/\\]+/u, "");
  if (/^[~/\\]|^[A-Za-z]:[\\/]/.test(path)) return null;
  const title = (p.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const plain = !title || title === p.program.name || title.toLowerCase() === p.program.key;
  return plain ? null : title;
}

// Letters and digits only, lower case: "PR-12:" and "pr-12" are the same reference.
const key = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// What a named agent is working on: its session's title, after any reference its
// name already gives. pr-12 titled "PR-12: Retry failed uploads" is working on
// "Retry failed uploads"; so is one titled "M2.pr-12 Retry failed uploads". Null
// when nobody named it, or its title is only its name, a path or its program.
export function taskOf(term) {
  if (!term?.name) return null;
  const title = sessionTitle(term);
  if (!title) return null;
  const name = key(term.name);
  const words = title.split(/\s+/);
  // The name, or a reference ending in it (it has a digit), in the first two words;
  // the words before it are references too.
  const at = words
    .slice(0, 2)
    .findIndex((w) => key(w) === name || (/\d/.test(w) && name && key(w).endsWith(name)));
  const from = at >= 0 && words.slice(0, at).every((w) => /\d/.test(w)) ? at + 1 : 0;
  const task = words.slice(from).join(" ").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return task && key(task) !== name ? task : null;
}

// `term`: the pane's terminal from terminals(), when the caller has it already.
export function paneName(p, term = p.terminal ? terminals().find((k) => k.address === p.terminal) : null) {
  return (
    term?.name ||
    sessionTitle(p) ||
    ((p.program?.agent || p.program?.shell) && p.program.name) ||
    p.title ||
    p.program?.name ||
    "shell"
  );
}
