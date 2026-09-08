const outlineWidths = Array.from({ length: 10 }, (_, index) => index + 1)

/**
 * Shared SVG filters for DOM sticker artwork. `feMorphology` expands the
 * alpha mask into an opaque cut edge; it deliberately contains no blur.
 * The small directional shadow is added in CSS after this filter so it reads
 * as elevation rather than a fuzzy border.
 */
export function StickerOutlineFilters() {
  return (
    <svg className="sticker-outline-defs" aria-hidden="true" focusable="false">
      <defs>
        {outlineWidths.map((width) => (
          <filter
            key={width}
            id={`memento-sticker-outline-${width}`}
            x="-24%"
            y="-24%"
            width="148%"
            height="148%"
            colorInterpolationFilters="sRGB"
            primitiveUnits="objectBoundingBox"
          >
            <feMorphology in="SourceAlpha" operator="dilate" radius={width * .012} result="expanded" />
            <feFlood floodColor="#fffdf7" result="outlineColor" />
            <feComposite in="outlineColor" in2="expanded" operator="in" result="outline" />
            <feMerge>
              <feMergeNode in="outline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
      </defs>
    </svg>
  )
}
