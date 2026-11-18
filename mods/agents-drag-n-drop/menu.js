// The terminal right-click menu: Herdr's own pane items, with Copy and Paste first.
// The layout's root picks it: "terminal_menu": "agents-drag-n-drop". Herdr opens it
// as a popup at the pointer with props { tab: "pane", target: { pane, terminal }, overlay }.
// ↑/↓ move, Enter runs, Esc closes.
//
// Copy and Paste run terminal.copy and terminal.paste, which act on the focused
// terminal: focus the clicked one first, and run only once it has focus. With
// nothing selected terminal.copy hands the key to the program, where it can stop a
// working agent, so Copy is greyed out without a selection and runs only while the
// selection is still there.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, closeOverlay, theme, keys, terminals, panes, focused } from "herdr";

const ICONS = "mods/agents-drag-n-drop/icons";

// The key bound to a command, for the hint on the right. `pane.split:right` binds
// pane.split with { direction: "right" }. With several, one ending in a letter:
// ctrl-shift-c before ctrl-insert.
function shortcut(action, value) {
  const bound = keys().filter((b) => b.action === action || (value && b.action === `${action}:${value}`));
  const k = bound.find((b) => /(^|-)[a-z0-9]$/i.test(b.keys)) ?? bound[0];
  return k ? k.keys : "";
}

// An item: label, icon, then a command and its args, or `own`: a terminal command
// for the clicked terminal (`selection`: only with one). `off`: greyed out.
// `line`: a separator above it.
function items() {
  const tg = props()?.target ?? {};
  const all = terminals();
  const term = all.find((t) => t.address === tg.terminal);
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  // Once they go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  // A terminal shown outside a tab (a layout terminal block, a window) has no pane
  // to split, zoom or close: its pane is the block's id.
  const pane = panes().find((p) => p.pane === tg.pane);
  return [
    ...(term
      ? [
          { label: "Copy", icon: "copy", own: "terminal.copy", selection: true, off: !term.selection },
          { label: "Paste", icon: "paste", own: "terminal.paste" },
        ]
      : []),
    ...(pane
      ? [
          { label: "Split right", icon: "split-right", command: "pane.split", args: { direction: "right", pane: pane.pane }, line: Boolean(term) },
          { label: "Split down", icon: "split-down", command: "pane.split", args: { direction: "down", pane: pane.pane } },
          { label: pane.zoomed ? "Unzoom" : "Zoom", icon: pane.zoomed ? "unzoom" : "zoom", command: "pane.zoom", args: { pane: pane.pane } },
        ]
      : []),
    ...(term
      ? [
          toProgram
            ? { label: "Use Herdr right-click menu", icon: "terminal", command: "terminal.right_click", args: { terminal: term.address, to: "menu" } }
            : { label: "Send right-clicks to pane", icon: "terminal", command: "terminal.right_click", args: { terminal: term.address, to: "program" } },
        ]
      : []),
    ...(parent
      ? [{ label: `Send back to ${parent.name || parent.address}`, icon: "detach", command: "terminal.park", args: { terminal: term.address } }]
      : []),
    ...(pane ? [{ label: "Close pane", icon: "close", command: "pane.close", args: { pane: pane.pane }, line: true }] : []),
  ].map((it) => ({ ...it, hint: it.own ? shortcut(it.own) : shortcut(it.command, it.args.direction) }));
}

export class TerminalMenu {
  init(_given, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.at = Math.max(0, items().findIndex((it) => !it.off));
    this.running = false;
  }

  dismiss() {
    closeOverlay(props()?.overlay);
  }

  // The next item that isn't greyed out, `step` (1 or -1) at a time.
  move(list, step) {
    for (let n = 1, i = this.at; n <= list.length; n++) {
      i = (i + step + list.length) % list.length;
      if (!list[i].off) {
        this.at = i;
        return;
      }
    }
  }

  choose(it, cx) {
    if (!it || it.off) return;
    if (it.own) return this.onClicked(it, cx);
    this.dismiss();
    run(it.command, it.args);
  }

  // Run `it.own` on the clicked terminal, once it's the focused one.
  onClicked(it, cx) {
    if (this.running) return;
    this.running = true;
    const tg = props()?.target ?? {};
    const ready = () => {
      const f = focused();
      return (f?.terminal === tg.terminal || f?.shown === tg.terminal) && (!it.selection || Boolean(f.selection));
    };
    if (!ready()) {
      const inTab = panes().some((p) => p.pane === tg.pane);
      run("pane.focus", inTab ? { pane: tg.pane } : { terminal: tg.terminal });
    }
    cx.spawn(async (cx) => {
      for (let i = 0; i < 20 && !ready(); i++) await cx.sleep(25);
      // Never elsewhere, and never Copy without a selection: the key would go to the program.
      if (ready()) run(it.own);
      // Last: closing this copy cancels its tasks.
      this.dismiss();
    });
  }

  render() {
    const t = theme();
    const list = items();
    return v_flex()
      .id("terminal-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.move(list, 1);
        else if (e.key === "up") this.move(list, -1);
        else if (e.key === "enter") this.choose(list[this.at], cx);
        else if (e.key === "escape") this.dismiss();
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && Boolean(it.line), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(
              h_flex()
                .id(`mi-${i}`)
                .h(31)
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .justify_between()
                .text_color(it.off ? t.dim : t.foreground)
                .when(!it.off && i === this.at, (el) => el.bg(t.selected))
                .when(!it.off, (el) => el.hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.choose(it, cx)))
                .child(svg(`${ICONS}/${it.icon}.svg`).size(14).flex_none().text_color(it.off ? t.dim : t.muted))
                .child(div().flex_1().child(it.label))
                .child(div().text_size(11).text_color(t.dim).child(it.hint ?? "")),
            ),
        ),
      );
  }
}
