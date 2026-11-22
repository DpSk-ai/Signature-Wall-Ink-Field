import { describe, expect, it } from "vitest";
import { occupiedBounds, place } from "./layout.js";
describe("persistent exhibition slots", () => {
  it("preserves earlier boxes at 120 long, two-line names", () => {
    const prior: ReturnType<typeof place>[] = [];
    for (let i = 0; i < 120; i++) {
      const b = place(400, 144, prior, i.toString(16).padStart(8, "0"), 6);
      expect(
        prior.some(
          (a) =>
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height,
        ),
      ).toBe(false);
      expect(b.size).toBeGreaterThanOrEqual(15);
      prior.push(b);
    }
  });
  it("includes the ink of rotated legacy records", () => {
    const b = occupiedBounds({
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      rotation: -10,
    });
    expect(b.y).toBeLessThan(85);
    expect(b.x + b.width).toBeGreaterThan(201);
  });
});
