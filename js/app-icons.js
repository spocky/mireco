// Renders a shortcut button icon (see describeButton in apps.js) into an
// element. Brand SVG markup comes only from the built-in catalog; user text
// is always inserted with textContent.

const SVG_NS = "http://www.w3.org/2000/svg";

function useIcon(doc, id) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = doc.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${id}`);
  svg.append(use);
  return svg;
}

/**
 * @param {HTMLElement} el  a `.tile` element
 * @param {object|null} icon  descriptor; null renders an "add" placeholder
 */
export function renderIcon(el, icon) {
  const doc = el.ownerDocument;
  el.replaceChildren();
  el.classList.remove("brand", "has-text");
  el.style.removeProperty("--brand-bg");
  el.style.removeProperty("--brand-fg");
  if (!icon) {
    el.append(useIcon(doc, "add"));
    return;
  }
  switch (icon.type) {
    case "brand": {
      el.classList.add("brand");
      el.style.setProperty("--brand-bg", icon.app.bg);
      el.style.setProperty("--brand-fg", icon.app.fg);
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "brand-glyph");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = icon.app.svg; // trusted: from the APPS catalog
      el.append(svg);
      break;
    }
    case "text": {
      el.classList.add("has-text");
      const span = doc.createElement("span");
      span.className = "mono";
      span.textContent = icon.text;
      el.append(span);
      break;
    }
    case "input": {
      el.classList.add("has-text");
      const label = doc.createElement("span");
      label.className = "input-label";
      const kind = doc.createElement("small");
      kind.textContent = "HDMI";
      const number = doc.createElement("b");
      number.textContent = icon.number;
      label.append(kind, number);
      el.append(label);
      break;
    }
    default:
      el.append(useIcon(doc, icon.id || "apps"));
  }
}
