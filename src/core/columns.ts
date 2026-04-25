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

type PageBounds = {
  centerX: number;
  maxX: number;
  minX: number;
  width: number;
};

const DEFAULT_BUCKET_SIZE = 20;
const DEFAULT_MIN_PEAK_GAP = 80;
const DEFAULT_SPAN_WIDTH_RATIO = 0.7;
const DEFAULT_BOUNDARY_TOLERANCE_RATIO = 0.05;
const DEFAULT_CENTERED_SPAN_TOLERANCE_RATIO = 0.25;

function sortItemsTopToBottom(items: TextItem[]): TextItem[] {
  return [...items].sort((left, right) => {
    if (left.y !== right.y) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });
}

function estimatePageBounds(items: TextItem[]): PageBounds {
  if (items.length === 0) {
    return {
      centerX: 0,
      maxX: 0,
      minX: 0,
      width: 0,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    minX = Math.min(minX, item.x);
    maxX = Math.max(maxX, item.x + item.width);
  }

  const width = Math.max(0, maxX - minX);

  return {
    centerX: minX + width / 2,
    maxX,
    minX,
    width,
  };
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

function isCenteredSpanCandidate(
  item: TextItem,
  bounds: PageBounds,
  peaks: number[],
): boolean {
  const [leftPeak, rightPeak] = peaks;

  if (bounds.width === 0 || leftPeak === undefined || rightPeak === undefined) {
    return false;
  }

  const itemCenter = item.x + item.width / 2;
  const columnGap = Math.abs(rightPeak - leftPeak);
  const startsBetweenColumns =
    item.x > leftPeak + columnGap * DEFAULT_BOUNDARY_TOLERANCE_RATIO &&
    item.x < rightPeak - columnGap * DEFAULT_BOUNDARY_TOLERANCE_RATIO;
  const centerIsNearPageCenter =
    Math.abs(itemCenter - bounds.centerX) <=
    bounds.width * DEFAULT_CENTERED_SPAN_TOLERANCE_RATIO;

  return startsBetweenColumns && centerIsNearPageCenter;
}

function promoteAcademicSpans(
  columns: Column[],
  droppedItems: TextItem[],
  existingSpans: TextItem[],
  bounds: PageBounds,
  peaks: number[],
): {
  columns: Column[];
  droppedItems: TextItem[];
  spanningItems: TextItem[];
} {
  const columnItems = columns.flatMap((column) => column.items);
  const centeredCandidates = new Set(
    [...columnItems, ...droppedItems].filter((item) =>
      isCenteredSpanCandidate(item, bounds, peaks),
    ),
  );
  const bodyItems = columnItems.filter((item) => !centeredCandidates.has(item));

  if (bodyItems.length === 0) {
    return {
      columns,
      droppedItems,
      spanningItems: existingSpans,
    };
  }

  const columnYs = bodyItems.map((item) => item.y);
  const maxColumnY = Math.max(...columnYs);
  const minColumnY = Math.min(...columnYs);
  const promotedItems = new Set<TextItem>();

  for (const item of centeredCandidates) {
    const outsideBody = item.y >= maxColumnY || item.y <= minColumnY;

    if (outsideBody) {
      promotedItems.add(item);
    }
  }

  if (promotedItems.size === 0) {
    return {
      columns,
      droppedItems,
      spanningItems: existingSpans,
    };
  }

  return {
    columns: columns
      .map((column) => ({
        x: column.x,
        items: column.items.filter((item) => !promotedItems.has(item)),
      }))
      .filter((column) => column.items.length > 0),
    droppedItems: droppedItems.filter((item) => !promotedItems.has(item)),
    spanningItems: [...existingSpans, ...promotedItems],
  };
}

function isInsideColumnBand(
  item: TextItem,
  columnIndex: number,
  peaks: number[],
): boolean {
  const [leftPeak, rightPeak] = peaks;

  if (
    leftPeak === undefined ||
    rightPeak === undefined ||
    peaks.length !== 2
  ) {
    return false;
  }

  const itemCenter = item.x + item.width / 2;
  const columnGap = Math.abs(rightPeak - leftPeak);
  const boundary = (leftPeak + rightPeak) / 2;
  const minX = columnIndex === 0 ? leftPeak - columnGap : boundary;
  const maxX = columnIndex === 0 ? boundary : rightPeak + columnGap;

  return itemCenter >= minX && itemCenter <= maxX;
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
    const firstColumnX = peaks[0] ?? ordered[0]?.x ?? 0;

    return {
      columns:
        ordered.length === 0 ? [] : [{ x: firstColumnX, items: ordered }],
      spanningItems: [],
      droppedItems: [],
      orderedItems: ordered,
    };
  }

  const pageBounds = estimatePageBounds(contentItems);
  const spanThreshold = pageBounds.width * DEFAULT_SPAN_WIDTH_RATIO;

  const spanningItems =
    pageBounds.width === 0
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
      : pageBounds.width;
    const maxDistance =
      localGap / 2 + localGap * DEFAULT_BOUNDARY_TOLERANCE_RATIO;

    if (
      nearest.distance > maxDistance &&
      !isInsideColumnBand(item, nearest.index, peaks)
    ) {
      droppedItems.push(item);
      continue;
    }

    columns[nearest.index]?.items.push(item);
  }

  const initialOrderedColumns = columns
    .map((column) => ({
      x: column.x,
      items: sortItemsTopToBottom(column.items),
    }))
    .filter((column) => column.items.length > 0);

  const promotedLayout = promoteAcademicSpans(
    initialOrderedColumns,
    droppedItems,
    spanningItems,
    pageBounds,
    peaks,
  );
  const orderedColumns = promotedLayout.columns;
  const promotedSpanningItems = promotedLayout.spanningItems;
  const promotedDroppedItems = promotedLayout.droppedItems;

  const allColumnItems = orderedColumns.flatMap((column) => column.items);
  const { headerItems, footerItems, middleItems } = partitionSpanningItems(
    promotedSpanningItems,
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
    spanningItems: sortItemsTopToBottom(promotedSpanningItems),
    droppedItems: sortItemsTopToBottom(promotedDroppedItems),
    orderedItems,
  };
}
