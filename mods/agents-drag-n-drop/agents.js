// The agents list. Ported from Better Sidebar's (munza/herdr-mods, Apache-2.0),
// itself adapted from Herdr's shipped agents mod: grouping by main space and by
// name prefix; agents in grouped or priority views; parents take their most urgent
// sub-agent's place; a viewed done agent stays in Done until left.
// Changed here: Herdr's own pins (terminal.pin), its own main-space lookup, a
// sub-agent with a pane listed once (nested), and sub-agent rows you drag, or
// place with a button, into the shown tab through the drop map (./drop.js).

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  terminals,
  panes,
  focused,
  spaces,
  run,
  theme,
  shared,
  setShared,
  setAgentOrder,
  window,
  layout,
  openOverlay,
  settings,
} from "herdr";
import { findNode } from "./find-node.js";
import { SpaceParents } from "./parents.js";
import { taskOf } from "./names.js";
import { TEXT, Icon, IconButton, GroupHeader, Menu, MenuLabel, MenuOption } from "./ui.js";

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = findNode(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", {
    id: "sidebar",
    px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44,
  });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling =
    live &&
    live !== prog &&
    !/^[~/]|^[A-Za-z]:\\/.test(live) &&
    !live.includes("@") &&
    live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
  { id: "parent", label: "Grouped by main space", icon: "git-branch" },
  { id: "prefix", label: "Grouped by prefix", icon: "tag" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

// PR-12, INS-4 and PLAT-work, also after a folder such as feature/INS-4: capitals
// need nothing more, while lower case needs a number so herdr-mods is no prefix.
const PREFIX = /(?:^|\/)(?:([A-Z][A-Z0-9]*)-\S|([A-Za-z][A-Za-z0-9]*)-\d)/;
export function namePrefix(...names) {
  for (const name of names) {
    const match = PREFIX.exec(name ?? "");
    if (match) return (match[1] ?? match[2]).toUpperCase();
  }
  return null;
}

// How `sort` gathers agents: a group's key and heading. Null keeps priority's sections.
function grouping(sort, tabName, parents) {
  if (sort === "grouped") return (a) => ({ id: `sp-${a.space}`, label: a.space_name || "" });
  if (sort === "parent") {
    return (a) => {
      const parent = parents[a.space];
      return parent
        ? { id: `repo-${parent.key}`, label: parent.label }
        : { id: `sp-${a.space}`, label: a.space_name || "" };
    };
  }
  if (sort === "prefix")
    return (a) => {
      const prefix = namePrefix(a.space_name, tabName(a));
      return prefix
        ? { id: `prefix-${prefix}`, label: `${prefix}-` }
        : { id: "prefix-none", label: "No prefix" };
    };
  return null;
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none();
}

// What a row calls an agent: its tab's title, or failing that its own.
function agentLabel() {
  const tabs = spaces().flatMap((s) => s.tabs);
  return (a) => {
    const tab = tabs.find((candidate) => candidate.id === a.tab);
    return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
  };
}

// Same group next to each other, so the list reads, and next-agent keys move, in order.
function gatherGroups(list, groupOf, sortId) {
  const gathered = new Map();
  for (const a of list) {
    const { id } = groupOf(a);
    gathered.set(id, [...(gathered.get(id) ?? []), a]);
  }
  const ids = [...gathered.keys()];
  if (sortId === "prefix")
    ids.sort((x, y) => (x === "prefix-none") - (y === "prefix-none") || x.localeCompare(y));
  return ids.flatMap((id) => gathered.get(id));
}

export class Agents {
  init(_props, cx) {
    this.sortOpen = false;
    this.sortFocus = cx.focus_handle();
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    // "Grouped by main space": which repository each space is in, from Git, read
    // only while that grouping is chosen.
    this.parents = new SpaceParents();
    if (sortOf().id === "parent") this.parents.read(cx);
    cx.timer.every(30000, (cx) => {
      if (sortOf().id === "parent") this.parents.read(cx);
      cx.notify();
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed))
      if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle")
      this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone =
      a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : (RANK[a.status] ?? 0);
  }

  sortOptions() {
    const on = sortOf().id;
    return SORTS.map((s) =>
      MenuOption({
        id: `sort-${s.id}`,
        icon: s.icon,
        label: s.label,
        selected: s.id === on,
        onClick: (cx) => {
          setShared("agents.sort", s.id);
          this.sortOpen = false;
          if (s.id === "parent") this.parents.read(cx);
          cx.notify();
        },
      }),
    );
  }

  renderSortMenu(sort) {
    return Menu({
      id: "ag-sort-menu",
      open: this.sortOpen,
      focus: this.sortFocus,
      onOpenChange: (open, cx) => {
        this.sortOpen = open;
        cx.notify();
      },
      trigger: IconButton({
        id: "ag-sort",
        icon: sort.icon,
        label: `Sort agents: ${sort.label}`,
        iconSize: 14,
        muted: true,
      }),
      children: [MenuLabel("Sort agents"), ...this.sortOptions()],
    });
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // ── Drop map (./drop.js): drag a sub-agent row a few px, or click its
  // place button, to put it beside a pane of the shown tab.

  hoverSub(addr, over, cx) {
    if (over) this.subHovered = addr;
    else {
      if (this.subHovered === addr) this.subHovered = null;
      // Left the row without dragging: forget the press, whose release may land elsewhere.
      if (this.subPress?.address === addr && !this.subPress.opened) this.subPress = null;
    }
    cx.notify();
  }

  pressSub(addr, e) {
    this.subPress = { address: addr, x: e.position.x, y: e.position.y, opened: false };
  }

  dragSub(addr, label, e) {
    const p = this.subPress;
    if (!p || p.address !== addr || p.opened) return;
    if (Math.hypot(e.position.x - p.x, e.position.y - p.y) < 6) return;
    p.opened = true;
    // Under the pointer, so the drag carries on into the map. Pointer positions are
    // window pixels; an overlay's `at` is scaled by the app's zoom.
    const zoom = Number(settings()?.zoom) || 1;
    this.openDropMap(addr, label, {
      x: Math.max(0, (e.position.x - 16) / zoom),
      y: Math.max(0, (e.position.y - 16) / zoom),
    });
  }

  openDropMap(addr, label, at) {
    openOverlay({
      mod: "agents-drag-n-drop",
      kind: "popup",
      width: 560,
      height: 400,
      props: { view: "drop", terminal: addr, name: label },
      ...(at ? { at } : {}),
    });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    const label = k.name || k.template || k.program?.name || k.address;
    // pr-12 alone says little: what it's working on follows, quietly.
    const task = taskOf(k);
    // Only a sub-agent without a pane can be placed.
    const own = panes().find((p) => p.terminal === k.address);
    const placeable = !own;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_hover((over, cx) => this.hoverSub(k.address, over, cx))
      .when(placeable, (el) =>
        el
          .on_mouse_down("left", (e) => this.pressSub(k.address, e))
          .on_mouse_move((e) => this.dragSub(k.address, label, e))
          .on_mouse_up("left", () => {
            this.subPress = null;
          }),
      )
      .on_click(() => {
        if (this.subPress?.opened) return;
        // With a pane, its row here is the only one: go to the pane. Without, peek.
        if (own) run("pane.focus", { pane: own.pane });
        else this.peek(k.address);
      })
      .children(
        s.lines.map((l) =>
          div()
            .self_start()
            .mt(-4)
            .w(9)
            .h(17)
            .mr(4)
            .flex_none()
            .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
            .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6)),
        ),
      )
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(5)
          .items_center()
          .child(
            div()
              .min_w(0)
              .truncate()
              .text_color(on ? t.foreground : t.muted)
              .child(label),
          )
          .when(Boolean(task), (el) =>
            el.child(
              div()
                .id(`task-${k.address}`)
                .flex_1()
                .min_w(0)
                .truncate()
                .text_size(TEXT.caption)
                .text_color(t.dim)
                .tooltip(task)
                .child(task),
            ),
          ),
      )
      .when(placeable && this.subHovered === k.address, (el) =>
        el.child(
          IconButton({
            id: `place-${k.address}`,
            icon: "panel-right",
            label: "Place in this tab",
            iconSize: 13,
            muted: true,
            onClick: () => this.openDropMap(k.address, label),
          }),
        ),
      )
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working")
      return Icon("spinner").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact)
      return div()
        .size(14)
        .flex_none()
        .rounded(4)
        .bg(t.blocked + "26")
        .text_size(TEXT.avatar)
        .font_bold()
        .text_color(t.blocked)
        .flex()
        .items_center()
        .justify_center()
        .child("!");
    if (a.status === "blocked")
      return div()
        .flex_none()
        .px(6)
        .h(18)
        .rounded(5)
        .bg(t.blocked + "26")
        .text_size(TEXT.avatar)
        .font_semibold()
        .text_color(t.blocked)
        .flex()
        .items_center()
        .child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle")
      return div()
        .size(7)
        .mx(3)
        .flex_none()
        .rounded(4)
        .border(1.5)
        .border_color(t.idle ?? t.dim);
    return div()
      .size(7)
      .mx(3)
      .flex_none()
      .rounded(4)
      .bg(a.status === "done" ? color : t.dim + "00");
  }

  // opts, from the lists view: `view` already read, `heading: false` under its tabs.
  render(opts = {}) {
    const t = theme();
    const view = opts.view ?? this.readView();
    setAgentOrder(view.list.map((a) => a.address));
    const rows = view.collapsed
      ? view.list.flatMap((a, i) => this.agentWithSubs(a, i, view, t))
      : view.groups.flatMap((group, index) => this.groupRows(group, index, view, t));

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      // Under the lists view's tabs, the tab bar's space divides it instead.
      .when(opts.heading !== false, (el) => el.border_t(1).border_color(t.border))
      .text_size(TEXT.body)
      .when(!view.collapsed && opts.heading !== false, (el) => el.child(this.heading(view.sort, t)))
      .when(view.list.length === 0 && !view.collapsed, (el) => el.child(this.emptyMessage(t)))
      .child(
        v_flex()
          .id("ag-list")
          .flex_1()
          .min_h(0)
          .px(view.collapsed ? 0 : 8)
          .overflow_y_scrollbar()
          .mode("always")
          .children(rows),
      )
      .when(view.collapsed, (el) => el.child(this.expandRow(t)));
  }

  // ── What to show ──────────────────────────────────────────────────────────

  // Everything one render needs: the agents in order, in their groups.
  readView() {
    const sort = sortOf();
    const all = terminals();
    const now = Date.now();
    const unordered = agents();
    this.listed = new Map(unordered.map((a) => [a.address, a.status]));
    this.track(unordered, now);
    this.hold(unordered);

    // As Herdr's own list does: a sub-agent with a pane is in agents() too. Where its
    // parent's tree shows it, it gets no row of its own, unless pinned. The rail draws
    // no trees, so there it keeps its row. Pins are Herdr's (terminal.pin).
    const collapsed = narrow();
    const nested = new Set(
      collapsed ? [] : unordered.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)),
    );
    const rooted = unordered.filter((a) => a.pinned || !nested.has(a.address));

    const byPriority = sort.id === "priority";
    const urgency = this.urgencies(rooted, all);
    const ordered = byPriority ? this.byUrgency(rooted, urgency) : rooted;
    const pinned = ordered.filter((a) => a.pinned);
    const unpinned = ordered.filter((a) => !a.pinned);

    const label = agentLabel();
    const groupOf = grouping(sort.id, label, this.parents.value);
    const rest = groupOf ? gatherGroups(unpinned, groupOf, sort.id) : unpinned;
    const list = [...pinned, ...rest];
    return {
      sort,
      count: rooted.length,
      all,
      now,
      byPriority,
      collapsed,
      shown: focused()?.agent,
      list,
      label,
      groups: this.makeGroups(pinned, rest, groupOf, byPriority, urgency),
    };
  }

  // An agent's urgency is its own or its most urgent sub-agent's.
  urgencies(list, all) {
    const kids = (a) =>
      this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0);
    return new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...kids(a))]));
  }

  byUrgency(list, urgency) {
    const rankOf = (a) => urgency.get(a.address);
    return [...list].sort(
      (x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq,
    );
  }

  // Groups in list order: spaces (grouped) or priority sections. Agents of a
  // space are next to each other in agents(), so neighbours make a group.
  makeGroups(pinned, rest, groupOf, byPriority, urgency) {
    const groups = pinned.length
      ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }]
      : [];
    for (const a of rest) {
      const rank = urgency.get(a.address) || RANK.idle;
      const group = groupOf ? groupOf(a) : { id: `sec-${rank}`, label: SECTION[rank] };
      if (groups.at(-1)?.id === group.id) groups.at(-1).members.push(a);
      else
        groups.push({ ...group, status: byPriority ? SECTION_STATUS[rank] : null, members: [a] });
    }
    return groups;
  }

  toggleFold(id, cx) {
    if (!this.folded.delete(id)) this.folded.add(id);
    cx.notify();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  heading(sort, t) {
    return h_flex()
      .px(16)
      .h(41)
      .pt(14)
      .pb(5)
      .flex_none()
      .items_center()
      .justify_between()
      .child(div().text_size(TEXT.label).font_medium().text_color(t.dim).child("Agents"))
      .child(this.renderSortMenu(sort));
  }

  emptyMessage(t) {
    return div()
      .px(12)
      .text_size(TEXT.small)
      .text_color(t.dim)
      .child(
        "No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.",
      );
  }

  // Under the compact rail, the way back to the full sidebar.
  expandRow(t) {
    return h_flex()
      .h(28)
      .items_center()
      .justify_center()
      .child(
        div()
          .id("collapse")
          .text_size(TEXT.body)
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click(toggleSidebar)
          .child("»"),
      );
  }

  groupRows(group, index, view, t) {
    const members = this.folded.has(group.id)
      ? []
      : group.members.flatMap((a, i) => this.agentWithSubs(a, i, view, t));
    return [this.groupHeader(group, index, view, t), ...members];
  }

  // Folded, a group's header also says its most urgent state.
  groupHeader(group, index, view, t) {
    const folded = this.folded.has(group.id);
    const top = group.members.reduce(
      (most, a) => ((RANK[a.status] ?? 0) > (RANK[most] ?? 0) ? a.status : most),
      null,
    );
    const showTop = folded && !view.byPriority && top && top !== "idle";
    return GroupHeader({
      id: group.id,
      label: group.label,
      count: group.members.length,
      labelColor: t[group.status],
      folded,
      divided: index > 0,
      action: showTop ? this.status(t, { status: top }, true) : null,
      onClick: (cx) => this.toggleFold(group.id, cx),
    });
  }

  agentWithSubs(a, i, view, t) {
    if (view.collapsed) return [this.railRow(a, i, t)];
    const subs = this.tree(view.all, a.address);
    const row = this.agentRow(a, subs, view, t);
    if (this.folded.has(a.address)) return [row];
    return [row, ...subs.map((s) => this.subRow(t, s, view.shown, view.byPriority))];
  }

  railRow(a, i, t) {
    return h_flex()
      .id(`ag-${a.address}`)
      .h(26)
      .px(8)
      .flex_none()
      .items_center()
      .gap(4)
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .whitespace_nowrap()
          .text_right()
          .text_color(t.muted)
          .child(String(i + 1)),
      )
      .child(
        h_flex()
          .w(14)
          .flex_none()
          .items_center()
          .justify_center()
          .child(this.status(t, a, true)),
      );
  }

  agentRow(a, subs, view, t) {
    const pic = icon(a.program, 16, t.foreground);
    const hovered = this.hovered === a.address;
    const when = this.since(a);
    // An agent on another machine (`vps/t7`) says which.
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    return h_flex()
      .id(`ag-${a.address}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .when(a.focused, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (hovered) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(pic), (el) => el.child(this.agentIcon(a, pic, subs)))
      .child(this.agentName(a, view, t))
      .when(Boolean(machine), (el) =>
        el.child(div().text_size(TEXT.badge).text_color(t.dim).child(machine)),
      )
      .when(subs.length > 0, (el) => el.child(this.foldButton(a, subs, t)))
      .when(hovered, (el) => el.child(this.pinButton(a, t)))
      .when(!hovered && Boolean(when), (el) =>
        el.child(
          div()
            .flex_none()
            .text_size(TEXT.caption)
            .text_color(t.dim)
            .child(duration(view.now - when)),
        ),
      )
      .child(this.status(t, a, view.byPriority && !a.pinned));
  }

  // With sub-agents, clicking the icon folds them.
  agentIcon(a, pic, subs) {
    return div()
      .id(`agent-fold-${a.address}`)
      .when(subs.length > 0, (el) =>
        el.on_click((_e, cx) => {
          cx.stop_propagation();
          this.toggleFold(a.address, cx);
        }),
      )
      .child(pic);
  }

  // The tab's title, then quietly its space.
  agentName(a, view, t) {
    const label = view.label(a);
    // A row is its tab's title, as Herdr's tab bar shows it; the icon says which agent.
    const name = a.tab_name || label;
    const idle = a.status === "idle" && !a.focused;
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .items_center()
      .child(
        div()
          .min_w(0)
          .max_w(140)
          .truncate()
          .text_color(idle ? t.muted : t.foreground)
          .child(name),
      )
      // The space, quietly after the name.
      .when(Boolean(a.space_name), (el) =>
        el.child(div().flex_1().min_w(0).truncate().text_size(TEXT.caption).text_color(t.dim).child(a.space_name)),
      );
  }

  // The fold chevron; folded, the count too, colored by the most urgent one.
  foldButton(a, subs, t) {
    const statuses = subs.map((s) => kidStatus(s.t, this.listed));
    const top = statuses.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const open = !this.folded.has(a.address);
    return div()
      .id(`fold-${a.address}`)
      .h(18)
      .px(3)
      .gap(3)
      .flex()
      .items_center()
      .rounded(4)
      .text_size(TEXT.caption)
      .text_color(open ? t.dim : (t[top] ?? t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.toggleFold(a.address, cx);
      })
      .child(Icon(`chevron-${open ? "down" : "right"}`, 11))
      .when(!open, (el) => el.child(String(subs.length)));
  }

  pinButton(a, t) {
    const pinned = Boolean(a.pinned);
    return div()
      .id(`pin-${a.address}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(pinned ? "Unpin" : "Pin to the top")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("terminal.pin", { terminal: a.address, pinned: !pinned });
        // The row moves away from under the pointer, and no hover-out comes.
        this.hovered = null;
        cx.notify();
      })
      .child(Icon(pinned ? "pin-off" : "pin", 13));
  }
}
