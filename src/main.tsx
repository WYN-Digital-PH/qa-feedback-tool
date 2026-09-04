import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { brand } from "./config/brand";

// Keep the tab title in step with the brand config so a rebrand only needs the
// VITE_BRAND_* variables (index.html holds the pre-boot fallback).
document.title = brand.productName;
document.querySelector('meta[name="description"]')?.setAttribute("content", brand.description);

createRoot(document.getElementById("root")!).render(<App />);
