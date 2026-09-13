import { before } from "./patcher.js";

type Callback = (tree: any, props: any) => any;

/** Observe Discord's native menu renderers through their Flux open event. */
export function createMenuPatcher(React: any, dispatcher: any, report: (error: unknown) => void) {
  const callbacks = new Map<string, Set<Callback>>();
  let unpatch: (() => void) | undefined;

  function wrapRenderer(component: any, depth = 0): any {
    if (!component || depth >= 10) return component;
    if (typeof component === "function") {
      if (component.prototype?.isReactComponent) {
        return class extends component {
          render() { return transform(super.render(), this.props, depth); }
        };
      }
      return function (this: any, props: any, ...args: any[]) {
        return transform(component.call(this, props, ...args), props, depth);
      };
    }
    if (typeof component === "object" && typeof component.render === "function") {
      return { ...component, render: wrapRenderer(component.render, depth) };
    }
    if (typeof component === "object" && component.type) {
      return { ...component, type: wrapRenderer(component.type, depth) };
    }
    return component;
  }

  function transform(node: any, props: any, depth: number): any {
    if (!callbacks.size) return node;
    if (Array.isArray(node)) return node.map((child) => transform(child, props, depth));
    if (!React.isValidElement(node)) return node;
    const navId = node.props?.navId;
    if (navId) {
      let tree = node;
      for (const callback of callbacks.get(navId) ?? []) {
        try { tree = callback(tree, props) ?? tree; }
        catch (error) { report(error); }
      }
      return tree;
    }
    // Providers/fragments can contain the native Menu directly. Other wrappers
    // reveal it on their own render, with the original hooks and props intact.
    const children = transform(node.props.children, props, depth);
    const type = wrapRenderer(node.type, depth + 1);
    if (type === node.type && children === node.props.children) return node;
    return React.createElement(type, { ...node.props, key: node.key, children });
  }

  function observe(args: any[]) {
    const event = args[0];
    if (event?.type !== "CONTEXT_MENU_OPEN" || !event.contextMenu) return;
    const menu = event.contextMenu;
    if (typeof menu.renderLazy === "function") {
      const original = menu.renderLazy;
      menu.renderLazy = async function (this: any, ...args: any[]) {
        return wrapRenderer(await original.apply(this, args));
      };
    } else if (typeof menu.render === "function") {
      menu.render = wrapRenderer(menu.render);
    }
  }

  return {
    patch(navId: string, callback: Callback) {
      if (!unpatch) {
        if (typeof dispatcher?.dispatch !== "function") throw new Error("Discord context-menu dispatcher unavailable");
        unpatch = before("discreate:bd-ctxmenu", dispatcher, "dispatch", observe);
      }
      let list = callbacks.get(navId);
      if (!list) callbacks.set(navId, (list = new Set()));
      list.add(callback);
      return () => {
        list!.delete(callback);
        if (!list!.size) callbacks.delete(navId);
        if (!callbacks.size) { unpatch?.(); unpatch = undefined; }
      };
    },
  };
}
