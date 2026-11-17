// The drop map: put a sub-agent's terminal beside a pane of the shown tab.
//
// The agents list opens it as a popup (drag a sub-agent row, or click its place
// button) with props {view: "drop", terminal, name}. Herdr tells a mod how many
// panes a tab has but not where they are, so the map draws the tab's panes as
// cards: the card edge nearest the pointer is where the sub-agent lands,
// previewed as the split it will make. Releasing or clicking places it.
//
// Placing: focus the target pane, `terminal.keep` the sub-agent right of or
// below it, then `pane.swap` the two for left or above.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, panes, terminals, focused, theme, run, closeOverlay } from "herdr";
import { paneName } from "./names.js";

const WHERE = { left: "left of", right: "right of", up: "above", down: "below" };

// The edge of a w×h card nearest (x, y): the card is cut along its diagonals.
function nearestEdge(x, y, w, h) {
  const gap = { left: x / w, right: 1 - x / w, up: y / h, down: 1 - y / h };
  return Object.keys(gap).reduce((a, b) => (gap[b] < gap[a] ? b : a));
}

function edgeOf(event) {
  const pos = event.local_position;
  const b = event.bounds;
  return pos && b && b.width > 0 && b.height > 0 ? nearestEdge(pos.x, pos.y, b.width, b.height) : null;
}

// A program's icon, as the agents list draws it: a one-color glyph or a picture.
function icon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(size).flex_none().text_color(color)
    : image(program.icon).w(size).h(size).flex_none();
}

const folderName = (cwd) => (cwd ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();

function button(t, id, label, onClick) {
  return h_flex()
    .id(id)
    .h(28)
    .px(12)
    .flex_none()
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(t.border)
    .text_size(12)
    .text_color(t.foreground)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onClick(cx))
    .child(label);
}

export class DropMap {
  init() {
    this.target = null; // { pane, edge } under the pointer
    this.placing = false;
  }

  address() {
    return props()?.terminal ?? null;
  }

  // The sub-agent's own pane, once it has one.
  ownPane() {
    const address = this.address();
    return address ? panes().find((p) => p.terminal === address) : undefined;
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  aim(pane, event, cx) {
    const edge = edgeOf(event);
    if (!edge || (this.target?.pane === pane && this.target.edge === edge)) return;
    this.target = { pane, edge };
    cx.notify();
  }

  place(pane, edge, cx) {
    const address = this.address();
    if (this.placing || !edge || !address || this.ownPane()) return;
    this.placing = true;
    cx.notify();
    run("pane.focus", { pane });
    run("terminal.keep", { terminal: address, place: edge === "left" || edge === "right" ? "right" : "down" });
    cx.spawn(async (cx) => {
      // keep can wait for the core's reply: the pane shows up then.
      let mine;
      for (let i = 0; i < 100 && !mine; i++) {
        mine = this.ownPane();
        if (!mine) await cx.sleep(50);
      }
      if (mine && (edge === "left" || edge === "up")) run("pane.swap", { pane: mine.pane, target: pane });
      if (mine) run("pane.focus", { pane: mine.pane });
      this.dismiss();
    });
  }

  asTab(cx) {
    const address = this.address();
    if (this.placing || !address) return;
    this.placing = true;
    cx.notify();
    run("terminal.keep", { terminal: address });
    this.dismiss();
  }

  render() {
    const t = theme();
    const address = this.address();
    const sub = terminals().find((k) => k.address === address);
    const name = props()?.name || sub?.name || address || "sub-agent";
    const tab = focused()?.tab;
    const list = panes().filter((p) => p.tab === tab);
    const own = this.ownPane();
    const target = this.target && list.find((p) => p.pane === this.target.pane);
    const gone = Boolean(address) && !sub;
    const disabled = this.placing || Boolean(own) || gone || !address;

    const hint = this.placing
      ? "Placing…"
      : gone
        ? `${name} has ended.`
        : own
          ? `${name} already has a pane.`
          : target
            ? `${name} goes ${WHERE[this.target.edge]} ${paneName(target)}.`
            : list.length
              ? "Drop it on the edge of a pane where it should go."
              : "No tab is shown.";

    // A popup sizes to its content, so the map sets its own size.
    return v_flex()
      .id("drop-map")
      .w(520)
      .p(14)
      .gap(10)
      .text_size(13)
      .text_color(t.foreground)
      .on_hover((on, cx) => {
        if (!on && this.target) {
          this.target = null;
          cx.notify();
        }
      })
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(icon(sub?.program, 16, t.foreground) ?? div())
          .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(`Place ${name}`))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(div().h(18).truncate().text_color(t.muted).child(hint))
      .child(this.map(t, list, name, disabled))
      .child(
        h_flex()
          .gap(10)
          .items_center()
          .child(
            div()
              .flex_1()
              .min_w(0)
              .text_size(11.5)
              .text_color(t.dim)
              .child("Move it later with the grip at the top of a pane."),
          )
          .when(Boolean(own), (el) =>
            el.child(
              button(t, "go-to", "Go to it", () => {
                run("pane.focus", { pane: own.pane });
                this.dismiss();
              }),
            ),
          )
          .when(!disabled, (el) => el.child(button(t, "as-tab", "Open as a tab", (cx) => this.asTab(cx)))),
      );
  }

