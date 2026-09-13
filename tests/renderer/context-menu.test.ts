import { describe, expect, it, vi } from "vitest";
import { createMenuPatcher } from "../../src/renderer/core/context-menu";

const React = {
  isValidElement: (node: any) => !!node?.type && !!node?.props,
  createElement: (type: any, props: any) => ({ type, props }),
};

describe("native context-menu render patches", () => {
  it("passes the actual nested menu and message props, preserves other menus, and removes its hook", () => {
    const dispatch = vi.fn();
    const dispatcher = { dispatch };
    const report = vi.fn();
    const patcher = createMenuPatcher(React, dispatcher, report);
    const message = { id: "one" };
    const menu = { type: "menu", props: { navId: "message", children: ["copy"] } };
    const callback = vi.fn((tree) => ({ ...tree, props: { ...tree.props, children: [...tree.props.children, "original"] } }));
    const unrelated = vi.fn();
    const remove = patcher.patch("message", callback);
    const removeOther = patcher.patch("user", unrelated);
    function MessageMenu(props: any) { expect(props.message).toBe(message); return { type: "provider", props: { children: menu } }; }
    const event = { type: "CONTEXT_MENU_OPEN", contextMenu: { render: () => React.createElement(MessageMenu, { message }) } };
    dispatcher.dispatch(event);
    const outer = event.contextMenu.render();
    const rendered = outer.type(outer.props);
    expect(rendered.props.children.props.children).toEqual(["copy", "original"]);
    expect(callback).toHaveBeenCalledWith(menu, { message });
    expect(unrelated).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(event);
    expect(menu.props.children).toEqual(["copy"]);
    remove(); removeOther();
    expect(dispatcher.dispatch).toBe(dispatch);
    expect(report).not.toHaveBeenCalled();
  });
  it("handles lazy menu renderers and isolates callback failures", async () => {
    const dispatcher = { dispatch: vi.fn() };
    const report = vi.fn();
    const patcher = createMenuPatcher(React, dispatcher, report);
    const failure = new Error("broken plugin");
    const removeBroken = patcher.patch("message", () => { throw failure; });
    const callback = vi.fn();
    const remove = patcher.patch("message", callback);
    const menu = { type: "menu", props: { navId: "message" } };
    const event = { type: "CONTEXT_MENU_OPEN", contextMenu: { renderLazy: async () => (_props?: any) => menu } };
    dispatcher.dispatch(event);
    const render = await event.contextMenu.renderLazy();
    expect(render({ message: { id: "one" } })).toBe(menu);
    expect(report).toHaveBeenCalledWith(failure);
    expect(callback).toHaveBeenCalledWith(menu, { message: { id: "one" } });
    remove(); removeBroken();
  });
});
