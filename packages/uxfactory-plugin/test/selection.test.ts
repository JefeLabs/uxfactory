import { describe, it, expect } from "vitest";
import { mapSelection } from "../src/selection.js";

describe("mapSelection", () => {
  it("maps §7.5 node fields and carries page/file meta", () => {
    const payload = mapSelection(
      [
        {
          id: "1:2",
          name: "api",
          type: "shape",
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          opacity: 0.5,
          rotation: 90,
          visible: true,
          cornerRadius: 8,
          characters: "hi",
        },
      ],
      { page: "P", fileName: "F", fileKey: "k" },
    );
    expect(payload).toEqual({
      page: "P",
      fileName: "F",
      fileKey: "k",
      nodes: [
        {
          id: "1:2",
          name: "api",
          type: "shape",
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          opacity: 0.5,
          rotation: 90,
          visible: true,
          cornerRadius: 8,
          characters: "hi",
        },
      ],
      stylesInUse: 0,
    });
  });

  it("omits absent optional fields", () => {
    const payload = mapSelection(
      [{ id: "1:3", name: "n", type: "frame", x: 0, y: 0, w: 10, h: 10 }],
      { page: "P", fileName: "F", fileKey: "k" },
    );
    expect(payload.nodes[0]).toEqual({
      id: "1:3",
      name: "n",
      type: "frame",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  });
});
