export function escapeIdent(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

export function timestampToMilliseconds(value: NonNullable<unknown>): number {
	return value instanceof Date ? value.getTime() : Number(value);
}
