// The browser owns install eligibility. Never offer a button without a real,
// single-use prompt event; manual home-screen instructions remain the fallback.
export function createInstallBanner({ banner, button, hint, win = window }) {
  const displayMode = win.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)");
  let installed = Boolean(displayMode.matches || win.navigator.standalone);
  let pendingPrompt = null;
  const manualHint = hint.textContent;

  function render() {
    banner.hidden = installed;
    button.hidden = installed || !pendingPrompt;
  }

  win.addEventListener("beforeinstallprompt", (event) => {
    if (installed) return;
    event.preventDefault();
    pendingPrompt = event;
    hint.textContent = manualHint;
    render();
  });

  win.addEventListener("appinstalled", () => {
    installed = true;
    pendingPrompt = null;
    render();
  });

  displayMode.addEventListener?.("change", () => {
    installed = Boolean(displayMode.matches || win.navigator.standalone);
    if (installed) pendingPrompt = null;
    render();
  });

  button.addEventListener("click", async () => {
    if (!pendingPrompt || installed) return;
    const prompt = pendingPrompt;
    pendingPrompt = null;
    render();
    try {
      // Must run directly from the click, before yielding user activation.
      await prompt.prompt();
    } catch {
      hint.textContent = `Installation could not be opened. ${manualHint}`;
    }
  });

  render();
}
