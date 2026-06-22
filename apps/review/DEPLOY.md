# Review app — where it runs

## Production (operators)

The editorial **Review Console** and **Admin workbench** are served from **CAF Core on Fly.io**:

- **https://caf-core.fly.dev/admin/workbench**
- Example: `https://caf-core.fly.dev/admin/workbench?project=SNS`

The Next.js app is **built into the Core Docker image** (`Dockerfile` → `CAF_REVIEW_STANDALONE_DIR`). After any change under `apps/review/`:

```bash
# from repo root
fly deploy -a caf-core
```

## Local dev

```bash
cd apps/review && npm run dev
```

Set `CAF_CORE_URL` to your Core API (e.g. `http://localhost:3847` or `https://caf-core.fly.dev`).

## Vercel (`vercel.json`)

Optional/legacy standalone host (e.g. `caf-core-review.vercel.app`). **Not** the canonical operator URL. Do not assume Vercel auto-deploy satisfies production workbench updates — use **`fly deploy -a caf-core`**.
