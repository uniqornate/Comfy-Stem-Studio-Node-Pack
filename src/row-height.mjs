// Channel row height in pixels, and the 0.1 to 1 scale the knob uses.
export const ROW_MIN = 28;
export const ROW_MAX = 260;
export const ROW_DEFAULT = 68;
export const clampRow = px => Math.round(Math.max(ROW_MIN, Math.min(ROW_MAX, Number.isFinite(px) ? px : ROW_DEFAULT)));
export const rowFromKnob = value => clampRow(ROW_MIN + (Math.max(0.1, Math.min(1, value)) - 0.1) / 0.9 * (ROW_MAX - ROW_MIN));
export const knobFromRow = px => 0.1 + (clampRow(px) - ROW_MIN) / (ROW_MAX - ROW_MIN) * 0.9;