  // The shown tab's panes, as cards in a grid: not their real arrangement,
  // which mods can't see, but each card is the pane it names.
  map(t, list, name, disabled) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const rows = [];
    for (let i = 0; i < list.length; i += cols) rows.push(list.slice(i, i + cols));
    return v_flex()
      .id("map")
      .h(250)
      .flex_none()
      .p(8)
      .gap(8)
      .rounded(8)
      .bg(t.canvas)
      .children(
        rows.map((row, r) =>
          h_flex()
            .id(`map-row-${r}`)
            .flex_1()
            .min_h(0)
            .gap(8)
            .children(row.map((p) => this.card(t, p, name, disabled))),
        ),
      );
  }

  card(t, p, name, disabled) {
    const edge = !disabled && this.target?.pane === p.pane ? this.target.edge : null;
    const face = this.face(t, p, Boolean(edge));
    return v_flex()
      .id(`card-${p.pane}`)
      .flex_1()
      .self_stretch()
      .min_w(0)
      .min_h(0)
      .rounded(8)
      .border_1()
      .border_color(p.focused ? t.accent : t.border)
      .bg(t.background)
      .overflow_hidden()
      .when(!disabled, (el) =>
        el
          .cursor_pointer()
          .on_mouse_move((e, cx) => this.aim(p.pane, e, cx))
          // Only after the pointer has moved over this card: the map opens under a
          // dragging pointer, and an instant release there must not place anything.
          .on_mouse_up("left", (e, cx) => {
            if (this.target?.pane !== p.pane) return;
            this.place(p.pane, edgeOf(e) ?? this.target.edge, cx);
          }),
      )
      .child(edge ? this.split(edge, face, this.landing(t, name)) : face);
  }

  // The pane as it is now; squeezed while a split is previewed beside it.
  face(t, p, squeezed) {
    const pic = icon(p.program, 22, t.foreground);
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(0)
      .p(10)
      .gap(4)
      .items_center()
      .justify_center()
      .when(squeezed, (el) => el.opacity(0.5))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().w_full().text_center().truncate().child(paneName(p)))
      .when(Boolean(p.cwd), (el) =>
        el.child(div().w_full().text_center().truncate().text_size(11).text_color(t.dim).child(folderName(p.cwd))),
      );
  }

  // Where the sub-agent would land.
  landing(t, name) {
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(0)
      .p(8)
      .items_center()
      .justify_center()
      .rounded(6)
      .border_1()
      .border_color(t.accent)
      .bg(t.accent + "33")
      .child(div().w_full().text_center().truncate().font_semibold().child(name));
  }

  split(edge, face, landing) {
    const across = edge === "left" || edge === "right";
    const first = edge === "left" || edge === "up";
    // h_flex centres its children: stretch both halves to the full height.
    const half = (el) => (across ? el.self_stretch() : el);
    return (across ? h_flex() : v_flex())
      .flex_1()
      .min_w(0)
      .min_h(0)
      .p(4)
      .gap(4)
      .child(half(first ? landing : face))
      .child(half(first ? face : landing));
  }
}
