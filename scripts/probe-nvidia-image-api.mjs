/** Probe NVIDIA image API routes from Fly (uses NVIDIA_NIM_API_KEY env). */
const key = process.env.NVIDIA_NIM_API_KEY?.trim();
if (!key) {
  console.error("NVIDIA_NIM_API_KEY missing");
  process.exit(1);
}

const probes = [
  {
    name: "edits-qwen-image-edit",
    url: "https://integrate.api.nvidia.com/v1/images/edits",
    init: { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: new FormData() },
    form: (f) => {
      f.append("model", "qwen-image-edit");
      f.append("prompt", "test");
      f.append("n", "1");
    },
  },
  {
    name: "edits-qwen/qwen-image-edit",
    url: "https://integrate.api.nvidia.com/v1/images/edits",
    init: { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: new FormData() },
    form: (f) => {
      f.append("model", "qwen/qwen-image-edit");
      f.append("prompt", "test");
      f.append("n", "1");
    },
  },
  {
    name: "genai-invoke-alt",
    url: "https://ai.api.nvidia.com/v1/genai/qwen/qwen-image-edit/edits",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test edit" }),
    },
  },
  {
    name: "integrate-genai",
    url: "https://integrate.api.nvidia.com/v1/genai/qwen/qwen-image-edit",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test edit" }),
    },
  },
  {
    name: "models-list-filter",
    url: "https://integrate.api.nvidia.com/v1/models",
    init: { method: "GET", headers: { Authorization: `Bearer ${key}` } },
  },
];

for (const p of probes) {
  try {
    const init = { ...p.init };
    if (p.form && init.body instanceof FormData) {
      p.form(init.body);
    }
    const res = await fetch(p.url, init);
    const text = await res.text();
    let snippet = text.slice(0, 400);
    if (p.name === "models-list-filter") {
      try {
        const parsed = JSON.parse(text);
        const data = Array.isArray(parsed.data) ? parsed.data : [];
        const imageModels = data
          .map((m) => m?.id)
          .filter((id) => typeof id === "string" && /image|flux|genai|qwen/i.test(id));
        snippet = JSON.stringify({ image_related_models: imageModels, total: data.length });
      } catch {
        /* keep raw */
      }
    }
    console.log(JSON.stringify({ probe: p.name, url: p.url, status: res.status, body: snippet }));
  } catch (err) {
    console.log(JSON.stringify({ probe: p.name, url: p.url, error: String(err) }));
  }
}
