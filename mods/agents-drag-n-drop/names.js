// What a pane is called, the same in its header and on the drop map: a named
// terminal (a sub-agent such as route-export) by its name, else an agent by its
// session's title ("Ship trip export"), else its program.
import { terminals } from "herdr";

// An agent's title as its program set it, without the status mark in front
// (Claude Code's "✳"), or null when it's only a path or the program's own name.
function sessionTitle(p) {
  if (!p.program?.agent) return null;
  const title = (p.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const plain = !title || title === p.program.name || title.toLowerCase() === p.program.key;
  return plain || /^[~/\\]|^[A-Za-z]:[\\/]/.test(title) ? null : title;
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
