/**
 * Doubles as onboarding and as the discoverability fix for the drawer toggle,
 * which is otherwise invisible once the drawer is collapsed.
 */
export function EmptyState({ libraryEmpty }: { libraryEmpty: boolean }) {
  return (
    <div className="empty">
      <p className="empty-title">
        {libraryEmpty ? 'Drag images here to begin' : 'No image selected'}
      </p>
      <ul className="keymap">
        <li>
          <kbd>m</kbd> metadata
        </li>
        <li>
          <kbd>esc</kbd> clear
        </li>
        <li>
          <kbd>d</kbd> drawer
        </li>
        <li>
          <kbd>←</kbd> <kbd>→</kbd> browse
        </li>
      </ul>
    </div>
  )
}
