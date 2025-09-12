export const cleanData = (
  data: Record<string, any>,
  filterValues: any[] = [null, undefined, ""],
  shouldTrim: boolean = true
) => {
  return Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [
        key,
        shouldTrim && typeof value === "string" ? value.trim() : value,
      ])
      .filter(([, value]) => !filterValues.includes(value))
  );
};
