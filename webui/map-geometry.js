export function projectPoint([lon, lat], bounds) {
  const [west, south, east, north] = bounds;
  return [
    ((lon - west) / Math.max(.000001, east - west)) * 760 - 20,
    ((north - lat) / Math.max(.000001, north - south)) * 760 - 20,
  ];
}

export function unprojectPoint([x, y], bounds) {
  const [west, south, east, north] = bounds;
  return [
    west + ((x + 20) / 760) * (east - west),
    north - ((y + 20) / 760) * (north - south),
  ];
}

export function focusPointFromPan(markerPoint, bounds, frame, offset) {
  const scale = Math.max(.000001, frame.scale);
  const [lon, lat] = unprojectPoint([
    markerPoint[0] - offset.x / scale,
    markerPoint[1] - offset.y / scale,
  ], bounds);
  return { lat, lon };
}
