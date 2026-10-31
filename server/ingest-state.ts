let refreshing = false;

export function isRefreshing(): boolean {
  return refreshing;
}

export function setRefreshing(value: boolean): void {
  refreshing = value;
}
