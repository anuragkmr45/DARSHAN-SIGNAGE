import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import App from "./App.tsx";
import { store, persistor } from "./store/store";
import { loadCmsRuntimeConfig } from "./config/runtimeConfig";
import "./index.css";

const PRELOAD_RETRY_KEY = "darshan:cms:preload-retry";

const showPreloadRecoveryMessage = () => {
  if (document.getElementById("darshan-preload-recovery")) return;
  const message = document.createElement("div");
  message.id = "darshan-preload-recovery";
  message.setAttribute("role", "alert");
  message.className = "fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl rounded-md border border-destructive/40 bg-background p-4 text-sm shadow-lg";
  message.textContent = "A CMS update could not load completely. Check your connection, then reload this page.";
  document.body.appendChild(message);
};

// A deployment can replace a hashed lazy chunk while an operator still has an
// older HTML entry document in memory. Reload once so the browser obtains the
// current entry document; never loop indefinitely for a genuine outage.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  try {
    if (window.sessionStorage.getItem(PRELOAD_RETRY_KEY) === "1") {
      console.error("CMS lazy chunk failed after the guarded refresh", event);
      showPreloadRecoveryMessage();
      return;
    }
    window.sessionStorage.setItem(PRELOAD_RETRY_KEY, "1");
    window.location.reload();
  } catch {
    // Storage can be disabled in hardened browsers. A single reload remains
    // safer than presenting a blank route in that case.
    window.location.reload();
  }
});

const renderApp = () => {
  createRoot(document.getElementById("root")!).render(
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <App />
      </PersistGate>
    </Provider>,
  );
};

loadCmsRuntimeConfig()
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown runtime config error";
    console.error("CMS runtime config failed to load", { message });
  })
  .finally(renderApp);
