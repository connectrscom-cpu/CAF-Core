import { redirect } from "next/navigation";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Marketer home; admin iframe and operator workbench live at `/review`. */
export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  if (params.embed === "admin") {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      q.set(key, Array.isArray(value) ? value[0]! : value);
    }
    redirect(`/review?${q.toString()}`);
  }
  redirect("/workspace");
}
