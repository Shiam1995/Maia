export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Micronutrient {
  name: string;
  amount: number;
  unit: string;
}

export interface FoodItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  estimated_grams: number | null;
  matched: boolean;
  source_db: string | null;
  source_ref: string | null;
  matched_name: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  fibre_g: number | null;
  micronutrients: Micronutrient[] | null;
}

export interface Meal {
  id: string;
  eaten_at: string;
  meal_type: MealType;
  description: string;
  notes: string | null;
  photo_path: string | null;
  photo_url: string | null;
  source: string;
  total_calories: number | null;
  total_protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  total_sugar_g: number | null;
  total_fibre_g: number | null;
  created_at: string;
  items: FoodItem[];
}

export interface NutrientTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  fibre_g: number;
}

export interface TrendBucket extends NutrientTotals {
  period: string;
  meal_count: number;
}

export interface TrendsResponse {
  granularity: "day" | "week" | "month";
  start: string;
  end: string;
  buckets: TrendBucket[];
  averages: NutrientTotals;
}

export interface Advice {
  code: string;
  severity: "info" | "warning" | "positive";
  message: string;
}

export interface AdvisoryResponse {
  date: string;
  generated_by: string;
  advice: Advice[];
}

export interface MealCreate {
  description: string;
  meal_type: MealType;
  eaten_at?: string | null;
  notes?: string | null;
  source?: string;
}
