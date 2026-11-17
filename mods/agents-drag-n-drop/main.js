// Agents Drag n Drop: an agents list whose sub-agents you can drag into the shown tab, the
// drop map that places them, and a pane header with Detach and agent names.
// One mod, three parts, picked by what each copy is given:
//   - a pane header gets props.pane from the app:
//       "pane": { "header": { "content": { "mod": "agents-drag-n-drop" } } }
//   - the drop map is opened by the list with props.view "drop";
//   - anything else is the agents list: { "content": { "mod": "agents-drag-n-drop" } }
import { View } from "gpui-kit";
import { props } from "herdr";
import { Agents } from "./agents.js";
import { DropMap } from "./drop.js";
import { PaneHeader } from "./header.js";

export default class AgentsPlus extends View {
  init(given, cx) {
    const p = props() ?? {};
    const Part = p.view === "drop" ? DropMap : p.pane ? PaneHeader : Agents;
    this.part = new Part();
    this.part.init(given, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
