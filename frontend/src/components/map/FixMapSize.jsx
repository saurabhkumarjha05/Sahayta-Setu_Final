import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Leaflet measures its box once, when it first appears. If the page layout
// shifts afterwards (fonts, cards loading above it), the map shows up blank or
// half-drawn. This re-measures shortly after mounting and whenever the box resizes.
function FixMapSize() {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 300);

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

export default FixMapSize;
