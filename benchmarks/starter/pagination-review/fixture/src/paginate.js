export function paginate(items, page, pageSize) {
  if (!Number.isInteger(page) || page < 1) throw new RangeError('page starts at 1');
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be positive');
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

export function pageCount(total, pageSize) {
  return Math.floor(total / pageSize);
}
