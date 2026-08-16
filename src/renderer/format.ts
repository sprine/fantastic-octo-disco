/** Display-only: the last segment of a path, on either separator convention. */
export const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** The parent folder's own name, '/' at the root — same separator convention. */
export const parentName = (path: string): string => path.split(/[\\/]/).slice(-2, -1)[0] || '/'

/** The one answer to "how does this application write a file size". */
export const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`
