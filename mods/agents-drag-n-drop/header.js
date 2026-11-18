// A pane's header: { "tab": "active", "pane": { "header": { "content": { "mod": "agents-drag-n-drop" } } } }
// Adapted from Herdr's shipped pane header. Shows the program's icon, the pane's
// name, its folder and the agent's status; buttons split, zoom and close it.
// Props from the app: { pane, terminal }. Click: focus the pane.
// Changed here: a named terminal (a sub-agent such as route-export) goes by its name
// and what it's working on, else an agent by its session's title; a sub-agent's pane always shows Detach,
// which sends it back under its agent still running (terminal.park), since
// closing the pane ends it.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, terminals } from "herdr";
import { paneName, taskOf } from "./names.js";

const ICONS = "mods/agents-drag-n-drop/icons";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter((child) => !child.hidden);
    children = [visible.find((child) => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export class PaneHeader {
  init() {
    this.hovered = false;
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, name, onClick, tooltip) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick();
      })
      .child(svg(`${ICONS}/${name}.svg`).size(14));
  }

  render() {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const term = p.terminal ? terminals().find((k) => k.address === p.terminal) : null;
    const name = paneName(p, term);
    // A named sub-agent's name is often a reference (pr-12): its task follows.
    const task = taskOf(term);
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    // A sub-agent: its terminal was started by another one.
    const sub = term?.parent;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, (el) => el.border_t(1))
      .when(!bottom, (el) => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .when(Boolean(task), (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(task)))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", (el) =>
        el.child(svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900)),
      )
      .when(st === "blocked", (el) =>
        el.child(
          div()
            .flex_none()
            .px(6)
            .h(18)
            .flex()
            .items_center()
            .rounded(5)
            .bg(t.blocked + "26")
            .text_size(10.5)
            .font_semibold()
            .text_color(t.blocked)
            .child("Needs you"),
        ),
      )
      .when(st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, (el) =>
        el
          .child(this.button(t, `ph-r-${pane}`, "split-right", () => run("pane.split", { direction: "right", pane })))
          .child(this.button(t, `ph-d-${pane}`, "split-down", () => run("pane.split", { direction: "down", pane })))
          .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", () => run("pane.zoom", { pane })))
          .child(this.button(t, `ph-x-${pane}`, "close", () => run("pane.close", { pane }))),
      )
      // Always shown, and last: hovering adds the other buttons to its left, so it
      // never moves and a close button never appears where it was.
      .when(Boolean(sub), (el) =>
        el.child(
          this.button(
            t,
            `ph-detach-${pane}`,
            "detach",
            () => run("terminal.park", { terminal: p.terminal }),
            "Detach: back to the agents list, still running",
          ),
        ),
      );
  }
}
