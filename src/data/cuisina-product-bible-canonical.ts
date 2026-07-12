/** Canonical Cuisina product bible — modules + feature structure (asset refs filled via Review UI). */
import { PRODUCT_BIBLE_SCHEMA } from "../domain/product-bible.js";
import { CUISINA_PROJECT_SLUG } from "./cuisina-product-canonical.js";

export { CUISINA_PROJECT_SLUG };

export const CUISINA_PRODUCT_BIBLE = {
  schema_version: PRODUCT_BIBLE_SCHEMA,
  application_guide: {
    instructions:
      "Use real Cuisina app screenshots to show how meal planning works. Prefer workflow_step assets in onboarding order for how-it-works videos. Do not invent UI that is not in the attached screenshots.",
    heygen_policy:
      "Show actual app screens when explaining features. Use workflow steps sequentially for walkthrough content.",
    flux_policy:
      "When generating product visuals, match the UI style and layout from attached screenshots — do not hallucinate unrelated app chrome.",
  },
  products: [
    {
      key: "weekly_meal_plan",
      label: "Weekly Meal Plan",
      one_liner: "AI-generated personalized weekly meal plans",
      description:
        "The core Cuisina experience: a full week of meals tailored to dietary preferences, nutrition goals, budget, and time constraints.",
      features: [
        {
          key: "plan_overview",
          label: "Plan overview",
          description: "Weekly calendar view with all planned meals",
          asset_refs: [],
        },
        {
          key: "recipe_detail",
          label: "Recipe detail",
          description: "Individual recipe with ingredients and instructions",
          asset_refs: [],
        },
        {
          key: "replan_week",
          label: "Replan week",
          description: "One-tap weekly replanning when preferences change",
          asset_refs: [],
        },
      ],
      asset_refs: [],
    },
    {
      key: "grocery_list",
      label: "Auto Grocery List",
      one_liner: "Shopping list generated automatically from your meal plan",
      description:
        "Consolidated grocery list organized by category, synced to the weekly meal plan so users shop once with a clear plan.",
      features: [
        {
          key: "list_view",
          label: "Grocery list view",
          description: "Categorized shopping list with quantities",
          asset_refs: [],
        },
        {
          key: "check_off",
          label: "Check-off while shopping",
          description: "Interactive checklist while in the store",
          asset_refs: [],
        },
      ],
      asset_refs: [],
    },
    {
      key: "how_it_works",
      label: "How Cuisina Works",
      one_liner: "Onboarding flow from preferences to first meal plan",
      description:
        "Step-by-step onboarding: set dietary preferences, goals, household size, then receive the first personalized plan.",
      features: [],
      asset_refs: [],
    },
    {
      key: "preferences",
      label: "Dietary Preferences",
      one_liner: "Filter meals by diet, allergies, and nutrition targets",
      description:
        "Preference panel for vegan, gluten-free, high-protein, calorie targets, budget caps, and family-friendly options.",
      features: [
        {
          key: "preference_panel",
          label: "Preference settings",
          description: "Dietary filters and nutrition goal sliders",
          asset_refs: [],
        },
      ],
      asset_refs: [],
    },
  ],
} as const;
