import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import App from "./App.tsx";
import { store, persistor } from "./store/store";
import { loadCmsRuntimeConfig } from "./config/runtimeConfig";
import "./index.css";

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
