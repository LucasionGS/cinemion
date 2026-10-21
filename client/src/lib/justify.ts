/**
 * One row of a justified layout: the pictures in it and the height that makes them fill the width exactly.
 */
export interface JustifiedRow<T> {
  items: T[];
  /**
   * Unit is in pixels.
   */
  height: number;
  /**
   * The last row isn't stretched to the full width, so its pictures keep the target height.
   */
  partial: boolean;
}

/**
 * Lay pictures out in rows that fill `width`, keeping each picture's shape, like photo apps do: pictures are added
 * to a row until it would be wider than `width` at `targetHeight`, then the row is scaled down to fit.
 * @param aspect Width divided by height of a picture.
 * @param width Unit is in pixels, like `targetHeight` and `gap`.
 */
export function justify<T>(items: T[], aspect: (item: T) => number, width: number, targetHeight: number, gap: number): JustifiedRow<T>[] {
  const rows: JustifiedRow<T>[] = [];
  let row: T[] = [];
  let sum = 0;
  for (const item of items) {
    row.push(item);
    sum += aspect(item);
    const gaps = gap * (row.length - 1);
    if (sum * targetHeight + gaps >= width) {
      rows.push({ items: row, height: (width - gaps) / sum, partial: false });
      row = [];
      sum = 0;
    }
  }
  if (row.length) rows.push({ items: row, height: targetHeight, partial: true });
  return rows;
}

export default justify;
