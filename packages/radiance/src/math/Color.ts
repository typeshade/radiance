/** A linear RGB colour. Components are not clamped: an emission may be far above 1. */
export class Color {
  constructor(
    public r = 1,
    public g = 1,
    public b = 1,
  ) {}

  set(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  /** From a 0xRRGGBB number in sRGB, decoded to linear. */
  setHex(hex: number): this {
    const decode = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return this.set(decode((hex >> 16) & 255), decode((hex >> 8) & 255), decode(hex & 255));
  }

  copy(c: Color): this {
    return this.set(c.r, c.g, c.b);
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b);
  }

  multiplyScalar(s: number): this {
    return this.set(this.r * s, this.g * s, this.b * s);
  }

  equals(c: Color): boolean {
    return this.r === c.r && this.g === c.g && this.b === c.b;
  }

  toArray(): [number, number, number] {
    return [this.r, this.g, this.b];
  }
}
