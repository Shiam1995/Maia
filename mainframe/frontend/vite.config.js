import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            // Proxy API + media to the backend in dev so the frontend can use
            // same-origin relative URLs.
            "/api": "http://localhost:8000",
            "/media": "http://localhost:8000",
        },
    },
});
