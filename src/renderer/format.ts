/** Display-only: the last segment of a path, on either separator convention. */
export const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** The one answer to "how does this application write a file size". */
export const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`
