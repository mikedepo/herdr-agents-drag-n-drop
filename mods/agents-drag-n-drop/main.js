// Agents Drag n Drop: an agents list whose sub-agents you can drag into the shown tab, the
// drop map that places them, a pane header with Detach and agent names, and a terminal
// right-click menu with Copy.
// One mod, four parts, picked by what each copy is given:
//   - a pane header gets props.pane from the app:
//       "pane": { "header": { "content": { "mod": "agents-drag-n-drop" } } }
//   - the drop map is opened by the list with props.view "drop";
//   - the terminal menu gets props.target from the app: the layout root's
//       "terminal_menu": "agents-drag-n-drop";
//   - anything else is the agents list: { "content": { "mod": "agents-drag-n-drop" } }
import { View } from "gpui-kit";
import { props } from "herdr";
import { Agents } from "./agents.js";
import { DropMap } from "./drop.js";
import { PaneHeader } from "./header.js";
import { TerminalMenu } from "./menu.js";

export default class AgentsPlus extends View {
  init(given, cx) {
    const p = props() ?? {};
    const Part =
      p.view === "drop" ? DropMap : p.tab === "pane" && p.target ? TerminalMenu : p.pane ? PaneHeader : Agents;
    this.part = new Part();
    this.part.init(given, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
