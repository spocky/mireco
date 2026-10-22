// Device address validation.
//
// MiReCo only talks to devices on the local network. Restricting the
// configured address to private/loopback destinations keeps the page from
// being turned into a request generator for arbitrary public hosts, and lets
// us tell Chrome which address space the request targets (Local Network
// Access, see transport.js).

export const DEVICE_PORT = 6095;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// RFC 6762 multicast DNS names, e.g. "mitv.local".
const MDNS_NAME = /^(?=.{1,253}\.local$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+local$/;

function parseIPv4(host) {
  const m = IPV4.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map((part) => {
    // Reject leading zeros ("010") which some parsers treat as octal.
    if (part.length > 1 && part[0] === "0") return NaN;
    return Number(part);
  });
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

// Returns "loopback", "local" or "public" for an IPv4 address.
export function ipv4AddressSpace([a, b]) {
  if (a === 127) return "loopback";
  if (a === 10) return "local";
  if (a === 172 && b >= 16 && b <= 31) return "local";
  if (a === 192 && b === 168) return "local";
  if (a === 169 && b === 254) return "local"; // link-local
  return "public";
}

/**
 * Normalises and validates a user-entered device address.
 *
 * Accepts "192.168.1.20", "192.168.1.20:6095", "http://192.168.1.20:6095/",
 * "mitv.local" and "localhost" (useful with the mock device).
 *
 * @returns {{ok: true, host: string, addressSpace: "local"|"loopback"} |
 *           {ok: false, error: string}}
 */
export function parseDeviceAddress(input) {
  let value = String(input ?? "").trim().toLowerCase();
  if (!value) return { ok: false, error: "Enter your TV's IP address (Settings → Network on the TV)." };

  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/[/?#].*$/, "");

  if (value.startsWith("[") || (value.match(/:/g) || []).length > 1) {
    return { ok: false, error: "IPv6 addresses aren't supported. Use the TV's IPv4 address, e.g. 192.168.1.20." };
  }

  const portMatch = /^(.*):(\d+)$/.exec(value);
  if (portMatch) {
    if (Number(portMatch[2]) !== DEVICE_PORT) {
      return { ok: false, error: `The GiTV API always listens on port ${DEVICE_PORT}; leave the port out.` };
    }
    value = portMatch[1];
  }

  const octets = parseIPv4(value);
  if (octets) {
    const space = ipv4AddressSpace(octets);
    if (octets.every((n) => n === 0)) return { ok: false, error: "0.0.0.0 isn't a device address." };
    if (space === "public") {
      return {
        ok: false,
        error: `${value} isn't a local network address. Use the TV's LAN address (usually 192.168.x.x or 10.x.x.x).`,
      };
    }
    return { ok: true, host: octets.join("."), addressSpace: space };
  }

  if (value === "localhost") return { ok: true, host: value, addressSpace: "loopback" };
  if (MDNS_NAME.test(value)) return { ok: true, host: value, addressSpace: "local" };

  if (/^[\d.]+$/.test(value)) return { ok: false, error: `${value} isn't a valid IPv4 address.` };
  return {
    ok: false,
    error: "Only local addresses are allowed: an IPv4 LAN address (192.168.x.x, 10.x.x.x, 172.16-31.x.x) or a .local name.",
  };
}
