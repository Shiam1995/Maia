import type {
  AdvisoryResponse,
  FoodItem,
  Meal,
  MealCreate,
  TrendsResponse,
} from "./types";

// In dev, Vite proxies /api and /media to the backend (see vite.config.ts).
// In a built/deployed image, set VITE_API_BASE to the API origin.
const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function mediaUrl(url: string | null): string | null {
  if (!url) return null;
  return `${BASE}${url}`;
}

export const api = {
  preview: (payload: MealCreate) =>
    request<FoodItem[]>("/api/food/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  createMeal: (payload: MealCreate) =>
    request<Meal>("/api/food/meals", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Multipart quick-log with optional photo (mobile path).
  quickLog: (form: FormData) =>
    fetch(`${BASE}/api/food/meals/quick`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? res.statusText);
      }
      return res.json() as Promise<Meal>;
    }),

  listMeals: (params?: { start?: string; end?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.start) q.set("start", params.start);
    if (params?.end) q.set("end", params.end);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Meal[]>(`/api/food/meals${qs ? `?${qs}` : ""}`);
  },

  getMeal: (id: string) => request<Meal>(`/api/food/meals/${id}`),

  deleteMeal: (id: string) =>
    request<void>(`/api/food/meals/${id}`, { method: "DELETE" }),

  uploadPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return fetch(`${BASE}/api/food/meals/${id}/photo`, {
      method: "POST",
      body: form,
    }).then((res) => res.json() as Promise<Meal>);
  },

  trends: (granularity: "day" | "week" | "month") =>
    request<TrendsResponse>(`/api/food/trends?granularity=${granularity}`),

  advisory: () => request<AdvisoryResponse>("/api/food/advisory"),
};
