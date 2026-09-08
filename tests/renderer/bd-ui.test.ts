// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBdApi } from "../../src/renderer/api/bd-api";
import { Discreate } from "../../src/renderer/api/index";

const modules = vi.hoisted(() => [] as any[]);
vi.mock("../../src/renderer/core/webpack", () => ({
  findByProps: (...keys: string[]) => modules.find((m) => keys.every((key) => m[key] !== undefined)),
}));
beforeEach(() => {
  vi.useFakeTimers();
  Discreate.React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }) };
});
afterEach(() => {
  modules.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
  delete (window as any).BdApi;
  Discreate.React = undefined;
});

describe("BetterDiscord UI contracts", () => {
  it("never confirms an action when a native dialog cannot be opened", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    installBdApi().UI.showConfirmationModal("Delete data?", "This removes saved data.", { onConfirm, onCancel });
    await Promise.resolve();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("resolves the modal component separately, preserves React content and returns the modal key", () => {
    const ConfirmModal = () => null;
    let rendered: any;
    const onClose = vi.fn();
    const openModal = vi.fn((render) => { rendered = render({ onClose }); return "modal-key"; });
    modules.push({ ConfirmModal }, { openModal, closeModal() {} });
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const content = { type: "input", props: {} };
    const key = installBdApi().UI.showConfirmationModal("Question", content, { onConfirm, onCancel });
    expect(key).toBe("modal-key");
    expect(rendered.type).toBe(ConfirmModal);
    expect(rendered.children).toContain(content);
    expect(onConfirm).not.toHaveBeenCalled();
    rendered.props.onConfirm();
    rendered.props.onClose();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("treats native backdrop/escape dismissal as cancellation", () => {
    let rendered: any;
    const onCancel = vi.fn();
    modules.push({ ConfirmationModal() {} }, {
      openModal: (render: any) => { rendered = render({ onClose() {} }); }, closeModal() {},
    });
    installBdApi().UI.showConfirmationModal("Question", "Text", { onCancel });
    rendered.props.onClose();
    rendered.props.onClose();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("creates the native toast payload before showing it", () => {
    const toast = { message: "Saved" };
    const createToast = vi.fn(() => toast);
    const showToast = vi.fn();
    modules.push({ createToast, showToast });
    installBdApi().UI.showToast("Saved", { type: "success" });
    expect(createToast).toHaveBeenCalledWith("Saved", "success");
    expect(showToast).toHaveBeenCalledWith(toast);
  });

  it("reports root and category setting changes with their original value types", () => {
    const events: any[] = [];
    const panel = installBdApi().UI.buildSettingsPanel({
      onChange: (...args: any[]) => events.push(args),
      settings: [
        { type: "switch", id: "enabled", value: false, onChange: (v: any) => events.push(["item", v]) },
        { type: "category", id: "appearance", settings: [
          { type: "dropdown", id: "size", value: 1, options: [{ label: "One", value: 1 }, { label: "Two", value: 2 }] },
        ] },
        { type: "text", id: "locked", disabled: true },
      ],
    });
    const toggle = panel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    const select = panel.querySelector("select") as HTMLSelectElement;
    select.selectedIndex = 1;
    select.dispatchEvent(new Event("change"));
    expect(events).toEqual([["item", true], [null, "enabled", true], ["appearance", "size", 2]]);
    expect(panel.querySelector('input[type="text"]').disabled).toBe(true);
  });
});
