import { createContext, useCallback, useContext, useState } from "react";

/* One short message at the bottom of the screen, the same toast the older pages show. */
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message) => {
    const id = Math.random();
    setItems((a) => [...a, { id, message }]);
    setTimeout(() => setItems((a) => a.filter((x) => x.id !== id)), 3400);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="layer">{items.map((t) => <div key={t.id} className="toast" role="status">{t.message}</div>)}</div>
    </ToastContext.Provider>
  );
}
