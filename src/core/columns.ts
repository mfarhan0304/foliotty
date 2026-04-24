import type { TextItem } from './pdf-service.js';

export type Column = {
  x: number;
  items: TextItem[];
};

export type ColumnLayout = {
  columns: Column[];
  spanningItems: TextItem[];
  droppedItems: TextItem[];
  orderedItems: TextItem[];
};

type HistogramBucket = {
  count: number;
  x: number;
};

const DEFAULT_BUCKET_SIZE = 20;
const DEFAULT_MIN_PEAK_GAP = 80;
const DEFAULT_SPAN_WIDTH_RATIO = 0.7;
const DEFAULT_BOUNDARY_TOLERANCE_RATIO = 0.05;

function sortItemsTopToBottom(items: TextItem[]): TextItem[] {
  return [...items].sort((left, right) => {
    if (left.y !== right.y) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });
}

function estimatePageWidth(items: TextItem[]): number {
  if (items.length === 0) {
    return 0;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    minX = Math.min(minX, item.x);
    maxX = Math.max(maxX, item.x + item.width);
  }

  return Math.max(0, maxX - minX);
}

function buildHistogram(
  items: TextItem[],
  bucketSize: number,
): HistogramBucket[] {
  const buckets = new Map<number, HistogramBucket>();

  for (const item of items) {
    const bucketIndex = Math.floor(item.x / bucketSize);
    const bucketStart = bucketIndex * bucketSize;
    const bucket = buckets.get(bucketStart);

    if (bucket) {
      bucket.count += 1;
      bucket.x += item.x;
      continue;
    }

    buckets.set(bucketStart, {
      count: 1,
      x: item.x,
    });
  }

  return [...buckets.values()];
}

function findColumnPeaks(
  items: TextItem[],
  bucketSize: number,
  minPeakGap: number,
): number[] {
  const histogram = buildHistogram(items, bucketSize);

  if (histogram.length === 0) {
    return [];
  }

  const selected: number[] = [];
  const candidates = histogram
    .map((bucket) => ({
      count: bucket.count,
      x: bucket.x / bucket.count,
    }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.x - right.x;
    });
  const strongestCount = candidates[0]?.count ?? 0;
  const minPeakCount =
    strongestCount > 1 ? Math.max(2, strongestCount * 0.5) : 1;

  for (const candidate of candidates) {
    if (candidate.count < minPeakCount) {
      continue;
    }

    const tooClose = selected.some(
      (peak) => Math.abs(peak - candidate.x) < minPeakGap,
    );

    if (!tooClose) {
      selected.push(candidate.x);
    }

    if (selected.length === 2) {
      break;
    }
  }

  return selected.sort((left, right) => left - right);
}

function partitionSpanningItems(
  spanningItems: TextItem[],
  columnItems: TextItem[],
): {
  headerItems: TextItem[];
  footerItems: TextItem[];
  middleItems: TextItem[];
} {
  if (spanningItems.length === 0) {
    return {
      headerItems: [],
      footerItems: [],
      middleItems: [],
    };
  }

  if (columnItems.length === 0) {
    return {
      headerItems: sortItemsTopToBottom(spanningItems),
      footerItems: [],
      middleItems: [],
    };
  }

  const columnYs = columnItems.map((item) => item.y);
  const maxColumnY = Math.max(...columnYs);
  const minColumnY = Math.min(...columnYs);

  const headerItems: TextItem[] = [];
  const footerItems: TextItem[] = [];
  const middleItems: TextItem[] = [];

  for (const item of spanningItems) {
    if (item.y >= maxColumnY) {
      headerItems.push(item);
    } else if (item.y <= minColumnY) {
      footerItems.push(item);
    } else {
      middleItems.push(item);
    }
  }

  return {
    headerItems: sortItemsTopToBottom(headerItems),
    footerItems: sortItemsTopToBottom(footerItems),
    middleItems: sortItemsTopToBottom(middleItems),
  };
}

export function detectColumns(items: TextItem[]): ColumnLayout {
  const contentItems = items.filter((item) => item.str.trim().length > 0);
  const peaks = findColumnPeaks(
    contentItems,
    DEFAULT_BUCKET_SIZE,
    DEFAULT_MIN_PEAK_GAP,
  );

  if (peaks.length <= 1) {
    const ordered = sortItemsTopToBottom(contentItems);

    return {
      columns:
        ordered.length === 0
          ? []
          : [{ x: peaks[0] ?? ordered[0].x, items: ordered }],
      spanningItems: [],
      droppedItems: [],
      orderedItems: ordered,
    };
  }

  const pageWidth = estimatePageWidth(contentItems);
  const spanThreshold = pageWidth * DEFAULT_SPAN_WIDTH_RATIO;

  const spanningItems =
    pageWidth === 0
      ? []
      : contentItems.filter((item) => item.width >= spanThreshold);
  const candidateItems = contentItems.filter(
    (item) => !spanningItems.includes(item),
  );

  const columns = peaks.map((peak) => ({
    x: peak,
    items: [] as TextItem[],
  }));
  const droppedItems: TextItem[] = [];

  for (const item of candidateItems) {
    const distances = peaks
      .map((peak, index) => ({
        distance: Math.abs(item.x - peak),
        index,
      }))
      .sort((left, right) => left.distance - right.distance);

    const nearest = distances[0];
    const nextNearest = distances[1];

    if (!nearest) {
      droppedItems.push(item);
      continue;
    }

    const localGap = nextNearest
      ? Math.abs(peaks[nextNearest.index]! - peaks[nearest.index]!)
      : pageWidth;
    const maxDistance =
      localGap / 2 + localGap * DEFAULT_BOUNDARY_TOLERANCE_RATIO;

    if (nearest.distance > maxDistance) {
      droppedItems.push(item);
      continue;
    }

    columns[nearest.index]?.items.push(item);
  }

  const orderedColumns = columns
    .map((column) => ({
      x: column.x,
      items: sortItemsTopToBottom(column.items),
    }))
    .filter((column) => column.items.length > 0);

  const allColumnItems = orderedColumns.flatMap((column) => column.items);
  const { headerItems, footerItems, middleItems } = partitionSpanningItems(
    spanningItems,
    allColumnItems,
  );
  const orderedItems = [
    ...headerItems,
    ...middleItems,
    ...orderedColumns.flatMap((column) => column.items),
    ...footerItems,
  ];

  return {
    columns: orderedColumns,
    spanningItems: sortItemsTopToBottom(spanningItems),
    droppedItems: sortItemsTopToBottom(droppedItems),
    orderedItems,
  };
}
