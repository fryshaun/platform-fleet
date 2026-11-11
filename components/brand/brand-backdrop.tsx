/**
 * The marketing backdrop: a hatch laid at the mark's own lean, over two pools
 * of light. Everything is CSS — no image request, no animation — and the whole
 * layer is hidden from assistive tech, so it never becomes content.
 *
 * Drop it as the first child of a `relative isolate` container: the negative
 * z-index keeps it behind normal flow content without repainting over it.
 */
export function BrandBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="brand-glow absolute inset-0" />
      <div className="brand-hatch absolute inset-0" />
    </div>
  );
}
