import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Modal } from "./Modal";

/**
 * A render smoke test for the dialog shell. `renderToStaticMarkup` runs no effects, so this
 * covers the markup a browser receives (role, labelling, the close button, the children) and the
 * closed state. Focus, Esc, the scroll lock and layout are checked by reading the code, not here.
 */
describe("Modal", () => {
  it("renders nothing while closed", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, { open: false, title: "An", onClose: () => {}, children: "nội dung" }),
    );
    expect(html).toBe("");
  });

  it("renders a labelled modal dialog with the title, subtitle, close button and children", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        open: true,
        title: "Minh",
        subtitle: "Từng lần chi và nhận",
        onClose: () => {},
        children: createElement("p", null, "nội dung bên trong"),
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain("<h2");
    expect(html).toContain("Minh");
    expect(html).toContain("Từng lần chi và nhận");
    expect(html).toContain('aria-label="Đóng"');
    expect(html).toContain("nội dung bên trong");
  });

  it("omits the subtitle and its description link when none is given", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, { open: true, title: "Minh", onClose: () => {}, children: null }),
    );
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("Từng lần chi và nhận");
  });
});
