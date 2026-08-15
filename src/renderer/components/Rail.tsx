/**
 * Why closing the drawer is not a dead end: with the image cleared and the
 * drawer hidden, the mockup left nothing on screen to act on.
 */
export function Rail({ onOpen, count }: { onOpen: () => void; count: number }) {
  return (
    <div className="rail">
      <button className="icon" onClick={onOpen} title="Open drawer ([d])">
        ›
      </button>
      <span className="rail-count">{count}</span>
    </div>
  )
}
