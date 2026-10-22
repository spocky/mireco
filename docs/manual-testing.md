# Manual test checklist (real browser + real GiTV device)

The automated tests (`npm test`) cover URL building, encoding, the queue, the
text-buffering logic and the keyboard panel with simulated keyboard event
sequences and a mock transport. The items below depend on real browser
permissions, real Android keyboards or the GiTV firmware and must be checked
by hand. Until they are, treat them as **unverified**.

Record: phone model, Android version, Chrome version, keyboard app + version,
TV model and GiTV version.

## 1. Deployment / Local Network Access (GitHub Pages, Chrome for Android)
- [ ] `https://USERNAME.github.io/REPOSITORY/` loads with icons and styles (no 404s in DevTools → Network).
- [ ] Settings → enter TV IP → **Test connection** shows Chrome's local-network permission prompt (only after the tap, not on page load).
- [ ] After **Allow**: test reports that something answered; remote buttons work on the TV.
- [ ] After **Block**: test and buttons show the "Local network access is blocked" explanation, once, not per key. Re-allowing in site settings + reload restores control.
- [ ] Settings → *How this page reaches your TV* shows the HTTPS explanation and the right permission state.
- [ ] Firefox / Safari on the same URL: a clear "browser blocked the request / needs Local Network Access support" message, no crash.
- [ ] Add to Home screen: launches standalone at the repository path (not the domain root), with the MiReCo icon.

## 2. Remote functions (regression)
- [ ] Power (off), up/down/left/right, OK, home, back, menu, volume up/down.
- [ ] Custom buttons 1–4 with an app package and with `HDMI1`/`HDMI2`.
- [ ] Home with a custom launcher package configured.
- [ ] Colors (background/buttons) apply and persist after reload; vibration on/off.
- [ ] Settings from the original cookie-based version are migrated (open the old site's origin if applicable).
- [ ] `…/#192.168.1.20` sets the device IP once and the hash disappears.
- [ ] Changing the device IP while text is being sent cancels the queued keys and offers them back.

## 3. GiTV text input (firmware-dependent)
Open a text field on the TV (e.g. YouTube search) first.
- [ ] Lowercase and uppercase letters, digits.
- [ ] Space (`keycode=%20`), multiple consecutive spaces.
- [ ] Punctuation and symbols: `. , ! ? - _ @ & + # % / : ; ' " ( ) *`.
- [ ] Line break → `enter` behaves like the OK key in the TV's text field (may submit the search).
- [ ] With the experimental option on: `á é í ó ú ñ ü ç`. With it off: they're refused with a message.
- [ ] Key delay: with the default 80 ms, a 50-character paste arrives complete and in order. If characters are dropped, increase the delay and note the working value.
- [ ] TV off/asleep or wrong IP: a timeout/unreachable message within ~4 s; the remaining text is offered back.

## 4. Android keyboards (Auto words mode)
Repeat with Gboard, SwiftKey and Samsung Keyboard where available.
- [ ] Type `hel`, pick suggestion `hello`, keyboard adds a space → TV gets `hello ` once (no `helhello`).
- [ ] Type `hello wor`, pick `world`, press Send → TV gets `hello world`.
- [ ] Autocorrect on space (`teh` → `the`) → TV gets `the `.
- [ ] Swipe typing a sentence; voice typing a sentence; pasting several words.
- [ ] Fast continuous typing: words arrive in order; the field keeps the unfinished word.
- [ ] Backspace right after a word was sent → the "already sent" notice appears; nothing extra is typed.
- [ ] Keyboard stays open while pressing Send, Clear and remote d-pad buttons.
- [ ] Portrait and landscape, with the keyboard open: panel fully visible, no horizontal scrolling, close button reachable.
- [ ] Close and reopen the panel several times: draft kept, no duplicated characters.

## 5. Compose & Send mode
- [ ] Type, edit in the middle, accept suggestions, dictate → nothing reaches the TV until Send.
- [ ] Send → whole text arrives once; the field clears; typing new text during transmission works.
- [ ] Stop during a long send → remaining text offered back; Put back in draft + Send retries only that part.
- [ ] Mode survives a reload.

## 6. Preview modes
- [ ] `npm run preview` on Windows and on Linux/WSL (`http://localhost:8080`).
- [ ] `npm run preview:lan` reachable from the phone (firewall rule / WSL notes as needed).
- [ ] `npm run preview:https:lan` with an mkcert certificate trusted on the phone; refuses to start without certificate files.
- [ ] `npm run mock-device`: typed text shows up correctly.
